import { createClient, type RedisClientType } from "redis";

export type RedisQueueMessage<T = unknown> = {
  id: string;
  payload: T;
};

export type RedisQueueSnapshot = {
  streamLength: number;
  pending: number;
  deadLetter: number;
};

export type RedisDeadLetter<T = unknown> = {
  originalId: string;
  failedAt: string;
  reason: string;
  payload: T;
};

export class RedisRuntime {
  private readonly client: RedisClientType;
  constructor(url: string) {
    this.client = createClient({ url });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
  }

  async ready(): Promise<boolean> {
    try {
      await this.connect();
      return (await this.client.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.connect();
    await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    await this.connect();
    const raw = await this.client.get(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async queueSnapshot(topic: string, group: string): Promise<RedisQueueSnapshot> {
    await this.connect();
    const key = `queue:${topic}`;
    const streamLength = await this.client.xLen(key);
    let deadLetter: number;
    try {
      deadLetter = await this.client.xLen(`${key}:dead-letter`);
    } catch {
      // -1 explicitly surfaces a corrupt/wrong-type DLQ without making the
      // whole operations snapshot fail closed and disappear.
      deadLetter = -1;
    }
    if (streamLength === 0) return { streamLength: 0, pending: 0, deadLetter };
    try {
      const pending = await this.client.xPending(key, group);
      return { streamLength, pending: Number(pending.pending), deadLetter };
    } catch {
      return { streamLength, pending: 0, deadLetter };
    }
  }

  async acquireLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    await this.connect();
    return (await this.client.set(`lease:${key}`, owner, { NX: true, PX: ttlMs })) === "OK";
  }

  async releaseLease(key: string, owner: string): Promise<boolean> {
    await this.connect();
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { keys: [`lease:${key}`], arguments: [owner] },
    );
    return Number(result) === 1;
  }

  async renewLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
    await this.connect();
    const result = await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      { keys: [`lease:${key}`], arguments: [owner, String(ttlMs)] },
    );
    return Number(result) === 1;
  }

  async enqueue(topic: string, payload: unknown): Promise<string> {
    await this.connect();
    return this.client.xAdd(`queue:${topic}`, "*", { payload: JSON.stringify(payload) });
  }

  /** Atomically preserve a poison message in a dead-letter stream and ACK its source entry. */
  async deadLetter<T>(input: {
    topic: string;
    group: string;
    message: RedisQueueMessage<T>;
    reason: string;
    failedAt?: Date;
  }): Promise<string | undefined> {
    await this.connect();
    const record: RedisDeadLetter<T> = {
      originalId: input.message.id,
      failedAt: (input.failedAt ?? new Date()).toISOString(),
      reason: input.reason.slice(0, 240),
      payload: input.message.payload,
    };
    const result = await this.client.eval(
      "if #redis.call('xpending', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1) == 0 then return false end; local id = redis.call('xadd', KEYS[2], '*', 'payload', ARGV[3]); redis.call('xack', KEYS[1], ARGV[1], ARGV[2]); return id",
      {
        keys: [`queue:${input.topic}`, `queue:${input.topic}:dead-letter`],
        arguments: [input.group, input.message.id, JSON.stringify(record)],
      },
    );
    return result === null ? undefined : String(result);
  }

  /** A lost Redis response may be retried without appending the retry twice. */
  async retryPending(input: {
    topic: string;
    group: string;
    originalId: string;
    payload: unknown;
  }): Promise<string | undefined> {
    await this.connect();
    const result = await this.client.eval(
      "if #redis.call('xpending', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1) == 0 then return false end; local id = redis.call('xadd', KEYS[1], '*', 'payload', ARGV[3]); redis.call('xack', KEYS[1], ARGV[1], ARGV[2]); return id",
      {
        keys: [`queue:${input.topic}`],
        arguments: [input.group, input.originalId, JSON.stringify(input.payload)],
      },
    );
    return result === null ? undefined : String(result);
  }

  async reclaimPending<T>(input: {
    topic: string;
    group: string;
    consumer: string;
    minIdleMs: number;
    cursor?: string;
    count?: number;
  }): Promise<{ cursor: string; messages: Array<RedisQueueMessage<T>> }> {
    await this.connect();
    const claimed = await this.client.xAutoClaim(
      `queue:${input.topic}`,
      input.group,
      input.consumer,
      input.minIdleMs,
      input.cursor ?? "0-0",
      { COUNT: input.count ?? 100 },
    );
    const messages: Array<RedisQueueMessage<T>> = [];
    for (const item of claimed.messages) {
      if (!item) continue;
      const decoded = await this.decodeQueueMessage<T>(input.topic, input.group, item);
      if (decoded) messages.push(decoded);
    }
    return { cursor: claimed.nextId, messages };
  }

  private async decodeQueueMessage<T>(
    topic: string,
    group: string,
    item: { id: string; message: Record<string, string> },
  ): Promise<RedisQueueMessage<T> | undefined> {
    const raw = item.message.payload;
    if (typeof raw === "string") {
      try {
        return { id: item.id, payload: JSON.parse(raw) as T };
      } catch {
        // Preserve the original bytes below so an operator can investigate/replay.
      }
    }
    await this.deadLetter({
      topic,
      group,
      message: { id: item.id, payload: { fields: item.message } },
      reason: typeof raw === "string" ? "invalid_queue_json" : "missing_queue_payload",
    });
    return undefined;
  }

  async ensureConsumerGroup(topic: string, group: string): Promise<void> {
    await this.connect();
    try {
      await this.client.xGroupCreate(`queue:${topic}`, group, "0", {
        MKSTREAM: true,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  async readGroup<T>(input: {
    topic: string;
    group: string;
    consumer: string;
    count?: number;
    blockMs?: number;
    id?: string;
  }): Promise<Array<RedisQueueMessage<T>>> {
    await this.connect();
    const options: { COUNT: number; BLOCK?: number } = {
      COUNT: input.count ?? 20,
    };
    if (input.blockMs !== undefined && input.blockMs > 0) {
      options.BLOCK = input.blockMs;
    }
    const streams = await this.client.xReadGroup(
      input.group,
      input.consumer,
      { key: `queue:${input.topic}`, id: input.id ?? ">" },
      options,
    );
    if (!streams) return [];
    const output: Array<RedisQueueMessage<T>> = [];
    for (const stream of streams) {
      for (const item of stream.messages) {
        const decoded = await this.decodeQueueMessage<T>(input.topic, input.group, item);
        if (decoded) output.push(decoded);
      }
    }
    return output;
  }

  async acknowledge(topic: string, group: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.connect();
    return this.client.xAck(`queue:${topic}`, group, [...ids]);
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}

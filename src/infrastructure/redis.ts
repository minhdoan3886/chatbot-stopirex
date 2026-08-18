import { createClient, type RedisClientType } from "redis";

export type RedisQueueMessage<T = unknown> = {
  id: string;
  payload: T;
};

export type RedisQueueSnapshot = {
  streamLength: number;
  pending: number;
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
    if (streamLength === 0) return { streamLength: 0, pending: 0 };
    try {
      const pending = await this.client.xPending(key, group);
      return { streamLength, pending: Number(pending.pending) };
    } catch {
      return { streamLength, pending: 0 };
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
        const raw = item.message.payload;
        if (typeof raw !== "string") continue;
        try {
          output.push({ id: item.id, payload: JSON.parse(raw) as T });
        } catch {
          await this.client.xAck(`queue:${input.topic}`, input.group, item.id);
        }
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

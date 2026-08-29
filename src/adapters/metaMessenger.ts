import type { MetaMessenger, ProviderResult } from "../integrations/contracts.js";

export class GraphMetaMessenger implements MetaMessenger {
  constructor(
    private readonly config: {
      pageAccessToken: string;
      graphVersion: string;
      fetcher?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async getProfile(
    recipientId: string,
  ): Promise<ProviderResult<{ name?: string; firstName?: string }>> {
    try {
      const params = new URLSearchParams({
        fields: "first_name,last_name,name",
        access_token: this.config.pageAccessToken,
      });
      const response = await (this.config.fetcher ?? fetch)(
        `https://graph.facebook.com/${this.config.graphVersion}/${encodeURIComponent(recipientId)}?${params.toString()}`,
        {
          method: "GET",
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        },
      );
      const payload = (await response.json()) as {
        name?: unknown;
        first_name?: unknown;
      };
      if (!response.ok) {
        return {
          ok: false,
          retryable: response.status === 429 || response.status >= 500,
          code: `meta_${response.status}`,
          message: "Meta profile request failed",
        };
      }
      const name = cleanProfileName(payload.name);
      const firstName = cleanProfileName(payload.first_name);
      return {
        ok: true,
        value: {
          ...(name ? { name } : {}),
          ...(firstName ? { firstName } : {}),
        },
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        code: "network_error",
        message: error instanceof Error ? error.message : "network error",
      };
    }
  }

  async sendText(input: {
    recipientId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>> {
    return this.send({
      recipient: { id: input.recipientId },
      message: { text: input.text, metadata: `stopirex-bot:${input.idempotencyKey}` },
      messaging_type: "RESPONSE",
    });
  }

  async sendImage(input: {
    recipientId: string;
    imageUrl: string;
    caption?: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>> {
    const result = await this.send({
      recipient: { id: input.recipientId },
      message: {
        attachment: { type: "image", payload: { url: input.imageUrl, is_reusable: true } },
        metadata: `stopirex-bot:${input.idempotencyKey}`,
      },
      messaging_type: "RESPONSE",
    });
    if (result.ok && input.caption)
      return this.sendText({
        recipientId: input.recipientId,
        text: input.caption,
        idempotencyKey: `${input.idempotencyKey}:caption`,
      });
    return result;
  }

  async sendTyping(recipientId: string): Promise<ProviderResult<void>> {
    const result = await this.request({ recipient: { id: recipientId }, sender_action: "typing_on" });
    return result.ok ? { ok: true, value: undefined } : result;
  }

  private async send(body: unknown): Promise<ProviderResult<{ messageId: string }>> {
    const result = await this.request(body);
    if (!result.ok) return result;
    const payload = result.value as { message_id?: string };
    return payload.message_id
      ? { ok: true, value: { messageId: payload.message_id } }
      : { ok: false, retryable: false, code: "invalid_response", message: "Meta không trả message_id" };
  }

  private async request(body: unknown): Promise<ProviderResult<unknown>> {
    try {
      const response = await (this.config.fetcher ?? fetch)(
        `https://graph.facebook.com/${this.config.graphVersion}/me/messages?access_token=${encodeURIComponent(this.config.pageAccessToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
        },
      );
      const payload = (await response.json()) as unknown;
      if (response.ok) return { ok: true, value: payload };
      return {
        ok: false,
        retryable: response.status === 429 || response.status >= 500,
        code: `meta_${response.status}`,
        message: "Meta request failed",
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        code: "network_error",
        message: error instanceof Error ? error.message : "network error",
      };
    }
  }
}

function cleanProfileName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[<>{}#]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 80);
  return cleaned || undefined;
}

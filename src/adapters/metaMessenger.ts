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

  async sendPrivateCommentReply(input: {
    commentId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>> {
    const result = await this.requestEndpoint(`${encodeURIComponent(input.commentId)}/private_replies`, {
      message: input.text,
    });
    if (!result.ok) return result;
    const payload = result.value as { id?: string; message_id?: string };
    const messageId = payload.message_id ?? payload.id;
    return messageId
      ? { ok: true, value: { messageId } }
      : { ok: false, retryable: false, code: "invalid_response", message: "Meta không trả message_id" };
  }

  async sendPublicCommentReply(input: {
    commentId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>> {
    const result = await this.requestEndpoint(`${encodeURIComponent(input.commentId)}/comments`, {
      message: input.text,
    });
    if (!result.ok) return result;
    const payload = result.value as { id?: string };
    return payload.id
      ? { ok: true, value: { messageId: payload.id } }
      : { ok: false, retryable: false, code: "invalid_response", message: "Meta không trả comment id" };
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
    return this.requestEndpoint("me/messages", body);
  }

  private async requestEndpoint(path: string, body: unknown): Promise<ProviderResult<unknown>> {
    try {
      const response = await (this.config.fetcher ?? fetch)(
        `https://graph.facebook.com/${this.config.graphVersion}/${path}?access_token=${encodeURIComponent(this.config.pageAccessToken)}`,
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

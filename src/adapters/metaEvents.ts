export type MetaInbound = {
  pageId: string;
  senderId: string;
  recipientId?: string;
  eventId: string;
  timestamp: Date;
  kind: "text" | "image" | "postback" | "delivery" | "read" | "comment";
  text?: string;
  attachmentUrl?: string;
  isEcho: boolean;
  appId?: string;
  metadata?: string;
  commentId?: string;
  postId?: string;
  payload: unknown;
};

export function isBotAuthoredEcho(event: MetaInbound, ownAppId?: string): boolean {
  if (!event.isEcho) return false;
  if (event.metadata?.startsWith("stopirex-bot:")) return true;
  return Boolean(ownAppId && event.appId === ownAppId);
}

export function parseMetaWebhook(payload: unknown): MetaInbound[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { object?: unknown; entry?: unknown[] };
  if (root.object !== "page" || !Array.isArray(root.entry)) return [];
  const events: MetaInbound[] = [];
  for (const entry of root.entry) {
    if (!entry || typeof entry !== "object") continue;
    const page = entry as { id?: unknown; messaging?: unknown[]; changes?: unknown[]; time?: unknown };
    if (typeof page.id !== "string") continue;
    for (const item of Array.isArray(page.messaging) ? page.messaging : []) {
      if (!item || typeof item !== "object") continue;
      const event = item as Record<string, unknown>;
      const sender = event.sender as { id?: unknown } | undefined;
      const recipient = event.recipient as { id?: unknown } | undefined;
      if (typeof sender?.id !== "string") continue;
      const message = event.message as {
        mid?: unknown;
        text?: unknown;
        attachments?: Array<{ type?: unknown; payload?: { url?: unknown } }>;
        is_echo?: unknown;
        app_id?: unknown;
        metadata?: unknown;
      } | undefined;
      const postback = event.postback as { payload?: unknown; mid?: unknown } | undefined;
      const systemTemplateOnly =
        typeof message?.text !== "string" &&
        !postback &&
        message?.attachments?.length === 1 &&
        message.attachments[0]?.type === "template";
      // Messenger can emit client-side utility cards (for example the
      // "Bật cập nhật thông tin vận chuyển" prompt) as a message attachment
      // with type=template. It is not customer-authored content and must not
      // enter the image handoff flow.
      if (systemTemplateOnly) continue;
      const eventId =
        typeof message?.mid === "string"
          ? message.mid
          : typeof postback?.mid === "string"
            ? postback.mid
            : `${page.id}:${sender.id}:${String(event.timestamp ?? "0")}:${events.length}`;
      const kind = event.delivery
        ? "delivery"
        : event.read
          ? "read"
          : postback
            ? "postback"
            : message?.attachments?.length
              ? "image"
              : "text";
      events.push({
        pageId: page.id,
        senderId:
          (message?.is_echo === true || sender.id === page.id) && typeof recipient?.id === "string"
            ? recipient.id
            : sender.id,
        ...(typeof recipient?.id === "string" ? { recipientId: recipient.id } : {}),
        eventId,
        timestamp: new Date(Number(event.timestamp ?? Date.now())),
        kind,
        ...(typeof message?.text === "string"
          ? { text: message.text }
          : typeof postback?.payload === "string"
            ? { text: postback.payload }
            : {}),
        ...(typeof message?.attachments?.[0]?.payload?.url === "string"
          ? { attachmentUrl: message.attachments[0].payload.url }
          : {}),
        isEcho: message?.is_echo === true || sender.id === page.id,
        ...(typeof message?.app_id === "string" || typeof message?.app_id === "number"
          ? { appId: String(message.app_id) }
          : {}),
        ...(typeof message?.metadata === "string" ? { metadata: message.metadata } : {}),
        payload: item,
      });
    }
    for (const item of Array.isArray(page.changes) ? page.changes : []) {
      if (!item || typeof item !== "object") continue;
      const change = item as { field?: unknown; value?: unknown };
      if (change.field !== "feed" || !change.value || typeof change.value !== "object") continue;
      const value = change.value as {
        item?: unknown;
        verb?: unknown;
        from?: { id?: unknown };
        comment_id?: unknown;
        post_id?: unknown;
        message?: unknown;
        created_time?: unknown;
      };
      if (
        value.item !== "comment" ||
        value.verb !== "add" ||
        typeof value.from?.id !== "string" ||
        value.from.id === page.id ||
        typeof value.comment_id !== "string" ||
        typeof value.message !== "string" ||
        !value.message.trim()
      ) {
        continue;
      }
      const createdAt = Number(value.created_time ?? page.time ?? Date.now());
      events.push({
        pageId: page.id,
        senderId: value.from.id,
        eventId: value.comment_id,
        timestamp: new Date(createdAt < 10_000_000_000 ? createdAt * 1_000 : createdAt),
        kind: "comment",
        text: value.message.trim(),
        isEcho: false,
        commentId: value.comment_id,
        ...(typeof value.post_id === "string" ? { postId: value.post_id } : {}),
        payload: item,
      });
    }
  }
  return events;
}

export class PageTenantRegistry {
  constructor(private readonly mapping: ReadonlyMap<string, { tenantId: string; pageId: string }>) {}
  resolve(externalPageId: string): { tenantId: string; pageId: string } {
    const scope = this.mapping.get(externalPageId);
    if (!scope) throw new Error("unregistered_page");
    return { ...scope };
  }
}

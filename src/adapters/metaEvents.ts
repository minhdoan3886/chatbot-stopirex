export type MetaInbound = {
  pageId: string;
  senderId: string;
  recipientId?: string;
  eventId: string;
  timestamp: Date;
  kind: "text" | "image" | "postback" | "delivery" | "read";
  text?: string;
  attachmentUrl?: string;
  isEcho: boolean;
  appId?: string;
  metadata?: string;
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
    const page = entry as { id?: unknown; messaging?: unknown[] };
    if (typeof page.id !== "string" || !Array.isArray(page.messaging)) continue;
    for (const item of page.messaging) {
      if (!item || typeof item !== "object") continue;
      const event = item as Record<string, unknown>;
      const sender = event.sender as { id?: unknown } | undefined;
      const recipient = event.recipient as { id?: unknown } | undefined;
      if (typeof sender?.id !== "string") continue;
      const message = event.message as {
        mid?: unknown;
        text?: unknown;
        attachments?: Array<{ payload?: { url?: unknown } }>;
        is_echo?: unknown;
        app_id?: unknown;
        metadata?: unknown;
      } | undefined;
      const postback = event.postback as { payload?: unknown; mid?: unknown } | undefined;
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

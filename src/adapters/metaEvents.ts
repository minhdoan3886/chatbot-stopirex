import type { MetaReferralAttribution } from "../domain/marketingAttribution.js";

export type MetaInbound = {
  pageId: string;
  senderId: string;
  recipientId?: string;
  eventId: string;
  timestamp: Date;
  kind: "text" | "image" | "postback" | "referral" | "delivery" | "read" | "comment";
  text?: string;
  attachmentUrl?: string;
  isEcho: boolean;
  appId?: string;
  metadata?: string;
  referral?: MetaReferralAttribution;
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
    const page = entry as { id?: unknown; messaging?: unknown[]; changes?: unknown[] };
    if (typeof page.id !== "string") continue;
    for (const item of page.messaging ?? []) {
      if (!item || typeof item !== "object") continue;
      const event = item as Record<string, unknown>;
      const sender = event.sender as { id?: unknown } | undefined;
      const recipient = event.recipient as { id?: unknown } | undefined;
      if (typeof sender?.id !== "string") continue;
      const message = event.message as
        | {
            mid?: unknown;
            text?: unknown;
            attachments?: Array<{ type?: unknown; payload?: { url?: unknown } }>;
            is_echo?: unknown;
            app_id?: unknown;
            metadata?: unknown;
          }
        | undefined;
      const postback = event.postback as { payload?: unknown; mid?: unknown } | undefined;
      const referral = parseReferral(event, message, postback);
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
            : referral && !message
              ? "referral"
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
        ...(referral ? { referral } : {}),
        payload: item,
      });
    }
    for (const item of page.changes ?? []) {
      const change = record(item);
      const value = record(change?.value);
      const from = record(value?.from);
      if (
        change?.field !== "feed" ||
        value?.item !== "comment" ||
        value?.verb !== "add" ||
        typeof from?.id !== "string" ||
        from.id === page.id ||
        typeof value?.comment_id !== "string" ||
        typeof value?.message !== "string" ||
        !value.message.trim()
      ) {
        continue;
      }
      const rawTimestamp = Number(
        value.created_time ?? (entry as Record<string, unknown>).time ?? Date.now(),
      );
      const timestampMs =
        rawTimestamp > 0 && rawTimestamp < 10_000_000_000 ? rawTimestamp * 1_000 : rawTimestamp;
      events.push({
        pageId: page.id,
        senderId: from.id,
        eventId: value.comment_id,
        timestamp: new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()),
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

function parseReferral(
  event: Record<string, unknown>,
  messageValue: unknown,
  postbackValue: unknown,
): MetaReferralAttribution | undefined {
  const message = record(messageValue);
  const postback = record(postbackValue);
  const raw = firstRecord(event.referral, message?.referral, postback?.referral);
  if (!raw) return undefined;
  const adsContextData = record(raw.ads_context_data) ?? {};
  const source = scalarString(raw.source);
  const type = scalarString(raw.type);
  const ref = scalarString(raw.ref);
  const adId = scalarString(raw.ad_id);
  return {
    ...(source ? { source } : {}),
    ...(type ? { type } : {}),
    ...(ref ? { ref } : {}),
    ...(adId ? { adId } : {}),
    adsContextData,
    raw,
  };
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    const candidate = record(value);
    if (candidate) return candidate;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

export class PageTenantRegistry {
  constructor(private readonly mapping: ReadonlyMap<string, { tenantId: string; pageId: string }>) {}
  resolve(externalPageId: string): { tenantId: string; pageId: string } {
    const scope = this.mapping.get(externalPageId);
    if (!scope) throw new Error("unregistered_page");
    return { ...scope };
  }
}

export type TenantId = string & { readonly __brand: "TenantId" };
export type PageId = string & { readonly __brand: "PageId" };
export type CustomerId = string & { readonly __brand: "CustomerId" };
export type ConversationId = string & { readonly __brand: "ConversationId" };

export type Channel = "facebook" | "shopee" | "tiktok";

export type Scope = {
  tenantId: TenantId;
  pageId: PageId;
};

export function tenantId(value: string): TenantId {
  if (!value.trim()) throw new Error("tenantId không được trống");
  return value as TenantId;
}

export function pageId(value: string): PageId {
  if (!value.trim()) throw new Error("pageId không được trống");
  return value as PageId;
}

export function customerId(value: string): CustomerId {
  if (!value.trim()) throw new Error("customerId không được trống");
  return value as CustomerId;
}

export function conversationId(value: string): ConversationId {
  if (!value.trim()) throw new Error("conversationId không được trống");
  return value as ConversationId;
}

export function scopedKey(scope: Scope, ...parts: string[]): string {
  return [scope.tenantId, scope.pageId, ...parts].join(":");
}

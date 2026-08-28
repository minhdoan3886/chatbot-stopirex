import type { PipelineTag, SignalTag } from "../domain/pipeline.js";
import type { OrderDraft } from "../domain/orders.js";

export type ProviderResult<T> =
  { ok: true; value: T } | { ok: false; retryable: boolean; code: string; message: string };

export interface PancakeAdapter {
  syncCustomer(input: {
    externalCustomerId: string;
    name?: string;
  }): Promise<ProviderResult<{ customerId: string }>>;
  replaceTags(input: {
    conversationId: string;
    pipeline: PipelineTag;
    signal?: SignalTag;
  }): Promise<ProviderResult<void>>;
  createOrder(input: {
    idempotencyKey: string;
    draft: Required<OrderDraft>;
  }): Promise<ProviderResult<{ orderId: string }>>;
}

export interface SapoAdapter {
  createOrder(input: {
    idempotencyKey: string;
    productId: string;
    draft: Required<OrderDraft>;
  }): Promise<ProviderResult<{ orderId: string }>>;
  getOrderStatus(orderId: string): Promise<ProviderResult<{ status: string }>>;
}

export type ShipmentTracking = {
  carrier: "viettel_post" | "spx" | "ghn" | "ghtk" | "other";
  trackingNumber: string;
  trackingUrl: string;
  status: string;
  etaAt?: Date;
};

export interface ShippingAdapter {
  createShipment(input: {
    idempotencyKey: string;
    orderId: string;
    draft: Required<OrderDraft>;
  }): Promise<ProviderResult<ShipmentTracking>>;
  getTracking(
    trackingNumber: string,
  ): Promise<ProviderResult<ShipmentTracking>>;
}

export interface OmicallAdapter {
  requestCall(input: {
    idempotencyKey: string;
    phone: string;
    queue: string;
    note: string;
  }): Promise<ProviderResult<{ callId: string }>>;
  getCallResult(callId: string): Promise<ProviderResult<{ disposition: string; note?: string }>>;
}

export interface MetaMessenger {
  sendText(input: {
    recipientId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>>;
  sendImage(input: {
    recipientId: string;
    imageUrl: string;
    caption?: string;
    idempotencyKey: string;
  }): Promise<ProviderResult<{ messageId: string }>>;
  sendTyping(recipientId: string): Promise<ProviderResult<void>>;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  constructor(
    private readonly threshold = 5,
    private readonly resetMs = 30_000,
  ) {}

  canAttempt(now = Date.now()): boolean {
    if (this.openedAt === undefined) return true;
    if (now - this.openedAt >= this.resetMs) {
      this.failures = 0;
      this.openedAt = undefined;
      return true;
    }
    return false;
  }

  record(success: boolean, now = Date.now()): void {
    if (success) {
      this.failures = 0;
      this.openedAt = undefined;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = now;
  }
}

export async function retryProvider<T>(
  operation: () => Promise<ProviderResult<T>>,
  attempts = 3,
): Promise<ProviderResult<T>> {
  let last: ProviderResult<T> = {
    ok: false,
    retryable: true,
    code: "not_attempted",
    message: "not attempted",
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await operation();
    if (last.ok || !last.retryable) return last;
  }
  return last;
}

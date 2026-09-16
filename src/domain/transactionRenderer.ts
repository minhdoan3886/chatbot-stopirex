import type { PriceQuote } from "./products.js";

export type TransactionMoneyRole = "unit_price" | "subtotal" | "shipping" | "discount" | "total";

export type TransactionMoneySlot = {
  role: TransactionMoneyRole;
  amount: number;
  currency: "VND";
  quantity: number;
  sourceRef: string;
  sourceVersion: string;
};

export type ShippingAdjustmentReceipt = {
  shippingFeeVnd: number;
  receiptId: string;
  sourceVersion: string;
};

export type TransactionRenderReceipt = {
  quoteId: string;
  sku: string;
  quantity: number;
  sourceVersion: string;
  slots: readonly TransactionMoneySlot[];
  money(role: TransactionMoneyRole): string;
  amount(role: TransactionMoneyRole): number;
};

export class TransactionRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TransactionRenderError";
  }
}

export function renderPriceQuote(
  quote: PriceQuote,
  input: { shippingAdjustment?: ShippingAdjustmentReceipt; comparisonUnitQuote?: PriceQuote } = {},
): TransactionRenderReceipt {
  assertQuote(quote);
  const sourceVersion = nonEmpty(quote.offerVersion ?? quote.sourceId, "source_version");
  const shipping = input.shippingAdjustment
    ? validatedShippingAdjustment(input.shippingAdjustment, quote)
    : {
        amount: quote.shippingFee.amount,
        sourceRef: quote.sourceId,
        sourceVersion,
      };
  const subtotal = quote.productPrice.amount;
  const total = subtotal + shipping.amount;
  const discount = input.comparisonUnitQuote
    ? comparisonDiscount(input.comparisonUnitQuote, quote)
    : undefined;
  const slots: TransactionMoneySlot[] = [
    ...(quote.quantity === 1
      ? [slot("unit_price", subtotal, quote.quantity, quote.sourceId, sourceVersion)]
      : []),
    slot("subtotal", subtotal, quote.quantity, quote.sourceId, sourceVersion),
    slot("shipping", shipping.amount, quote.quantity, shipping.sourceRef, shipping.sourceVersion),
    ...(discount !== undefined
      ? [
          slot(
            "discount",
            discount,
            quote.quantity,
            `${input.comparisonUnitQuote!.sourceId}+${quote.sourceId}`,
            `${input.comparisonUnitQuote!.offerVersion ?? input.comparisonUnitQuote!.sourceId}+${sourceVersion}`,
          ),
        ]
      : []),
    slot("total", total, quote.quantity, quote.sourceId, sourceVersion),
  ];
  return {
    quoteId: quote.sourceId,
    sku: quote.sku,
    quantity: quote.quantity,
    sourceVersion,
    slots,
    money: (role) => formatVnd(findSlot(slots, role).amount),
    amount: (role) => findSlot(slots, role).amount,
  };
}

function comparisonDiscount(unitQuote: PriceQuote, offer: PriceQuote): number {
  assertQuote(unitQuote);
  if (unitQuote.quantity !== 1 || unitQuote.sku !== offer.sku) {
    throw new TransactionRenderError(
      "transaction_invalid_discount_baseline",
      "Quote so sánh phải là một đơn vị cùng SKU",
    );
  }
  const discount = unitQuote.productPrice.amount * offer.quantity - offer.productPrice.amount;
  if (discount < 0) {
    throw new TransactionRenderError("transaction_negative_discount", "Mức tiết kiệm không được âm");
  }
  return discount;
}

export function assertRenderedTransactionText(text: string): void {
  if (/\{\{|\}\}|\$\{|\[(?:unknown|todo|missing)[^\]]*\]/iu.test(text)) {
    throw new TransactionRenderError("transaction_unknown_placeholder", "Phản hồi còn placeholder giao dịch");
  }
}

export function formatVnd(amount: number): string {
  assertAmount(amount, "rendered_amount");
  return `${amount.toLocaleString("vi-VN")}đ`;
}

function assertQuote(quote: PriceQuote): void {
  nonEmpty(quote.sourceId, "quote_id");
  nonEmpty(quote.sku, "sku");
  if (!Number.isSafeInteger(quote.quantity) || quote.quantity < 1) {
    throw new TransactionRenderError("transaction_invalid_quantity", "Số lượng quote không hợp lệ");
  }
  for (const [role, money] of [
    ["subtotal", quote.productPrice],
    ["shipping", quote.shippingFee],
    ["total", quote.total],
  ] as const) {
    if (money.currency !== "VND") {
      throw new TransactionRenderError(`transaction_invalid_currency:${role}`, "Tiền tệ quote không hợp lệ");
    }
    assertAmount(money.amount, role);
  }
  if (quote.total.amount !== quote.productPrice.amount + quote.shippingFee.amount) {
    throw new TransactionRenderError(
      "transaction_total_mismatch",
      "Tổng quote không khớp tiền hàng và phí giao",
    );
  }
}

function validatedShippingAdjustment(
  adjustment: ShippingAdjustmentReceipt,
  quote: PriceQuote,
): { amount: number; sourceRef: string; sourceVersion: string } {
  assertAmount(adjustment.shippingFeeVnd, "shipping_adjustment");
  const receiptId = nonEmpty(adjustment.receiptId, "shipping_receipt");
  const sourceVersion = nonEmpty(adjustment.sourceVersion, "shipping_source_version");
  if (adjustment.shippingFeeVnd > quote.shippingFee.amount) {
    throw new TransactionRenderError(
      "transaction_shipping_adjustment_increase",
      "Điều chỉnh phí giao không được tự tăng giá catalog",
    );
  }
  return { amount: adjustment.shippingFeeVnd, sourceRef: receiptId, sourceVersion };
}

function slot(
  role: TransactionMoneyRole,
  amount: number,
  quantity: number,
  sourceRef: string,
  sourceVersion: string,
): TransactionMoneySlot {
  return { role, amount, currency: "VND", quantity, sourceRef, sourceVersion };
}

function findSlot(slots: readonly TransactionMoneySlot[], role: TransactionMoneyRole): TransactionMoneySlot {
  const match = slots.find((item) => item.role === role);
  if (!match) {
    throw new TransactionRenderError(`transaction_missing_slot:${role}`, `Không có slot ${role}`);
  }
  return match;
}

function assertAmount(value: number, role: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TransactionRenderError(`transaction_invalid_amount:${role}`, `Số tiền ${role} không hợp lệ`);
  }
}

function nonEmpty(value: string, field: string): string {
  if (!value.trim()) {
    throw new TransactionRenderError(`transaction_missing_${field}`, `Thiếu ${field}`);
  }
  return value;
}

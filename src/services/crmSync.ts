import type { PancakeAdapter, ProviderResult } from "../integrations/contracts.js";
import type { PipelineTag, SignalTag } from "../domain/pipeline.js";

export async function reconcileConversationTags(input: {
  adapter: PancakeAdapter;
  conversationId: string;
  pipeline: PipelineTag;
  signal?: SignalTag;
}): Promise<ProviderResult<void>> {
  return input.adapter.replaceTags({
    conversationId: input.conversationId,
    pipeline: input.pipeline,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export function signalFromEvidence(input: {
  customerText?: string;
  readPriceAt?: Date;
  viewedAt?: Date;
  spam?: boolean;
}): SignalTag | undefined {
  const text = input.customerText?.toLocaleLowerCase("vi-VN") ?? "";
  if (input.spam) return "TH.Spam/Rác";
  if (/giá|đắt|ship|phí/.test(text)) return "CT.Giá/Ship";
  if (/rát|ngứa|an toàn|kích ứng/.test(text)) return "CT.An toàn";
  if (/hiệu quả|có hết|có giảm/.test(text)) return "CT.Hiệu quả";
  if (/tham khảo|chưa cần/.test(text)) return "CT.Tham khảo";
  if (input.readPriceAt) return "TH.Xem im lặng";
  if (input.viewedAt === undefined) return "TH.Không xem";
  return undefined;
}

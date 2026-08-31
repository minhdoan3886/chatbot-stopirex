import { CodexLlmBridge } from "../src/services/codexLlm.js";
import { DemoChatService, type DemoChatState } from "../src/services/demoChat.js";
import { StructuredLogger, type LogRecord } from "../src/services/logger.js";
import { MetaChatBrain } from "../src/services/metaChatBrain.js";

type SmokeScenario = {
  id: number;
  name: string;
  turns: string[];
};

const scenarios: SmokeScenario[] = [
  {
    id: 1,
    name: "Tư vấn, đổi chủ đề và quay lại chốt đúng combo",
    turns: [
      "Chào shop, mình bị ra mồ hôi nách khá nhiều",
      "Nhất là lúc căng thẳng hoặc họp",
      "Nhưng mình không bị mùi nặng lắm",
      "Stopirex dùng kiểu gì vậy?",
      "Da mình hơi nhạy cảm thì sao?",
      "Một lọ dùng được lâu không?",
      "Có những combo nào?",
      "Theo bạn mình nên lấy loại nào?",
      "Ok để mình suy nghĩ",
      "À ship về Hải Phòng mất bao lâu?",
      "Có được kiểm tra hàng không?",
      "Hàng bên bạn là chính hãng chứ?",
      "Quay lại cái combo bạn vừa khuyên mình ấy",
      "Nó có hợp với tình trạng của mình không?",
      "Thế lấy cho mình combo đó",
      "Minh Anh, 0981234567",
      "25 Lạch Tray, Hải Phòng",
      "Đúng rồi",
    ],
  },
  {
    id: 2,
    name: "Chốt đơn, sửa thông tin và phân biệt dữ liệu cũ với mới",
    turns: [
      "Shop ơi mình muốn mua Stopirex",
      "Mình dùng rồi, lần này mua cho em gái",
      "Em mình 17 tuổi, hay ra mồ hôi khi đi học",
      "Nó không bị mùi nhiều đâu",
      "Lấy 2 lọ nhé",
      "Người nhận là Nguyễn Ngọc Mai",
      "0912345678",
      "15 Nguyễn Trãi, Thanh Xuân, Hà Nội",
      "Khoan, đổi số điện thoại nhé",
      "0987654321 mới đúng",
      "Địa chỉ vẫn như cũ",
      "Mình có thể dùng chung một lọ với em không?",
      "À thôi vẫn để em mình dùng riêng",
      "Ban đầu mình đặt mấy lọ nhỉ?",
      "Người nhận là ai ấy nhỉ?",
      "Số điện thoại?",
      "Địa chỉ lúc nãy giữ nguyên nha",
      "Tổng kết đơn giúp mình",
      "À số lúc đầu của mình là gì nhỉ?",
      "Vậy cứ để số mới nhé",
    ],
  },
];

function stateSnapshot(state: DemoChatState): Record<string, unknown> {
  return {
    lastIntent: state.lastIntent,
    activeSkill: state.activeSkill,
    selectedQuantity: state.selectedQuantity,
    orderFlowStatus: state.orderFlowStatus,
    orderDraft: state.orderDraft,
    orderMissing: state.orderMissing,
    conversationMemory: state.conversationMemory,
    locationMemory: state.locationMemory,
  };
}

function print(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function lastEvent(events: LogRecord[], name: string): LogRecord | undefined {
  return [...events].reverse().find((event) => event.event === name);
}

const requestedScenario = process.argv.find((value) => value.startsWith("--scenario="))?.split("=")[1];
const selectedScenarios = requestedScenario
  ? scenarios.filter((scenario) => String(scenario.id) === requestedScenario)
  : scenarios;

if (selectedScenarios.length === 0) {
  throw new Error(`unknown_scenario:${requestedScenario}`);
}

const llm = CodexLlmBridge.fromEnvironment(process.env);
print({ type: "start", llm: llm.healthSnapshot() });

for (const scenario of selectedScenarios) {
  const chat = new DemoChatService();
  const events: LogRecord[] = [];
  const logger = new StructuredLogger((line) => {
    events.push(JSON.parse(line) as LogRecord);
  });
  const brain = new MetaChatBrain(chat, llm, logger);
  const sessionId = `product-memory-smoke-${scenario.id}-${Date.now()}`;
  print({ type: "scenario", scenario: scenario.id, name: scenario.name });

  for (const [index, customer] of scenario.turns.entries()) {
    events.length = 0;
    try {
      const response = await brain.reply({
        sessionId,
        text: customer,
        orderConfirmationMode: "inbox",
        orderEditable: true,
      });
      const interpretation = lastEvent(events, "llm_interpretation");
      const composition = lastEvent(events, "llm_composition");
      print({
        type: "turn",
        scenario: scenario.id,
        turn: index + 1,
        customer,
        bot: response.reply,
        replies: response.replies,
        llm: {
          interpretation: interpretation ?? null,
          composition: composition ?? null,
        },
        state: stateSnapshot(response.state),
      });
    } catch (error) {
      print({
        type: "error",
        scenario: scenario.id,
        turn: index + 1,
        customer,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

print({ type: "end", llm: llm.healthSnapshot() });

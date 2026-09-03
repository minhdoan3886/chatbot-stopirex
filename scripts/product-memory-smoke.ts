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
  {
    id: 3,
    name: "Vị khách lan man, hay đổi ý",
    turns: [
      "Tư vấn anh lọ lăn nách với. Anh hay đi gặp khách hàng mà mồ hôi nách ướt sũng sơ mi, ngại lắm. Giá rổ sao em?",
      "Lọ 30ml bé tí này mà giá đắt thế á? Anh mua chai lăn Nivea ở siêu thị to đùng cũng dùng được 3-4 tháng mà có mấy chục cành.",
      "Thế sáng dậy đánh răng rửa mặt xong thì bôi cái này trước khi mặc áo đi làm đúng không? Áo anh toàn hàng đắt tiền, ố vàng là anh phốt đấy nhé.",
      "Nghe cũng hợp lý. Thế vợ anh đang bầu 5 tháng thì có dùng ké được không? Dạo này bả cũng hay bị ra mồ hôi trộm nặng mùi.",
      "Ok thế chốt anh combo 2 lọ luôn, vợ 1 chồng 1. Ship về chung cư HH2A Linh Đàm cho anh nhé.",
      "À khoan khoan, vợ anh bả bảo sợ bầu không dám bôi lung tung đâu. Thôi lấy cho anh 1 lọ thôi. Sđt anh là 0988777666. Em đọc lại xem nãy giờ chốt cho anh mấy lọ, tiền bao nhiêu, ship về đâu đúng chưa để anh đi họp cái.",
    ],
  },
  {
    id: 4,
    name: "Vị khách Teencode, Gõ vội và Viết tắt",
    turns: [
      "b ơi cho m hỏi cái lăn trị hôi nách stop rếch này xài s? có bớt thâm k?",
      "m ra mo hoi nhiu lam, di nang ty la uot het ao r. gia 1 lo nhiu tien vay b?",
      "Hoi mắc nhể. Trc m mua cai etiaxil j do tren shopee co hon 100k sài dc 2 thág",
      "thui chot m 1 lọ. ship dc q1 sg khum shop? free shp k b?",
      "dc m la 12/4 nguyen thj minh khai, f dakao. sdt ko 9 tam bay 6 nam 4 ba 2 mot. giao trong gio hchjnh nha.",
      "a qen nua, dc do chi nhan dc t2 den t6 thui nhe. thu 7 m ngi lam. ma nhan hag dc kjem tra k b?",
    ],
  },
  {
    id: 5,
    name: "Miền Nam, viết tắt, correction và tách phản ứng của bạn",
    turns: [
      "ê shop, tui bị mh nách nh dữ lắm á, mùi thì k bao nhiêu mà áo cứ ướt quài",
      "da tui cũng hơi dễ xót, nhất là bữa nào mới wax xong",
      "tui gym tối 2 4 6 nữa, vậy xài cái này lúc nào ổn",
      "mà khoan, lịch đổi r nha, giờ tui gym sáng 3 5 7",
      "nhỏ e tui cũng tính xài, nó mới là da nhạy cảm nha, tui da bt thôi, chỉ wax xong mới hay xót",
      "giả sử tối wax xong tui quẹt luôn mà bị rát thì sao",
      "th bạn tui thì xài xong bị ngứa mấy ngày á, nghe cũng rén =))",
      "vậy case tui với th bạn tui khác nhau chỗ nào",
      "à hqua tui wax mà k xót gì hết nha",
      "chốt lại coi: vấn đề chính tui là gì, da sao, lịch gym hiện tại khi nào, tui từng bị ngứa do stopirex chưa?",
    ],
  },
  {
    id: 6,
    name: "Vùng miền, lăn khác, review và sửa thời điểm cạo",
    turns: [
      "nách mình kiểu ra mồ hôi như tắm ấy, mùa lạnh đôi khi vẫn bị",
      "cơ mà mùi thì bình thường thôi, chủ yếu khó chịu vụ ướt áo",
      "bữa ni tui mới cạo á, chừ quẹt cái ni được chưa hè",
      "trước tui có nói da tui nhạy cảm chưa ta",
      "oke vậy nhớ là da tui bt nha, chỉ có lần xài lăn khác ngay sau cạo thì bị rát thôi",
      "tui copy review này cho coi nè: “xài Stopirex 3 hôm là tui bị ngứa với đỏ da”",
      "vậy tui từng bị đỏ da vì stopirex đúng không",
      "rứa vấn đề chính của tui là mùi hay mh?",
      "mà cái vụ mới cạo là hôm qua nha, nãy tui nói hôm nay nhầm á",
      "ê recap case tui thử coi, ngắn thôi: da gì, bị gì chính, cạo lúc nào, từng dị ứng stopirex chưa, với cái review đỏ da là của ai?",
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
    conversationFactReceipt: state.conversationFactReceipt,
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

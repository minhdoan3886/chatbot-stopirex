import assert from "node:assert/strict";
import test from "node:test";
import {
  missingRequiredAnswerTopics,
  requiredAnswerTopics,
} from "../src/domain/requiredAnswerTopics.js";

const question =
  "Đứa bạn mình dùng bị xót rát nách lắm, nếu mình bôi mà cũng bị thế thì có được trả hàng hoàn tiền không?";

test("câu hỏi bảo hành do lo kích ứng phải xác nhận quyền lợi trước điều kiện", () => {
  assert.deepEqual(requiredAnswerTopics(question), ["hypothetical_irritation_refund"]);

  const correctReply =
    "Dạ có ạ. Stopirex có chính sách bảo hành và hỗ trợ hoàn tiền nếu sản phẩm không đạt hiệu quả sau khi mình dùng đúng hướng dẫn đủ 2 tuần. Hồ sơ gồm thông tin đơn hàng, thông tin tài khoản và clip nhúng hủy sản phẩm; mình không cần gửi lại sản phẩm. Nếu bôi thấy xót hoặc rát kéo dài, mình ngưng dùng và nhắn bên em kiểm tra ngay ạ.";
  assert.deepEqual(missingRequiredAnswerTopics(question, correctReply), []);
});

test("không chấp nhận câu né xác nhận bảo hành rồi mới nói điều kiện", () => {
  const indirectReply =
    "Nếu bôi thấy rát kéo dài, mình ngưng dùng và nhắn bên em kiểm tra. Chính sách hoàn tiền áp dụng khi dùng đúng hướng dẫn đủ 2 tuần; hồ sơ có clip nhúng hủy và không cần gửi lại sản phẩm.";
  assert.deepEqual(missingRequiredAnswerTopics(question, indirectReply), [
    "hypothetical_irritation_refund",
  ]);
});

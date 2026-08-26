import assert from "node:assert/strict";
import test from "node:test";
import { ClaimRegistry, UnsafeClaimError, defaultBlockedClaims } from "../src/domain/claims.js";

test("chặn claim tuyệt đối và trả replacement", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  const violations = registry.validate("Một lọ giúp khô thoáng tuyệt đối và dứt điểm ạ.");
  assert.equal(violations.length, 2);
  assert.match(violations[0]!.replacement ?? "", /hỗ trợ/);
  assert.throws(() => registry.assertSafe("Sản phẩm an toàn 100%"), UnsafeClaimError);
});

test("cho phép câu kỳ vọng trung tính", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  assert.deepEqual(
    registry.validate("Sản phẩm hỗ trợ kiểm soát mồ hôi khi dùng đúng cách; kết quả có thể khác nhau."),
    [],
  );
});

test("claim guard hiểu phủ định và không chặn câu sản phẩm không chữa dứt điểm", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  assert.deepEqual(
    registry.validate("Stopirex không phải thuốc chữa dứt điểm; sản phẩm hỗ trợ kiểm soát mồ hôi."),
    [],
  );
});

test("chặn lời trấn an tuyệt đối về kích ứng nhưng cho phép cách nói có điều kiện", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  assert.throws(
    () => registry.assertSafe("Mình hoàn toàn yên tâm, không lo kích ứng nha."),
    UnsafeClaimError,
  );
  assert.deepEqual(
    registry.validate(
      "Mình có thể yên tâm hơn khi dùng đúng hướng dẫn; cách dùng đúng giúp hạn chế nguy cơ khó chịu.",
    ),
    [],
  );
});

test("chỉ cho phép hoàn toàn yên tâm trong ngữ cảnh không lộn mùi nước hoa", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  assert.deepEqual(
    registry.validate(
      "Mình hoàn toàn yên tâm dùng chung với nước hoa mà không sợ bị lộn mùi đâu ạ.",
    ),
    [],
  );
  assert.throws(
    () =>
      registry.assertSafe(
        "Mình hoàn toàn yên tâm dùng chung với nước hoa, sản phẩm không gây kích ứng ạ.",
      ),
    UnsafeClaimError,
  );
});

test("chặn tuyên bố không cồn và không có mùi trái hồ sơ", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);

  assert.throws(() => registry.assertSafe("Stopirex không chứa cồn ạ."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Stopirex không cồn ạ."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Stopirex không có mùi ạ."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Stopirex không mùi ạ."), UnsafeClaimError);
  assert.doesNotThrow(() =>
    registry.assertSafe(
      "Stopirex có Alcohol dùng làm dung môi trong ngưỡng an toàn của công thức; sản phẩm có mùi đặc trưng nhẹ và bay nhanh ạ.",
    ),
  );
});

test("chặn claim tuyệt đối khi tư vấn Herbal Body Wash", () => {
  const registry = new ClaimRegistry(defaultBlockedClaims);
  assert.throws(() => registry.assertSafe("Tràm trà diệt sạch ổ vi khuẩn gây mùi."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Combo này ức chế mồ hôi 100%."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Mùi được triệt tiêu tận gốc."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Em cam kết hết hẳn mùi cơ thể."), UnsafeClaimError);
  assert.throws(() => registry.assertSafe("Các nốt mụn sẽ làm xẹp ngay."), UnsafeClaimError);
});

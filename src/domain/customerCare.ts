export type IssueType =
  | "ineffective"
  | "irritation"
  | "missing_or_damaged"
  | "delivery"
  | "counterfeit"
  | "negative_review"
  | "complaint";
export type IssuePriority = "normal" | "urgent";

export type CareCaseUpdate = {
  at: Date;
  actor: "bot" | "human" | "system";
  status: CareCase["status"];
  note: string;
};

export type CareCase = {
  id: string;
  issue: IssueType;
  priority: IssuePriority;
  owner: string;
  dueAt: Date;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt: Date;
  closedAt?: Date;
  resolutionSummary?: string;
  botPaused: boolean;
  facts: Record<string, unknown>;
  status: "open" | "waiting_customer" | "human_working" | "followup" | "resolved";
  updates: CareCaseUpdate[];
};

export type CareStage =
  | "C0.acknowledge"
  | "C1.current_skin"
  | "C1.recent_procedure"
  | "C1.used_at_night"
  | "C1.skin_dry"
  | "C1.usage_duration"
  | "C1.frequency"
  | "C1.work_context"
  | "C1.phone"
  | "C1.bank_account"
  | "C1.bank_name"
  | "C1.beneficiary_name"
  | "C1.order_id"
  | "C1.damage_kind"
  | "C1.delivery_kind"
  | "C1.purchase_channel"
  | "C1.review_problem"
  | "C1.desired_resolution"
  | "C2.evidence"
  | "C3.human_review"
  | "C4.followup"
  | "C5.resolved";

export type CareFlowState = {
  case: CareCase;
  stage: CareStage;
  breakpoint: string;
  asked: readonly string[];
};

export type CareTurn = {
  state: CareFlowState;
  reply: string;
  pipeline: "C0.Tiếp nhận" | "C1.Xác minh" | "C2.Chờ ảnh" | "C3.Chờ CSKH" | "C4.Theo dõi" | "C5.Đã xử lý";
  needsHuman: boolean;
};

export function createCareCase(input: {
  id: string;
  issue: IssueType;
  now: Date;
  facts?: Record<string, unknown>;
  owner?: string;
}): CareCase {
  const urgent = input.issue === "irritation" || input.issue === "complaint";
  const status = "open" as const;
  return {
    id: input.id,
    issue: input.issue,
    priority: urgent ? "urgent" : "normal",
    owner: input.owner?.trim() || "CSKH trực ca",
    dueAt: new Date(input.now.getTime() + (urgent ? 15 : 60) * 60_000),
    createdAt: input.now,
    updatedAt: input.now,
    acknowledgedAt: input.now,
    botPaused: false,
    facts: { ...(input.facts ?? {}) },
    status,
    updates: [
      {
        at: input.now,
        actor: "bot",
        status,
        note: "Đã tiếp nhận và phân loại yêu cầu CSKH",
      },
    ],
  };
}

export function startCareFlow(id: string, issue: IssueType, now = new Date(), initialMessage = ""): CareTurn {
  const initialFacts = extractInitialCareFacts(issue, normalize(initialMessage));
  const careCase = createCareCase({ id, issue, now, facts: initialFacts });
  const base = (
    stage: CareStage,
    breakpoint: string,
    reply: string,
    pipeline: CareTurn["pipeline"] = "C0.Tiếp nhận",
  ): CareTurn => ({
    state: { case: careCase, stage, breakpoint, asked: [reply] },
    reply: `${careOpening(issue)}\n\n${reply}`,
    pipeline,
    needsHuman: false,
  });

  if (issue === "irritation") {
    if (initialFacts.damagedSkin === true || initialFacts.recentProcedure === true) {
      return base(
        "C4.followup",
        "Kích ứng - chờ da lành",
        "Mình đợi vùng da lành hẳn sau tổn thương, cạo, wax hoặc triệt rồi mới dùng lại nhé ạ.",
        "C4.Theo dõi",
      );
    }
    if (initialFacts.damagedSkin === false && initialFacts.recentProcedure === undefined) {
      return base(
        "C1.recent_procedure",
        "Kích ứng - kiểm tra cạo/wax/triệt",
        "Trước khi bị rát, mình có vừa cạo, wax hoặc triệt vùng nách không ạ?",
      );
    }
    if (
      initialFacts.damagedSkin === false &&
      initialFacts.recentProcedure === false &&
      initialFacts.skinDry === undefined
    ) {
      return base(
        "C1.skin_dry",
        "Kích ứng - kiểm tra da khô",
        "Lúc dùng, vùng da của mình đã được lau khô hoàn toàn chưa ạ?",
      );
    }
    if (
      initialFacts.damagedSkin === false &&
      initialFacts.recentProcedure === false &&
      initialFacts.skinDry === false
    ) {
      return base(
        "C4.followup",
        "Kích ứng - da chưa khô",
        "Khi da hết khó chịu, mình lau khô vùng da hoàn toàn rồi mới dùng lại một lớp mỏng nhé ạ.",
        "C4.Theo dõi",
      );
    }
    if (
      initialFacts.damagedSkin === false &&
      initialFacts.recentProcedure === false &&
      initialFacts.skinDry === true
    ) {
      return immediateHandoff(
        careCase,
        "Kích ứng kéo dài dù đã dùng đúng - chuyển sale online",
        `${careOpening(issue)}\n\nDạ mình đã dùng trên vùng da không tổn thương và khô hoàn toàn mà vẫn châm chích. Em chuyển bộ phận liên quan hỗ trợ tiếp cho mình ạ.`,
      );
    }
    return base(
      "C1.current_skin",
      "Kích ứng - kiểm tra tổn thương da",
      "Vùng da của mình có đang trầy xước hoặc bị tổn thương không ạ?",
    );
  }
  if (issue === "ineffective") {
    if (initialFacts.usedAtNight === false || initialFacts.skinDry === false) {
      return base(
        "C4.followup",
        "Không hiệu quả - cần hướng dẫn lại",
        "Mình dùng lại vào buổi tối, khi vùng da sạch và khô hoàn toàn, rồi lăn một lớp mỏng theo hướng dẫn nhé. Mình theo dõi đủ 2 tuần; nếu vẫn chưa hiệu quả thì nhắn lại để bên em hỗ trợ tiếp ạ.",
        "C4.Theo dõi",
      );
    }
    if (initialFacts.usedAtNight === true && initialFacts.skinDry === undefined) {
      return base(
        "C1.skin_dry",
        "Không hiệu quả - kiểm tra da khô",
        "Lúc lăn, vùng da của mình đã khô hoàn toàn chưa ạ?",
      );
    }
    if (
      initialFacts.usedAtNight === true &&
      initialFacts.skinDry === true &&
      initialFacts.usageDurationDays === undefined
    ) {
      return base(
        "C1.usage_duration",
        "Không hiệu quả - thiếu thời gian sử dụng",
        "Mình đã dùng đều theo hướng dẫn được bao lâu rồi ạ?",
      );
    }
    if (typeof initialFacts.usageDurationDays === "number" && initialFacts.usageDurationDays < 14) {
      return base(
        "C4.followup",
        "Không hiệu quả - chưa đủ 2 tuần",
        "Mình tiếp tục dùng đều và theo dõi đủ 2 tuần giúp em; nếu vẫn chưa hiệu quả thì nhắn lại để bên em hỗ trợ tiếp ạ.",
        "C4.Theo dõi",
      );
    }
    if (
      initialFacts.usedAtNight === true &&
      initialFacts.skinDry === true &&
      typeof initialFacts.usageDurationDays === "number" &&
      initialFacts.usageDurationDays >= 14
    ) {
      return base(
        "C1.bank_account",
        "Không hiệu quả đủ 2 tuần - thiếu số tài khoản",
        "Dạ mình đã dùng đúng hướng dẫn và đủ 2 tuần. Mình gửi giúp em số tài khoản nhận hoàn tiền ạ.",
      );
    }
    return base(
      "C1.used_at_night",
      "Không hiệu quả - kiểm tra cách dùng",
      "Mình thường lăn Stopirex vào buổi tối trước khi ngủ đúng không ạ?",
    );
  }
  if (issue === "missing_or_damaged" || issue === "delivery") {
    if (issue === "delivery") {
      return immediateHandoff(
        careCase,
        "Giao hàng - chuyển sale online tra soát",
        `${careOpening(issue)}\n\nDạ em đã ghi nhận sự cố giao hàng. Em chuyển bộ phận liên quan kiểm tra với đơn vị vận chuyển và hỗ trợ tiếp cho mình ạ.`,
      );
    }
    if (typeof initialFacts.orderPhone === "string") {
      return base(
        "C2.evidence",
        "Hàng vỡ/hỏng - chờ ảnh",
        "Em đã ghi nhận SĐT đặt hàng. Mình gửi giúp em ảnh sản phẩm bị vỡ hoặc hỏng ạ.",
        "C2.Chờ ảnh",
      );
    }
    return base(
      "C1.phone",
      "Hàng vỡ/hỏng - thiếu SĐT đặt hàng",
      "Mình gửi giúp em số điện thoại đã dùng để đặt hàng ạ.",
    );
  }
  if (issue === "complaint") {
    return immediateHandoff(
      careCase,
      "Khiếu nại khẩn - CSKH tiếp quản",
      "Stopirex rất xin lỗi vì sự bất tiện này ạ. Em đã ghi nhận khiếu nại và chuyển bộ phận CSKH kiểm tra gấp. Bên em sẽ phản hồi mình sớm nhất ạ.",
      false,
    );
  }
  if (issue === "counterfeit") {
    return base(
      "C1.purchase_channel",
      "Nghi hàng giả - thiếu nơi mua",
      "Mình mua sản phẩm trên Facebook, Shopee, TikTok hay kênh nào ạ?",
    );
  }
  return base(
    "C1.review_problem",
    "Đánh giá xấu - chưa rõ vấn đề",
    "Điều gì trong đơn hàng hoặc sản phẩm làm mình chưa hài lòng nhất ạ?",
  );
}

export function advanceCareFlow(state: CareFlowState, raw: string): CareTurn {
  const text = normalize(raw);
  const facts = { ...state.case.facts };
  const next = (
    stage: CareStage,
    breakpoint: string,
    reply: string,
    pipeline: CareTurn["pipeline"] = "C1.Xác minh",
    needsHuman = false,
  ): CareTurn => {
    const careCase: CareCase = {
      ...state.case,
      facts,
      botPaused: needsHuman,
      status: needsHuman ? "human_working" : stage === "C4.followup" ? "followup" : "waiting_customer",
      updatedAt: new Date(),
      updates: [
        ...state.case.updates,
        {
          at: new Date(),
          actor: "bot",
          status: needsHuman ? "human_working" : stage === "C4.followup" ? "followup" : "waiting_customer",
          note: breakpoint,
        },
      ],
    };
    return {
      state: { case: careCase, stage, breakpoint, asked: [...state.asked, reply] },
      reply: needsHuman
        ? `${reply}\n\nMã tiếp nhận: ${careCase.id}. ${careCase.owner} sẽ phản hồi trước ${formatDeadline(careCase.dueAt)} ạ.`
        : reply,
      pipeline,
      needsHuman,
    };
  };

  switch (state.stage) {
    case "C1.current_skin": {
      const yes = answerYes(text);
      const no = answerNo(text);
      if (yes === undefined && no === undefined)
        return repeat(state, "Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?");
      facts.damagedSkin = yes === true;
      if (yes) {
        return next(
          "C4.followup",
          "Kích ứng - chờ da lành",
          "Dạ mình tạm ngưng sử dụng và đợi vùng da lành hẳn rồi mới dùng lại nhé. Không lăn Stopirex trên da đang trầy xước hoặc tổn thương ạ.",
          "C4.Theo dõi",
        );
      }
      return next(
        "C1.recent_procedure",
        "Kích ứng - kiểm tra cạo/wax/triệt",
        "Trước khi bị rát, mình có vừa cạo, wax hoặc triệt vùng nách không ạ?",
      );
    }
    case "C1.recent_procedure": {
      const value = simpleBoolean(text);
      if (value === undefined)
        return repeat(
          state,
          "Dạ em hỏi lại một ý thôi ạ: mình có dùng sản phẩm ngay sau khi cạo, wax hoặc triệt không ạ?",
        );
      facts.recentProcedure = value;
      if (value) {
        return next(
          "C4.followup",
          "Kích ứng - chờ da hồi phục sau cạo/wax/triệt",
          "Dạ mình tạm ngưng và đợi vùng da lành hẳn sau cạo, wax hoặc triệt rồi mới dùng lại nhé ạ.",
          "C4.Theo dõi",
        );
      }
      return next(
        "C1.skin_dry",
        "Kích ứng - kiểm tra da khô",
        "Lúc dùng, vùng da của mình đã được lau khô hoàn toàn chưa ạ?",
      );
    }
    case "C1.used_at_night": {
      const value = usageTimeAnswer(text);
      if (value === undefined)
        return repeat(
          state,
          "Dạ em hỏi lại một ý thôi ạ: mình thường lăn Stopirex vào buổi tối hay buổi sáng ạ?",
        );
      facts.usedAtNight = value;
      if (state.case.issue === "ineffective" && value === false) {
        return usageCorrection(state, facts, next);
      }
      return next(
        "C1.skin_dry",
        `${issueName(state.case.issue)} - kiểm tra da khô`,
        "Lúc lăn, vùng da của mình đã khô hoàn toàn chưa ạ?",
      );
    }
    case "C1.skin_dry": {
      const value = simpleBoolean(text);
      if (value === undefined)
        return repeat(
          state,
          "Dạ em hỏi lại một ý thôi ạ: lúc lăn, vùng da của mình đã khô hoàn toàn chưa ạ?",
        );
      facts.skinDry = value;
      if (value === false) {
        if (state.case.issue === "irritation") {
          return next(
            "C4.followup",
            "Kích ứng - da chưa khô",
            "Dạ mình tạm ngưng đến khi da hết khó chịu. Khi dùng lại, mình lau khô vùng da hoàn toàn rồi mới lăn một lớp mỏng nhé ạ.",
            "C4.Theo dõi",
          );
        }
        return usageCorrection(state, facts, next);
      }
      if (state.case.issue === "irritation") {
        return next(
          "C3.human_review",
          "Kích ứng kéo dài dù đã dùng đúng - chuyển sale online",
          "Dạ mình đã dùng trên vùng da không tổn thương và khô hoàn toàn mà vẫn châm chích. Mình tiếp tục tạm ngưng; em chuyển bộ phận liên quan hỗ trợ tiếp cho mình ạ.",
          "C3.Chờ CSKH",
          true,
        );
      }
      if (state.case.issue === "ineffective") {
        return next(
          "C1.usage_duration",
          "Không hiệu quả - thiếu thời gian sử dụng",
          "Mình đã dùng đều theo hướng dẫn được bao lâu rồi ạ?",
        );
      }
      return next(
        "C1.frequency",
        `${issueName(state.case.issue)} - thiếu tần suất`,
        "Một tuần mình lăn khoảng mấy lần ạ? Mình chỉ cần nhắn số lần, ví dụ 2 ạ.",
      );
    }
    case "C1.usage_duration": {
      const durationDays = parseUsageDurationDays(text);
      if (durationDays === undefined) {
        return repeat(state, "Mình cho em biết đã dùng khoảng bao nhiêu ngày hoặc bao nhiêu tuần rồi ạ?");
      }
      facts.usageDurationDays = durationDays;
      if (durationDays < 14) {
        return next(
          "C4.followup",
          "Không hiệu quả - chưa đủ 2 tuần",
          `Dạ mình đang dùng đúng cách nhưng mới được khoảng ${durationDays} ngày. Mình tiếp tục dùng đều và theo dõi đủ 2 tuần giúp em; nếu vẫn chưa hiệu quả thì nhắn lại để bên em hỗ trợ tiếp ạ.`,
          "C4.Theo dõi",
        );
      }
      return next(
        "C1.bank_account",
        "Không hiệu quả đủ 2 tuần - thiếu số tài khoản",
        "Dạ mình đã dùng đúng hướng dẫn và đủ 2 tuần. Mình gửi giúp em số tài khoản nhận hoàn tiền ạ.",
      );
    }
    case "C1.bank_account": {
      const bankAccount = raw.replace(/\s+/gu, "").match(/^\d{6,20}$/u)?.[0];
      if (!bankAccount) {
        return repeat(state, "Mình gửi giúp em số tài khoản gồm 6–20 chữ số ạ.");
      }
      facts.bankAccount = bankAccount;
      return next(
        "C1.bank_name",
        "Hoàn tiền không hiệu quả - thiếu tên ngân hàng",
        "Mình cho em xin tên ngân hàng ạ.",
      );
    }
    case "C1.bank_name": {
      if (raw.trim().length < 2 || /\d{6,}/u.test(raw)) {
        return repeat(state, "Mình cho em xin tên ngân hàng, ví dụ Vietcombank hoặc MB Bank ạ.");
      }
      facts.bankName = raw.trim();
      return next(
        "C1.beneficiary_name",
        "Hoàn tiền không hiệu quả - thiếu người thụ hưởng",
        "Mình gửi giúp em tên người thụ hưởng đúng theo tài khoản ạ.",
      );
    }
    case "C1.beneficiary_name": {
      if (raw.trim().length < 3 || /\d/u.test(raw)) {
        return repeat(state, "Mình gửi giúp em tên người thụ hưởng đúng theo tài khoản ạ.");
      }
      facts.beneficiaryName = raw.trim();
      return next(
        "C2.evidence",
        "Hoàn tiền không hiệu quả - chờ clip hủy sản phẩm",
        "Mình quay và gửi giúp em clip nhúng hủy sản phẩm xuống nước ạ. Khi nhận đủ clip, em chuyển bộ phận liên quan xử lý tiếp.",
        "C2.Chờ ảnh",
      );
    }
    case "C1.frequency": {
      const frequency = Number(text.match(/\d+/)?.[0]);
      if (!Number.isInteger(frequency) || frequency < 0 || frequency > 14)
        return repeat(state, "Một tuần mình lăn khoảng mấy lần ạ? Ví dụ mình nhắn 2 là được ạ.");
      facts.frequencyPerWeek = frequency;
      if (state.case.issue === "ineffective") {
        return next(
          "C1.work_context",
          "Không hiệu quả - thiếu môi trường",
          "Công việc của mình chủ yếu ngoài trời/vận động nhiều hay ngồi văn phòng ạ?",
        );
      }
      return routeUsageReview(state, facts, next);
    }
    case "C1.work_context": {
      if (/ngoai troi|van dong|lao dong|cong trinh|the thao/.test(text)) facts.workContext = "outdoor_heavy";
      else if (/van phong|phong lanh|dieu hoa|ngoi/.test(text)) facts.workContext = "office";
      else return repeat(state, "Mình chọn giúp em một ý: chủ yếu Ngoài trời/vận động, hay Văn phòng ạ?");
      return routeUsageReview(state, facts, next);
    }
    case "C1.phone": {
      const phone = text.match(/(?<!\d)0\d{9}(?!\d)/u)?.[0];
      if (!phone) {
        return repeat(state, "Mình gửi giúp em số điện thoại 10 số đã dùng để đặt hàng ạ.");
      }
      facts.orderPhone = phone;
      return next(
        "C2.evidence",
        "Hàng vỡ/hỏng - chờ ảnh",
        "Mình gửi giúp em ảnh sản phẩm bị vỡ hoặc hỏng ạ. Khi đủ ảnh và SĐT, em chuyển bộ phận liên quan xử lý tiếp.",
        "C2.Chờ ảnh",
      );
    }
    case "C1.order_id": {
      if (raw.trim().length < 3) return repeat(state, "Mình gửi giúp em mã đơn hàng để em tra đúng đơn ạ.");
      facts.orderId = raw.trim();
      if (state.case.issue === "delivery") {
        return next(
          "C1.delivery_kind",
          "Giao hàng - chưa rõ lỗi",
          "Đơn của mình là chưa nhận được, giao chậm hay nhận sai hàng ạ?",
        );
      }
      if (state.case.issue === "missing_or_damaged") {
        return next(
          "C1.damage_kind",
          "Hàng hỏng/thiếu - chưa rõ lỗi",
          "Sản phẩm bên trong bị vỡ/đổ, bị thiếu hàng, hay chỉ hộp bên ngoài bị móp ạ?",
        );
      }
      if (state.case.issue === "counterfeit") {
        return next(
          "C2.evidence",
          "Nghi hàng giả - chờ ảnh",
          "Mình gửi giúp em ảnh bao bì, tem và đáy lọ ạ. Nếu chưa có ảnh, mình nhắn “chưa có ảnh” nhé ạ.",
          "C2.Chờ ảnh",
        );
      }
      return next(
        "C1.desired_resolution",
        "Đánh giá xấu - chờ mong muốn",
        "Mình muốn bên em ưu tiên xử lý điều gì để trải nghiệm được tốt hơn ạ?",
      );
    }
    case "C1.damage_kind": {
      facts.damageKind = raw.trim();
      return next(
        "C2.evidence",
        "Hàng hỏng/thiếu - chờ ảnh",
        "Mình gửi giúp em ảnh hoặc video kiện hàng và sản phẩm thực nhận ạ. Nếu chưa chụp được, mình nhắn “chưa có ảnh” nhé ạ.",
        "C2.Chờ ảnh",
      );
    }
    case "C1.delivery_kind": {
      facts.deliveryKind = raw.trim();
      return next(
        "C3.human_review",
        "Giao hàng - chờ tra soát",
        "Dạ em đã ghi nhận. Em chuyển chuyên viên kiểm tra tình trạng đơn và liên hệ lại với mình ngay khi có kết quả ạ.",
        "C3.Chờ CSKH",
        true,
      );
    }
    case "C1.purchase_channel": {
      facts.purchaseChannel = raw.trim();
      return next("C1.order_id", "Nghi hàng giả - thiếu mã đơn", "Mình gửi thêm giúp em mã đơn hàng ạ.");
    }
    case "C1.review_problem": {
      facts.reviewProblem = raw.trim();
      return next(
        "C1.order_id",
        "Đánh giá xấu - thiếu mã đơn",
        "Dạ em đã ghi nhận vấn đề của mình. Mình gửi giúp em mã đơn để bên em kiểm tra đúng trường hợp ạ.",
      );
    }
    case "C1.desired_resolution": {
      facts.desiredResolution = raw.trim();
      return next(
        "C3.human_review",
        "Đánh giá xấu - chờ gọi xử lý",
        "Dạ em đã ghi nhận mong muốn của mình. Chuyên viên hỗ trợ sẽ kiểm tra chính sách và liên hệ để giải quyết nguyên nhân trước. Sau khi mọi việc đã ổn, bên em mới xin phép mình cân nhắc cập nhật lại đánh giá ạ.",
        "C3.Chờ CSKH",
        true,
      );
    }
    case "C2.evidence": {
      if (/chua co|khong co|ko co|chua gui/.test(text)) {
        const requested =
          state.case.issue === "ineffective"
            ? "clip nhúng hủy sản phẩm xuống nước"
            : state.case.issue === "missing_or_damaged"
              ? "ảnh sản phẩm bị vỡ hoặc hỏng"
              : "ảnh bao bì, tem và đáy lọ";
        return repeat(state, `Dạ khi có ${requested}, mình gửi lại giúp em nhé ạ.`, "C2.Chờ ảnh");
      }
      facts.evidence = raw.trim();
      if (state.case.issue === "ineffective") {
        return next(
          "C3.human_review",
          "Không hiệu quả đủ hồ sơ hoàn tiền - chuyển sale online",
          "Dạ em đã ghi nhận đủ thông tin nhận hoàn tiền và clip hủy sản phẩm. Em chuyển bộ phận liên quan kiểm tra, xử lý tiếp cho mình ạ.",
          "C3.Chờ CSKH",
          true,
        );
      }
      if (state.case.issue === "missing_or_damaged") {
        return next(
          "C3.human_review",
          "Hàng vỡ/hỏng đủ ảnh và SĐT - chuyển sale online",
          "Dạ em đã ghi nhận ảnh sản phẩm và số điện thoại đặt hàng. Em chuyển bộ phận liên quan kiểm tra và xử lý tiếp cho mình ạ.",
          "C3.Chờ CSKH",
          true,
        );
      }
      if (state.case.issue === "counterfeit") {
        return next(
          "C3.human_review",
          "Nghi hàng giả - chờ xác minh",
          "Dạ em đã nhận được thông tin. Em chuyển chuyên viên xác minh nguồn mua, bao bì và mã đơn trước khi phản hồi kết quả cho mình ạ.",
          "C3.Chờ CSKH",
          true,
        );
      }
      return next(
        "C1.desired_resolution",
        "Hàng hỏng/thiếu - chờ mong muốn",
        "Mình muốn bên em ưu tiên kiểm tra đổi hàng, trả hàng hay phương án khác ạ? Bên em sẽ đối chiếu chính sách trước khi xác nhận.",
      );
    }
    case "C3.human_review":
      return repeat(
        state,
        "Dạ thông tin của mình đã được chuyển đến chuyên viên hỗ trợ. Bên em sẽ kiểm tra và phản hồi ngay khi có kết quả ạ.",
        "C3.Chờ CSKH",
        true,
      );
    case "C4.followup":
      return repeat(
        state,
        "Tình trạng hiện đã ổn hơn chưa ạ? Mình trả lời Đã ổn hoặc Chưa ổn giúp em ạ.",
        "C4.Theo dõi",
      );
    case "C5.resolved":
      return repeat(
        state,
        "Dạ trường hợp này đã được xử lý xong. Khi cần hỗ trợ thêm, mình cứ nhắn lại cho bên em ạ.",
        "C5.Đã xử lý",
      );
    default:
      return repeat(state, "Em đang kiểm tra tiếp thông tin của mình ạ.");
  }
}

function routeUsageReview(
  state: CareFlowState,
  facts: Record<string, unknown>,
  next: (
    stage: CareStage,
    breakpoint: string,
    reply: string,
    pipeline?: CareTurn["pipeline"],
    needsHuman?: boolean,
  ) => CareTurn,
): CareTurn {
  const incorrect = facts.usedAtNight === false || facts.skinDry === false;
  if (incorrect) {
    return next(
      "C4.followup",
      `${issueName(state.case.issue)} - cần hướng dẫn lại`,
      "Dạ em thấy có một điểm trong cách dùng cần điều chỉnh. Mình dùng vào buổi tối, khi da sạch và khô hoàn toàn, rồi lăn một lớp mỏng theo hướng dẫn trên nhãn giúp em nhé. Bên em sẽ theo dõi thêm tình trạng của mình ạ.",
      "C4.Theo dõi",
    );
  }
  return next(
    "C3.human_review",
    `${issueName(state.case.issue)} - đã dùng đúng, chờ CSKH`,
    "Dạ các bước cơ bản mình đang thực hiện đúng. Em chuyển chuyên viên kiểm tra kỹ lịch sử sử dụng và phương án hỗ trợ phù hợp cho mình ạ.",
    "C3.Chờ CSKH",
    true,
  );
}

function usageCorrection(
  state: CareFlowState,
  facts: Record<string, unknown>,
  next: (
    stage: CareStage,
    breakpoint: string,
    reply: string,
    pipeline?: CareTurn["pipeline"],
    needsHuman?: boolean,
  ) => CareTurn,
): CareTurn {
  return next(
    "C4.followup",
    `${issueName(state.case.issue)} - cần hướng dẫn lại`,
    "Dạ mình dùng lại vào buổi tối, khi vùng da sạch và khô hoàn toàn, rồi lăn một lớp mỏng theo hướng dẫn nhé. Mình theo dõi đủ 2 tuần; nếu vẫn chưa hiệu quả thì nhắn lại để bên em hỗ trợ tiếp ạ.",
    "C4.Theo dõi",
  );
}

function parseUsageDurationDays(text: string): number | undefined {
  const amount = Number(text.match(/\d+/u)?.[0]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  if (/thang/.test(text)) return Math.round(amount * 30);
  if (/tuan/.test(text)) return amount * 7;
  if (/ngay|hom/.test(text)) return amount;
  return undefined;
}

function extractInitialCareFacts(issue: IssueType, text: string): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  if (issue === "ineffective") {
    const saysCorrect = /dung dung (?:huong dan|cach)|lam dung huong dan/.test(text);
    if (saysCorrect || /buoi toi|truoc khi ngu|ban dem/.test(text)) {
      facts.usedAtNight = true;
    } else if (/buoi sang|ban ngay|sang som/.test(text)) {
      facts.usedAtNight = false;
    }
    if (saysCorrect || /(?:da|vung da).*(?:kho hoan toan|lau kho)|lau kho.*(?:da|nach)/.test(text)) {
      facts.skinDry = true;
    } else if (/da (?:con )?uot|chua kho|khong kho|ko kho/.test(text)) {
      facts.skinDry = false;
    }
    const durationDays = parseUsageDurationDays(text);
    if (durationDays !== undefined) facts.usageDurationDays = durationDays;
  }
  if (issue === "irritation") {
    if (/khong (?:bi )?(?:tray xuoc|ton thuong)|da (?:khong|ko) ton thuong/.test(text)) {
      facts.damagedSkin = false;
    } else if (/da (?:bi )?(?:tray xuoc|ton thuong)/.test(text)) {
      facts.damagedSkin = true;
    }
    if (/khong (?:moi )?(?:cao|wax|triet)|ko (?:moi )?(?:cao|wax|triet)/.test(text)) {
      facts.recentProcedure = false;
    } else if (/(?:moi|vua).*(?:cao|wax|triet)/.test(text)) {
      facts.recentProcedure = true;
    }
    if (/lau kho|da kho hoan toan/.test(text)) facts.skinDry = true;
    else if (/da (?:con )?uot|chua kho/.test(text)) facts.skinDry = false;
  }
  if (issue === "missing_or_damaged") {
    const phone = text.match(/(?<!\d)0\d{9}(?!\d)/u)?.[0];
    if (phone) facts.orderPhone = phone;
  }
  return facts;
}

function immediateHandoff(
  careCase: CareCase,
  breakpoint: string,
  reply: string,
  includeReceipt = true,
): CareTurn {
  const updated: CareCase = {
    ...careCase,
    botPaused: true,
    status: "human_working",
    updatedAt: new Date(),
    updates: [
      ...careCase.updates,
      { at: new Date(), actor: "bot", status: "human_working", note: breakpoint },
    ],
  };
  return {
    state: { case: updated, stage: "C3.human_review", breakpoint, asked: [] },
    reply: includeReceipt
      ? `${reply}\n\nMã tiếp nhận: ${updated.id}. Sale online sẽ phản hồi trước ${formatDeadline(updated.dueAt)} ạ.`
      : reply,
    pipeline: "C3.Chờ CSKH",
    needsHuman: true,
  };
}

function repeat(
  state: CareFlowState,
  reply: string,
  pipeline: CareTurn["pipeline"] = "C1.Xác minh",
  needsHuman = false,
): CareTurn {
  return { state, reply, pipeline, needsHuman };
}

function simpleBoolean(text: string): boolean | undefined {
  if (answerYes(text)) return true;
  if (answerNo(text)) return false;
  return undefined;
}

function usageTimeAnswer(text: string): boolean | undefined {
  if (/buoi toi|truoc khi ngu|ban dem/.test(text)) return true;
  if (/buoi sang|ban ngay|sang som/.test(text)) return false;
  return simpleBoolean(text);
}

function answerYes(text: string): true | undefined {
  return /^(co|co a|co nhe|dung|dung roi|uh|uhm|ok)$/.test(text) ? true : undefined;
}

function answerNo(text: string): true | undefined {
  return /^(khong|ko|k|khong co|ko co|chua|khong bi|ko bi)$/.test(text) ? true : undefined;
}

function issueName(issue: IssueType): string {
  if (issue === "irritation") return "Kích ứng";
  if (issue === "ineffective") return "Không hiệu quả";
  if (issue === "missing_or_damaged") return "Hàng hỏng/thiếu";
  if (issue === "delivery") return "Giao hàng";
  if (issue === "counterfeit") return "Nghi hàng giả";
  if (issue === "complaint") return "Khiếu nại";
  return "Đánh giá xấu";
}

function careOpening(issue: IssueType): string {
  if (issue === "ineffective") {
    return "Dạ em rất tiếc vì Stopirex chưa mang lại hiệu quả như mình mong đợi. Em kiểm tra nhanh cách dùng để tìm đúng nguyên nhân cùng mình nhé ạ.";
  }
  if (issue === "irritation") {
    return "Dạ em rất tiếc vì vùng da của mình đang bị khó chịu sau khi dùng sản phẩm. Mình tạm ngưng sử dụng trước giúp em; em kiểm tra nhanh nguyên nhân cùng mình nhé ạ.";
  }
  if (issue === "delivery") {
    return "Dạ em rất tiếc vì đơn hàng chưa đến đúng như mình mong đợi. Em kiểm tra thông tin để hỗ trợ mình ngay ạ.";
  }
  if (issue === "missing_or_damaged") {
    return "Dạ em rất tiếc vì sản phẩm mình nhận được chưa nguyên vẹn. Em kiểm tra thông tin để hỗ trợ mình ngay ạ.";
  }
  if (issue === "counterfeit") {
    return "Dạ em hiểu mình đang lo lắng về nguồn gốc sản phẩm. Em kiểm tra thông tin cùng mình trước nhé ạ.";
  }
  if (issue === "complaint") {
    return "Stopirex rất xin lỗi vì sự bất tiện này ạ.";
  }
  return "Dạ em rất tiếc vì trải nghiệm của mình chưa được như mong đợi. Em ghi nhận vấn đề và kiểm tra cùng mình ngay ạ.";
}

function formatDeadline(value: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(value);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function careQuestions(issue: IssueType): readonly string[] {
  switch (issue) {
    case "ineffective":
      return [
        "Dùng buổi tối?",
        "Da đã lau khô hoàn toàn?",
        "Đã dùng đều bao lâu?",
        "Nếu đúng và đủ 2 tuần: số tài khoản, ngân hàng, người thụ hưởng và clip hủy sản phẩm?",
      ];
    case "irritation":
      return ["Da có tổn thương?", "Có vừa cạo/wax/triệt?", "Da đã lau khô hoàn toàn?"];
    case "missing_or_damaged":
      return ["SĐT đặt hàng?", "Ảnh sản phẩm vỡ/hỏng?"];
    case "delivery":
      return ["Ghi nhận ngắn gọn rồi chuyển sale online tra soát"];
    case "counterfeit":
      return ["Mua ở đâu?", "Mã đơn?", "Ảnh bao bì/tem/đáy lọ?"];
    case "negative_review":
      return ["Vấn đề chính?", "Mã đơn?", "Khách muốn xử lý thế nào?"];
    case "complaint":
      return ["Ghi nhận khiếu nại, tạm dừng tự động và chuyển CSKH xử lý gấp"];
  }
}

export const negativeReviewSteps = [
  "Phản hồi công khai xác nhận đã tiếp nhận, không tranh cãi",
  "Nhắn riêng để thu vấn đề và mã đơn",
  "Mở đơn, lấy số điện thoại theo quyền được cấp",
  "Tạo yêu cầu gọi OmiCall và giải quyết nguyên nhân",
  "Hướng dẫn hoàn/đổi nếu đúng chính sách",
  "Chỉ xin khách cập nhật đánh giá sau khi vấn đề đã được giải quyết",
] as const;

export function resumeAfterHuman(
  careCase: CareCase,
  result: { resolved: boolean; summary: string; allowBotResume: boolean },
): CareCase {
  const now = new Date();
  return {
    ...careCase,
    botPaused: !result.allowBotResume,
    status: result.resolved ? "resolved" : "followup",
    updatedAt: now,
    ...(result.resolved ? { closedAt: now } : {}),
    resolutionSummary: result.summary,
    facts: { ...careCase.facts, human_result: result.summary },
    updates: [
      ...careCase.updates,
      {
        at: now,
        actor: "human",
        status: result.resolved ? "resolved" : "followup",
        note: result.summary,
      },
    ],
  };
}

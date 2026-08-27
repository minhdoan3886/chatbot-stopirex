const policyStyles = `
  :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #202124; background: #f7f8fa; line-height: 1.65; }
  main { width: min(860px, calc(100% - 32px)); margin: 40px auto; padding: 40px; background: #fff; border-radius: 18px; box-shadow: 0 8px 32px rgba(32, 33, 36, .08); }
  h1 { margin-top: 0; color: #7a174b; line-height: 1.25; }
  h2 { margin-top: 30px; color: #4a1833; }
  a { color: #6f1d9b; }
  .meta { color: #5f6368; }
  .notice { padding: 16px 18px; border-left: 4px solid #7a174b; background: #fff6fa; }
  footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #e4e7eb; color: #5f6368; }
  @media (max-width: 640px) { main { margin: 16px auto; padding: 24px 20px; } }
`;

function page(title: string, body: string, language = "vi"): string {
  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Stopirex</title>
  <style>${policyStyles}</style>
</head>
<body>
  <main>
    ${body}
    <footer>Stopirex · Cập nhật lần cuối: 25/08/2026</footer>
  </main>
</body>
</html>`;
}

export const appReviewPage = page(
  "Facebook App Review",
  `<h1>Stopirex Facebook Customer Care</h1>
  <p class="meta">Official application information for Meta App Review.</p>
  <p>Stopirex is a customer-care and commerce application used by authorized staff to manage conversations and comments on Facebook Pages that they administer.</p>

  <h2>How the application uses Meta products</h2>
  <ul>
    <li>Facebook Login for Business lets a Page administrator select which managed Page to connect.</li>
    <li>Messenger Webhooks deliver customer-initiated messages so the application can prepare and send relevant customer-care replies.</li>
    <li>Page comment events let authorized staff monitor comments, reply publicly, continue support privately when appropriate, and protect publicly posted phone numbers or email addresses.</li>
    <li>Each connected Page can be enabled or disabled separately by an authorized administrator.</li>
  </ul>

  <h2>Data use and customer control</h2>
  <p>The application processes only the information required to provide customer support, manage orders requested by customers, and operate the connected Page. It does not sell personal data or use Page data for unrelated advertising.</p>

  <h2>Policies</h2>
  <ul>
    <li><a href="/privacy-policy">Privacy Policy</a></li>
    <li><a href="/terms">Terms of Service</a></li>
    <li><a href="/data-deletion">Data Deletion Instructions</a></li>
  </ul>

  <h2>Reviewer test path</h2>
  <p>Use the Meta test user or Page role supplied with the review submission, connect the Page named <strong>Yến Nhi thích skincare</strong>, and send a customer-initiated Messenger message to verify the support workflow.</p>`,
  "en",
);

const pageContact = `Nếu cần hỗ trợ hoặc thực hiện quyền đối với dữ liệu, khách hàng có thể nhắn tin trực tiếp cho <a href="https://www.facebook.com/108631178590851">Facebook Page Stopirex</a>.`;

export const privacyPolicyPage = page(
  "Chính sách quyền riêng tư",
  `<h1>Chính sách quyền riêng tư</h1>
  <p class="meta">Áp dụng cho chatbot Stopirex trên Facebook Messenger.</p>
  <p>Stopirex tôn trọng quyền riêng tư và chỉ xử lý thông tin cần thiết để tư vấn, hỗ trợ khách hàng, tiếp nhận đơn hàng và chăm sóc sau bán.</p>

  <h2>1. Thông tin được xử lý</h2>
  <ul>
    <li>Nội dung khách hàng chủ động gửi trong cuộc trò chuyện Messenger.</li>
    <li>Tên hiển thị, mã định danh Page-scoped và dữ liệu sự kiện do Meta cung cấp cho ứng dụng.</li>
    <li>Thông tin nhận hàng do khách hàng tự cung cấp, như tên người nhận, số điện thoại, địa chỉ và số lượng sản phẩm.</li>
    <li>Dữ liệu vận hành cần thiết để bảo mật, xử lý lỗi và ngăn gửi trùng.</li>
  </ul>

  <h2>2. Mục đích sử dụng</h2>
  <p>Dữ liệu được dùng để trả lời yêu cầu của khách hàng, tư vấn sản phẩm dựa trên nội dung đã được phê duyệt, tạo và theo dõi đơn hàng, xử lý khiếu nại, bảo vệ hệ thống và tuân thủ nghĩa vụ pháp lý.</p>

  <h2>3. Chia sẻ và lưu trữ</h2>
  <p>Stopirex không bán dữ liệu cá nhân. Dữ liệu chỉ được chia sẻ với nhà cung cấp hạ tầng, đơn vị vận chuyển hoặc bên xử lý cần thiết để cung cấp dịch vụ; các bên này chỉ được sử dụng dữ liệu trong phạm vi công việc được giao. Dữ liệu được lưu trong thời gian cần thiết cho các mục đích nêu trên và nghĩa vụ lưu trữ hợp pháp.</p>

  <h2>4. Quyền của khách hàng</h2>
  <p>Khách hàng có thể yêu cầu xem, chỉnh sửa hoặc xóa dữ liệu của mình. Một số dữ liệu giao dịch có thể phải được lưu trong thời hạn luật định, nhưng sẽ bị hạn chế sử dụng cho mục đích khác.</p>

  <h2>5. An toàn dữ liệu</h2>
  <p>Hệ thống áp dụng kiểm soát truy cập, xác minh chữ ký webhook, mã hóa thông tin nhạy cảm và nhật ký vận hành để giảm rủi ro truy cập hoặc sử dụng trái phép.</p>

  <h2>6. Liên hệ</h2>
  <p>${pageContact}</p>`,
);

export const termsOfServicePage = page(
  "Điều khoản sử dụng",
  `<h1>Điều khoản sử dụng</h1>
  <p class="meta">Điều khoản dành cho chatbot Stopirex trên Facebook Messenger.</p>
  <p>Khi sử dụng chatbot, khách hàng đồng ý cung cấp thông tin chính xác trong phạm vi cần thiết để Stopirex tư vấn, hỗ trợ hoặc xử lý đơn hàng.</p>

  <h2>1. Phạm vi dịch vụ</h2>
  <p>Chatbot hỗ trợ trả lời thông tin sản phẩm, cách dùng, giá bán, giao nhận, tiếp nhận đơn hàng và chuyển yêu cầu tới nhân viên khi cần. Nội dung tư vấn không thay thế chẩn đoán hoặc hướng dẫn của bác sĩ.</p>

  <h2>2. Trách nhiệm của khách hàng</h2>
  <p>Khách hàng không được sử dụng chatbot để gửi nội dung trái pháp luật, xâm phạm quyền của người khác, phá hoại hệ thống hoặc giả mạo thông tin giao dịch.</p>

  <h2>3. Đơn hàng và giao nhận</h2>
  <p>Đơn chỉ được xác nhận sau khi hệ thống hoặc nhân viên thông báo rõ trạng thái. Thời gian giao hàng là dự kiến và có thể thay đổi theo địa chỉ, đơn vị vận chuyển hoặc sự kiện ngoài khả năng kiểm soát hợp lý.</p>

  <h2>4. Giới hạn và thay đổi</h2>
  <p>Stopirex có thể tạm dừng chatbot để bảo trì, bảo mật hoặc xử lý sự cố. Điều khoản có thể được cập nhật khi quy trình hoặc yêu cầu pháp lý thay đổi; ngày cập nhật được hiển thị cuối trang.</p>

  <h2>5. Liên hệ</h2>
  <p>${pageContact}</p>`,
);

export const dataDeletionPage = page(
  "Yêu cầu xóa dữ liệu",
  `<h1>Yêu cầu xóa dữ liệu</h1>
  <p class="notice">Khách hàng có thể yêu cầu Stopirex xóa dữ liệu đã cung cấp qua Facebook Messenger.</p>

  <h2>Cách gửi yêu cầu</h2>
  <ol>
    <li>Mở cuộc trò chuyện với <a href="https://www.facebook.com/108631178590851">Facebook Page Stopirex</a>.</li>
    <li>Gửi nội dung <strong>“Yêu cầu xóa dữ liệu”</strong>.</li>
    <li>Cung cấp thông tin tối thiểu cần thiết để xác minh đúng chủ thể hoặc đúng đơn hàng. Không gửi mật khẩu, mã OTP hay thông tin thẻ thanh toán.</li>
  </ol>

  <h2>Phạm vi xử lý</h2>
  <p>Sau khi xác minh, Stopirex sẽ xóa hoặc ẩn danh dữ liệu hội thoại, hồ sơ khách hàng và dữ liệu liên quan trong phạm vi hệ thống kiểm soát. Dữ liệu phải lưu theo nghĩa vụ pháp lý hoặc để giải quyết tranh chấp sẽ được hạn chế sử dụng và xóa khi hết thời hạn bắt buộc.</p>

  <h2>Thời gian phản hồi</h2>
  <p>Stopirex xác nhận đã nhận yêu cầu và hoàn tất xử lý trong thời hạn phù hợp với quy định áp dụng, thông thường không quá 30 ngày.</p>

  <p>${pageContact}</p>`,
);

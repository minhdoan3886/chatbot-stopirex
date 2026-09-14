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
  .success { padding: 16px 18px; border-left: 4px solid #16794d; background: #f1fbf6; }
  .button { display: inline-block; margin: 8px 0; padding: 12px 18px; border-radius: 10px; color: #fff; background: #6f1d9b; font-weight: 700; text-decoration: none; }
  .steps li { margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th, td { padding: 11px 12px; border: 1px solid #dfe3e8; text-align: left; vertical-align: top; }
  th { background: #f4f0f7; color: #4a1833; }
  code { padding: 2px 5px; border-radius: 5px; background: #f0f2f5; font-size: .92em; }
  footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #e4e7eb; color: #5f6368; }
  @media (max-width: 640px) { main { margin: 16px auto; padding: 24px 20px; } table { display: block; overflow-x: auto; } }
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

const pageContact = `Nếu cần hỗ trợ hoặc thực hiện quyền đối với dữ liệu, khách hàng có thể nhắn tin trực tiếp cho <a href="https://www.facebook.com/108631178590851">Facebook Page Stopirex</a>.`;

export const appReviewPage = page(
  "Facebook App Review",
  `<h1>Stopirex Facebook Customer Care</h1>
  <p class="meta">Reviewer walkthrough for Meta App ID 1606697693399457.</p>
  <p class="success"><strong>Authentication model:</strong> this application uses the visible Facebook Login flow. It does not use a System User token for the reviewer path. Page access tokens are encrypted before storage and never displayed in the interface.</p>
  <p>Stopirex is a customer-care and commerce application used by authorized staff to manage customer-initiated Messenger conversations and comments on Facebook Pages they administer.</p>
  <a class="button" href="/pages?review=1">Open Page administration</a>

  <h2>Complete reviewer path</h2>
  <ol class="steps">
    <li>Open <strong>Page administration</strong> using the application credentials supplied in the review submission.</li>
    <li>Select <strong>Connect with Facebook</strong>. Complete the entire Facebook Login flow and grant all requested Page permissions.</li>
    <li>Select the supplied review Page. The application lists only Pages managed by the signed-in administrator.</li>
    <li>Confirm that the Page card shows an encrypted credential and the <code>messages</code> + <code>feed</code> webhook subscription, then enable automation for that Page.</li>
    <li>From the supplied customer test account, send a Messenger message to the Page. Show the inbound customer message and the relevant customer-care reply.</li>
    <li>Add a comment to the supplied review post. Show the public reply, the single private follow-up and the same event in <strong>Comment operations</strong>.</li>
    <li>Add a second comment containing dummy contact information. Show the privacy recommendation and use <strong>Hide comment</strong>, then <strong>Unhide comment</strong>. A genuine complaint without personal information remains visible.</li>
  </ol>

  <h2>Permission-to-action evidence</h2>
  <table>
    <thead><tr><th>Permission</th><th>Visible action in the recording</th><th>Result</th></tr></thead>
    <tbody>
      <tr><td><code>pages_show_list</code></td><td>Complete Facebook Login and return to Page administration.</td><td>Only Pages managed by the administrator are listed for explicit selection.</td></tr>
      <tr><td><code>pages_manage_metadata</code></td><td>Connect the selected Page.</td><td>The application subscribes that Page to <code>messages</code>, <code>feed</code>, message echoes, deliveries and reads.</td></tr>
      <tr><td><code>pages_messaging</code></td><td>Send a customer-initiated Messenger message and show the reply.</td><td>The application sends a relevant support reply; staff takeover stops automation.</td></tr>
      <tr><td><code>pages_read_user_content</code></td><td>Post a new comment from the customer account.</td><td>The comment text and author context appear in Comment operations.</td></tr>
      <tr><td><code>pages_read_engagement</code></td><td>Open the comment record in the Page/post context.</td><td>The event is associated with the correct connected Page and post.</td></tr>
      <tr><td><code>pages_manage_engagement</code></td><td>Show the public reply and use Hide/Unhide on the dummy-PII comment.</td><td>The reply and moderation state are visible both on Facebook and in Comment operations.</td></tr>
    </tbody>
  </table>

  <h2>Screen-recording requirements</h2>
  <ul>
    <li>Record the full browser window in English, including the application URL and the Facebook Login permission screen.</li>
    <li>Do not cut between login, permission grant, Page selection and the resulting Page card.</li>
    <li>Use callouts to name each requested permission when its corresponding action is demonstrated.</li>
    <li>Do not display passwords, Page tokens, customer phone numbers or real personal information.</li>
  </ul>

  <h2>Policies</h2>
  <ul><li><a href="/privacy-policy">Privacy Policy</a></li><li><a href="/terms">Terms of Service</a></li><li><a href="/data-deletion">Data Deletion Instructions</a></li></ul>`,
  "en",
);

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

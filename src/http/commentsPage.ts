export const commentsPage = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bình luận Meta · Stopirex</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#18212f;background:#f4f7fb}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:24px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.tab{padding:10px 14px;border-radius:10px;text-decoration:none;color:#334155;background:#fff}.tab.active{color:#fff;background:#334155}.head{display:flex;justify-content:space-between;align-items:center;gap:16px}.muted{color:#64748b}.grid{display:grid;gap:14px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px}.row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.badges{display:flex;gap:6px;flex-wrap:wrap}.badge{font-size:12px;padding:4px 8px;border-radius:999px;background:#e2e8f0}.urgent,.failed{background:#fee2e2;color:#991b1b}.hide{background:#fef3c7;color:#92400e}.reply{border-left:3px solid #cbd5e1;padding-left:12px;margin-top:12px;white-space:pre-wrap}.actions button{border:0;border-radius:8px;padding:8px 12px;cursor:pointer;background:#334155;color:#fff}.empty{text-align:center;padding:48px;color:#64748b}@media(max-width:700px){.row{display:block}.actions{margin-top:12px}}
</style>
</head><body><main class="wrap">
<nav class="tabs"><a class="tab" href="/operations">Tổng quan</a><a class="tab" href="/orders">Đơn hàng</a><a class="tab active" href="/comments">Bình luận</a><a class="tab" href="/product">Sản phẩm</a><a class="tab" href="/pages">Fanpage</a></nav>
<div class="head"><div><h1>Bình luận Facebook</h1><p class="muted">Theo dõi trả lời công khai, inbox riêng và bảo vệ thông tin khách.</p></div><button onclick="load()">Tải lại</button></div>
<section id="list" class="grid"><div class="empty">Đang tải…</div></section>
</main><script>
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>v?new Date(v).toLocaleString('vi-VN'):'';
async function setVisibility(id,hidden){const r=await fetch('/api/meta/comments/'+id+'/visibility',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hidden})});if(!r.ok){alert('Không cập nhật được trạng thái bình luận');return}await load()}
function card(x){return '<article class="card"><div class="row"><div><div class="badges"><span class="badge">'+esc(x.pageName)+'</span><span class="badge '+(x.priority==='urgent'?'urgent':'')+'">'+esc(x.category)+'</span><span class="badge '+(x.status==='failed'?'failed':'')+'">'+esc(x.status)+'</span>'+(x.moderationRecommendation!=='keep'?'<span class="badge hide">'+esc(x.moderationRecommendation)+'</span>':'')+'</div><h3>'+esc(x.commentText)+'</h3><div class="muted">'+time(x.receivedAt)+'</div></div><div class="actions"><button onclick="setVisibility(&quot;'+esc(x.id)+'&quot;,'+(!x.isHidden)+')">'+(x.isHidden?'Hiện lại':'Ẩn comment')+'</button></div></div>'+(x.moderationReason?'<p class="muted">'+esc(x.moderationReason)+'</p>':'')+(x.publicReplyText?'<div class="reply"><b>Công khai</b><br>'+esc(x.publicReplyText)+'</div>':'')+(x.privateReplyText?'<div class="reply"><b>Inbox riêng</b><br>'+esc(x.privateReplyText)+'</div>':'')+'</article>'}
async function load(){const root=document.getElementById('list');try{const r=await fetch('/api/meta/comments');const j=await r.json();if(!r.ok)throw new Error(j.error||'request_failed');root.innerHTML=j.length?j.map(card).join(''):'<div class="empty">Chưa có bình luận nào được ghi nhận.</div>'}catch(e){root.innerHTML='<div class="empty">Không tải được dữ liệu bình luận.</div>'}}
load();
</script></body></html>`;

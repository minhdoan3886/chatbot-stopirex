export const ordersPage = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stopirex — Đơn Hàng</title><style>
:root{color-scheme:light;--ink:#162033;--muted:#637189;--line:#dfe5ee;--panel:#fff;--bg:#f5f7fb;--blue:#2459d3;--green:#138a5b;--amber:#b76a00;--red:#c73737;--gray:#7b8493}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Montserrat,Arial,sans-serif}
main{max-width:1320px;margin:0 auto;padding:24px}
.hero{padding:24px 26px;border-radius:20px;background:linear-gradient(135deg,#102b5e,#2459d3);color:#fff;box-shadow:0 12px 32px #193e6b20}
.hero-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
.hero h1{margin:0 0 7px;font-size:28px}.hero p{margin:0;opacity:.84}
.hero-actions{display:flex;gap:8px;justify-content:flex-end}
.tabs{display:flex;gap:6px;margin:16px 0 18px;padding:5px;background:#e9edf4;border-radius:12px;width:max-content}
.tab{padding:9px 14px;border-radius:9px;color:#4a5870;text-decoration:none;font-weight:700;font-size:14px}
.tab.active{color:#19489f;background:#fff;box-shadow:0 2px 8px #17294a16}
.refresh{border:1px solid #ffffff55;color:#fff;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#ffffff18}
.refresh:disabled{opacity:.6;cursor:wait}
.freshness{font-size:12px;margin-top:8px;text-align:right;opacity:.75}
.grid{display:grid;gap:14px}
.kpis{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:16px}
.card{border-radius:16px;padding:17px;background:var(--panel);border:1px solid var(--line);box-shadow:0 8px 26px #132f5b0a}
.card label{display:block;color:var(--muted);font-size:12px;font-weight:700;margin-bottom:9px}
.card strong{font-size:27px}.card small{display:block;color:var(--muted);margin-top:6px}
.panel{background:var(--panel);border:1px solid var(--line);box-shadow:0 8px 26px #132f5b0a;border-radius:18px;padding:20px;margin-bottom:16px}
.panel h2{font-size:18px;margin:0}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:14px 0}
.filters{display:flex;gap:8px;flex-wrap:wrap}
.filters input,.filters select{border:1px solid #cad3e0;background:#fff;border-radius:9px;padding:9px 11px;font:inherit;font-size:13px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;min-width:900px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid #e8ecf2;font-size:12px;vertical-align:middle}
th{position:sticky;top:0;background:#f7f9fc;color:#5b6980;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
tbody tr:hover{background:#f8faff}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;white-space:nowrap}
.pill:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pending{color:var(--amber);background:#fff4df}
.completed{color:var(--green);background:#e9f7f1}
.cancelled{color:var(--gray);background:#eef0f4}
.note{font-size:12px;color:var(--muted)}
.sub{display:block;color:#7a8698;margin-top:2px}
.empty{padding:18px;border-radius:11px;background:#eef8f3;color:var(--green);font-size:13px}
.btn{border:none;border-radius:8px;padding:6px 11px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3}
.btn-complete{background:#e9f7f1;color:var(--green)}.btn-complete:hover{background:#d0f0e4}
.btn-cancel{background:#fff0f0;color:var(--red)}.btn-cancel:hover{background:#fde0e0}
.btn:disabled{opacity:.5;cursor:wait}
.error-banner{display:none;margin:0 0 14px;padding:12px 14px;border-radius:11px;background:#ffeded;color:var(--red)}
.loading{opacity:.55;pointer-events:none}
.vnd{white-space:nowrap}
@media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){main{padding:14px}.hero-row{flex-direction:column}.kpis{grid-template-columns:1fr}.tabs{width:100%}.tab{flex:1;text-align:center}}
</style></head><body><main>
<section class="hero"><div class="hero-row"><div>
<h1>Hứng Đơn — Chốt Đơn</h1>
<p>Danh sách đơn khách đã xác nhận qua chatbot. Sale xem và tự lên Sapo.</p>
</div><div>
<div class="hero-actions"><button id="refresh" class="refresh">Làm mới</button></div>
<div id="freshness" class="freshness">Đang tải…</div>
</div></div></section>

<nav class="tabs">
  <a class="tab" href="/">Chat thử</a>
  <a class="tab" href="/operations">Tổng quan kết nối</a>
  <a class="tab active" href="/orders">Đơn hàng</a>
  <a class="tab" href="/product">Thông tin sản phẩm</a>
</nav>

<div id="error" class="error-banner"></div>

<div id="dashboard">
<div class="grid kpis">
  <div class="card"><label>ĐƠN CHỜ LÊN SAPO</label><strong id="kpiPending">—</strong><small>Cần xử lý ngay</small></div>
  <div class="card"><label>TỔNG ĐƠN HÔM NAY</label><strong id="kpiToday">—</strong><small id="kpiTodayDetail">—</small></div>
  <div class="card"><label>ĐÃ LÊN SAPO</label><strong id="kpiCompleted">—</strong><small>Tổng cộng</small></div>
  <div class="card"><label>ĐÃ HUỶ</label><strong id="kpiCancelled">—</strong><small>Tổng cộng</small></div>
</div>

<section class="panel">
  <div class="section-head">
    <div>
      <h2>Danh sách đơn</h2>
      <div id="orderCount" class="note">—</div>
    </div>
    <div class="note">Tự làm mới mỗi 30 giây</div>
  </div>
  <div class="toolbar">
    <div class="filters">
      <select id="statusFilter">
        <option value="all">Tất cả trạng thái</option>
        <option value="pending" selected>Chờ lên Sapo</option>
        <option value="completed">Đã lên Sapo</option>
        <option value="cancelled">Đã huỷ</option>
      </select>
      <input id="search" placeholder="Tìm tên, SĐT, địa chỉ…">
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Trạng thái</th>
        <th>Khách hàng</th>
        <th>Địa chỉ giao</th>
        <th>Sản phẩm</th>
        <th>Tổng tiền</th>
        <th>Thanh toán</th>
        <th>Thời gian xác nhận</th>
        <th>Hành động</th>
      </tr></thead>
      <tbody id="orderRows"></tbody>
    </table>
  </div>
</section>
</div>

<script>
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fullTime=v=>v?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'—';
const relTime=v=>{if(!v)return'—';const ms=Date.now()-new Date(v).getTime();if(ms<60000)return Math.max(1,Math.round(ms/1000))+' giây trước';if(ms<3600000)return Math.round(ms/60000)+' phút trước';if(ms<86400000)return Math.round(ms/3600000)+' giờ trước';return Math.round(ms/86400000)+' ngày trước'};
const vnd=v=>v?new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(v)):'—';
const statusLabel={pending:'Chờ lên Sapo',completed:'Đã lên Sapo',cancelled:'Đã huỷ'};
const payLabel={cod:'COD',bank_transfer:'Chuyển khoản'};

let allRecords=[];

function isTodayVn(dateStr){
  if(!dateStr)return false;
  const d=new Date(dateStr),now=new Date();
  return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
}

function render(data){
  allRecords=data.records??[];
  const pending=allRecords.filter(r=>r.status==='pending').length;
  const completed=allRecords.filter(r=>r.status==='completed').length;
  const cancelled=allRecords.filter(r=>r.status==='cancelled').length;
  const today=allRecords.filter(r=>isTodayVn(r.confirmedAt)).length;
  document.getElementById('kpiPending').textContent=pending;
  document.getElementById('kpiCompleted').textContent=completed;
  document.getElementById('kpiCancelled').textContent=cancelled;
  document.getElementById('kpiToday').textContent=today;
  document.getElementById('kpiTodayDetail').textContent='Tổng '+allRecords.length+' đơn';
  document.getElementById('freshness').textContent='Cập nhật '+new Intl.DateTimeFormat('vi-VN',{timeStyle:'medium'}).format(new Date());
  renderRows();
}

function renderRows(){
  const status=document.getElementById('statusFilter').value;
  const q=document.getElementById('search').value.trim().toLowerCase();
  const rows=allRecords.filter(r=>{
    if(status!=='all'&&r.status!==status)return false;
    if(q&&![(r.recipientName??''),(r.phone??''),(r.legacyAddress??'')].join(' ').toLowerCase().includes(q))return false;
    return true;
  });
  document.getElementById('orderCount').textContent='Hiển thị '+rows.length+'/'+allRecords.length+' đơn';
  document.getElementById('orderRows').innerHTML=rows.length?rows.map(r=>{
    const id=esc(r.id);
    const actionCell=r.status==='pending'
      ?'<button class="btn btn-complete" onclick=\'updateStatus("'+id+'","completed",this)\'>✓ Đã lên Sapo</button>'
       +'<button class="btn btn-cancel" style="margin-top:4px" onclick=\'updateStatus("'+id+'","cancelled",this)\'>✕ Huỷ</button>'
      :r.note?'<span class="sub">'+esc(r.note)+'</span>':'';
    return '<tr id="row-'+esc(r.id)+'">'
      +'<td><span class="pill '+esc(r.status)+'">'+esc(statusLabel[r.status]??r.status)+'</span></td>'
      +'<td><b>'+esc(r.recipientName??'—')+'</b><span class="sub">'+esc(r.phone??'—')+'</span></td>'
      +'<td style="max-width:220px;word-break:break-word">'+esc(r.legacyAddress??'—')+(r.deliveryNote?'<span class="sub">Ghi chú: '+esc(r.deliveryNote)+'</span>':'')+'</td>'
      +'<td><b>'+esc(r.sku??'—')+'</b><span class="sub">SL: '+(r.quantity??'—')+'</span></td>'
      +'<td class="vnd">'+vnd(r.totalVnd)+'</td>'
      +'<td>'+esc(payLabel[r.paymentMethod??'']??r.paymentMethod??'—')+'</td>'
      +'<td>'+esc(fullTime(r.confirmedAt))+'<span class="sub">'+esc(relTime(r.confirmedAt))+'</span></td>'
      +'<td>'+actionCell+'</td>'
      +'</tr>';
  }).join(''):'<tr><td colspan="8" class="empty">Không có đơn nào phù hợp bộ lọc.</td></tr>';
}


async function updateStatus(id,status,btn){
  const note=status==='completed'?undefined:prompt('Lý do huỷ (có thể bỏ trống):')??undefined;
  btn.disabled=true;
  try{
    const res=await fetch('/api/orders/'+id+'/'+status,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...(note?{note}:{})})
    });
    if(!res.ok)throw new Error('HTTP '+res.status);
    const updated=await res.json();
    const idx=allRecords.findIndex(r=>r.id===id);
    if(idx>=0)allRecords[idx]=updated;
    renderRows();
  }catch(e){
    alert('Lỗi cập nhật: '+e.message);
    btn.disabled=false;
  }
}

async function load(){
  const btn=document.getElementById('refresh');
  const dashboard=document.getElementById('dashboard');
  const err=document.getElementById('error');
  btn.disabled=true;
  dashboard.classList.add('loading');
  try{
    const res=await fetch('/api/orders',{headers:{accept:'application/json'}});
    if(!res.ok)throw new Error('HTTP '+res.status);
    render(await res.json());
    err.style.display='none';
  }catch(e){
    err.textContent='Không tải được dữ liệu: '+e.message;
    err.style.display='block';
  }finally{
    btn.disabled=false;
    dashboard.classList.remove('loading');
  }
}

document.getElementById('refresh').addEventListener('click',load);
document.getElementById('statusFilter').addEventListener('change',renderRows);
document.getElementById('search').addEventListener('input',renderRows);
load();
setInterval(load,30000);
</script></body></html>`;

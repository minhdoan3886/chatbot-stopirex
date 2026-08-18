import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const paths = {
  long: "/Users/minhdoanduc/Downloads/1/danh_sach_don_hang_10.08.2026_402e22852ea9de23ddfea73d5ae108e1.xlsx",
  facebook: "/Volumes/lưu trữ/Stopirex/facebook/danh_sach_don_hang_10.08.2026_1cd6393886028e2b8a8675f8a11412c1.xlsx",
  tiktok: "/Volumes/lưu trữ/Stopirex/tiktok/Shop Analytics_Key metrics_20260810.xlsx",
};

const norm = (v) => v == null ? "" : String(v).trim();
const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(norm(v).replaceAll(",", ""));
  return Number.isFinite(n) ? n : 0;
};
const dateKey = (v) => {
  const s = norm(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return "";
};

async function firstSheetValues(path) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  return wb.worksheets.getItemAt(0).getUsedRange().values;
}

async function orderData(path) {
  const values = await firstSheetValues(path);
  const hi = values.findIndex(r => r.map(norm).includes("Mã ĐH") && r.map(norm).includes("Nguồn"));
  const h = values[hi].map(norm);
  const c = (name) => h.indexOf(name);
  const byId = new Map();
  for (const r of values.slice(hi + 1)) {
    const id = norm(r[c("Mã ĐH")]);
    if (id && !byId.has(id)) byId.set(id, r);
  }
  const orders = [...byId.values()].map(r => ({
    id: norm(r[c("Mã ĐH")]), date: dateKey(r[c("Ngày chứng từ")]), source: norm(r[c("Nguồn")]) || "(trống)",
    status: norm(r[c("Trạng thái đơn hàng")]), gross: num(r[c("Khách phải trả")]), paid: num(r[c("Khách đã trả")]),
  })).filter(o => o.date >= "2026-08-01" && o.date <= "2026-08-10");
  const summarize = (arr) => ({
    orders: arr.length,
    valid: arr.filter(o => o.status !== "Đã hủy").length,
    completed: arr.filter(o => o.status === "Hoàn thành").length,
    cancelled: arr.filter(o => o.status === "Đã hủy").length,
    gross: arr.filter(o => o.status !== "Đã hủy").reduce((s,o)=>s+o.gross,0),
    paid: arr.filter(o => o.status !== "Đã hủy").reduce((s,o)=>s+o.paid,0),
  });
  const bySource = Object.fromEntries([...orders.reduce((m,o)=>{
    const a=m.get(o.source)||[];a.push(o);m.set(o.source,a);return m;
  },new Map())].map(([k,a])=>[k,summarize(a)]).sort((a,b)=>b[1].orders-a[1].orders));
  const byDay = Object.fromEntries([...orders.reduce((m,o)=>{
    const a=m.get(o.date)||[];a.push(o);m.set(o.date,a);return m;
  },new Map())].map(([k,a])=>[k,summarize(a)]).sort());
  return {summary:summarize(orders),bySource,byDay,ids:orders.map(o=>o.id)};
}

async function tiktokData(path) {
  const values = await firstSheetValues(path);
  const hi = values.findIndex(r => norm(r[0]) === "Ngày" && norm(r[1]) === "GMV");
  const h = values[hi].map(norm);
  const c = (name) => h.indexOf(name);
  const rows = values.slice(hi+1).filter(r=>{
    const d=dateKey(r[c("Ngày")]); return d >= "2026-08-01" && d <= "2026-08-10";
  }).map(r=>{
    const gmv=num(r[c("GMV")]);
    const liveCreator=num(r[c("GMV nhờ buổi LIVE của nhà sáng tạo")]);
    const liveConnected=num(r[c("GMV nhờ buổi LIVE của tài khoản kết nối")]);
    const videoCreator=num(r[c("GMV đến từ video liên kết")]);
    const videoConnected=num(r[c("GMV nhờ video của tài khoản kết nối")]);
    const live=liveCreator+liveConnected;
    const video=videoCreator+videoConnected;
    return {date:dateKey(r[c("Ngày")]),gmv,orders:num(r[c("Đơn hàng")]),liveCreator,liveConnected,live,videoCreator,videoConnected,video,productCard:gmv-live-video};
  });
  const total = Object.fromEntries(["gmv","orders","liveCreator","liveConnected","live","videoCreator","videoConnected","video","productCard"].map(k=>[k,rows.reduce((s,r)=>s+r[k],0)]));
  return {headers:h,rows,total};
}

const [long,facebook,tiktok]=await Promise.all([orderData(paths.long),orderData(paths.facebook),tiktokData(paths.tiktok)]);
const facebookIds=new Set(facebook.ids);
const overlap=long.ids.filter(id=>facebookIds.has(id));
delete long.ids; delete facebook.ids;
console.log(JSON.stringify({long,facebook,overlap:{count:overlap.length,sample:overlap.slice(0,20)},tiktok},null,2));

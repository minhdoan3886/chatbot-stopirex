import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = {
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
async function values(path) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  return wb.worksheets.getItemAt(0).getUsedRange().values;
}

const fv = await values(files.facebook);
const fhi = fv.findIndex(r => r.map(norm).includes("Mã ĐH") && r.map(norm).includes("Nguồn"));
const fh = fv[fhi].map(norm);
const fc = (name) => fh.indexOf(name);
const byId = new Map();
for (const r of fv.slice(fhi+1)) {
  const id=norm(r[fc("Mã ĐH")]);
  if (id && !byId.has(id)) byId.set(id,r);
}
const facebookOrders=[...byId.values()].map(r=>{
  const gross=num(r[fc("Khách phải trả")]);
  const paid=num(r[fc("Khách đã trả")]);
  return [dateKey(r[fc("Ngày chứng từ")]),norm(r[fc("Mã ĐH")]),norm(r[fc("Nguồn")])||"(trống)",norm(r[fc("Trạng thái đơn hàng")]),gross,paid,gross-paid,norm(r[fc("Tên khách hàng")]),norm(r[fc("Điện thoại KH")])];
}).filter(r=>r[0]>="2026-08-01"&&r[0]<="2026-08-10").sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));

const tv = await values(files.tiktok);
const thi = tv.findIndex(r=>norm(r[0])==="Ngày"&&norm(r[1])==="GMV");
const th = tv[thi].map(norm);
const tc = (name) => th.indexOf(name);
const tiktokDaily=tv.slice(thi+1).map(r=>[
  dateKey(r[tc("Ngày")]),num(r[tc("GMV")]),num(r[tc("Đơn hàng")]),num(r[tc("Tổng doanh thu")]),num(r[tc("Hoàn tiền")]),
  num(r[tc("GMV nhờ buổi LIVE của nhà sáng tạo")]),num(r[tc("GMV nhờ buổi LIVE của tài khoản kết nối")]),
  num(r[tc("GMV đến từ video liên kết")]),num(r[tc("GMV nhờ video của tài khoản kết nối")]),
]).filter(r=>r[0]>="2026-08-01"&&r[0]<="2026-08-10").sort((a,b)=>a[0].localeCompare(b[0]));

console.log(JSON.stringify({facebookOrders,tiktokDaily}));

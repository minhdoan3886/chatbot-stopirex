import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files={
  product:"/Volumes/lưu trữ/Stopirex/tiktok ads/Product campaign data 2026-08-01 - 2026-08-10.xlsx",
  overview:"/Volumes/lưu trữ/Stopirex/tiktok ads/Campaign overview data 20260801 - 20260810.xlsx",
};
const norm=v=>v==null?"":String(v).trim();
const num=v=>{if(typeof v==="number"&&Number.isFinite(v))return v;const n=Number(norm(v).replaceAll(",",""));return Number.isFinite(n)?n:0};
async function vals(path){const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));return wb.worksheets.getItemAt(0).getUsedRange().values}
const pv=await vals(files.product); const ph=pv[0].map(norm); const pc=n=>ph.indexOf(n);
const product=pv.slice(1).filter(r=>norm(r[0])).map(r=>({campaignId:norm(r[pc("ID chiến dịch")]),campaign:norm(r[pc("Tên chiến dịch")]),cost:num(r[pc("Chi phí")]),netCost:num(r[pc("Chi phí ròng")]),orders:num(r[pc("Số lượng đơn hàng SKU")]),cpa:num(r[pc("Chi phí cho mỗi đơn hàng")]),grossRevenue:num(r[pc("Doanh thu gộp")]),roi:num(r[pc("ROI")]),currency:norm(r[pc("Đơn vị tiền tệ")])}));
const ov=await vals(files.overview); const oh=ov[0].map(norm); const oc=n=>oh.indexOf(n);
const overview=ov.slice(1).filter(r=>norm(r[0])).map(r=>({date:norm(r[oc("Theo ngày")]),cost:num(r[oc("Chi phí")]),orders:num(r[oc("Số lượng đơn hàng SKU (Cửa hàng hiện tại)")]),cpa:num(r[oc("Chi phí mỗi đơn hàng (Cửa hàng hiện tại)")]),grossRevenue:num(r[oc("Doanh thu gộp (Cửa hàng hiện tại)")]),roi:num(r[oc("ROI (Cửa hàng hiện tại)")]),currency:norm(r[oc("Tiền tệ")])}));
const daily=overview.filter(r=>/^2026-08-\d{2}/.test(r.date));
const totals={cost:daily.reduce((s,r)=>s+r.cost,0),orders:daily.reduce((s,r)=>s+r.orders,0),grossRevenue:daily.reduce((s,r)=>s+r.grossRevenue,0)}; totals.cpa=totals.cost/totals.orders; totals.roi=totals.grossRevenue/totals.cost;
console.log(JSON.stringify({productHeaders:ph,productRaw:pv.slice(1),product,overview,daily,totals,checks:{productCostShare:product.reduce((s,r)=>s+r.cost,0)/totals.cost,productRevenueShare:product.reduce((s,r)=>s+r.grossRevenue,0)/totals.grossRevenue,productOrdersShare:product.reduce((s,r)=>s+r.orders,0)/totals.orders}},null,2));

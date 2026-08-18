import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourceFiles = {
  shopee: "/Volumes/lưu trữ/Stopirex/shoppe/Order.all.20260711_20260810.xlsx",
  tiktok: "/Volumes/lưu trữ/Stopirex/tiktok/Shop Analytics_Key metrics_20260810.xlsx",
  facebook: "/Volumes/lưu trữ/Stopirex/facebook/danh_sach_don_hang_10.08.2026_1cd6393886028e2b8a8675f8a11412c1.xlsx",
};

const norm = (v) => (v == null ? "" : String(v).trim());
const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = Number(norm(v).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const dateKey = (v) => {
  const text = norm(v);
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
};
const headerIndex = (values, required = []) => {
  let best = { index: 0, score: -1 };
  values.slice(0, 50).forEach((row, index) => {
    const labels = row.map(norm);
    const score = row.filter((v) => norm(v)).length + required.filter((label) => labels.includes(label)).length * 1000;
    if (score > best.score) best = { index, score };
  });
  return best.index;
};
const group = (rows, index) => Object.fromEntries([...rows.reduce((map, row) => {
  const key = norm(row[index]) || "(trống)";
  map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}, new Map())].sort((a, b) => b[1] - a[1]));

async function workbookValues(key) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(sourceFiles[key]));
  return wb.worksheets.getItemAt(0).getUsedRange().values;
}

async function analyzeShopee() {
  const values = await workbookValues("shopee");
  const hi = headerIndex(values, ["Mã đơn hàng", "Ngày đặt hàng"]);
  const headers = values[hi].map(norm);
  const c = (name) => headers.indexOf(name);
  const rows = values.slice(hi + 1).filter((row) => {
    const d = dateKey(row[c("Ngày đặt hàng")]);
    return d >= "2026-08-01" && d <= "2026-08-10";
  });
  const orders = new Map();
  for (const row of rows) {
    const id = norm(row[c("Mã đơn hàng")]);
    if (!id) continue;
    if (!orders.has(id)) orders.set(id, { date: dateKey(row[c("Ngày đặt hàng")]), status: norm(row[c("Trạng Thái Đơn Hàng")]), buyerPaid: num(row[c("Tổng số tiền Người mua thanh toán")]), orderValue: num(row[c("Tổng giá trị đơn hàng (VND)")]), rows: 0, quantity: 0 });
    const order = orders.get(id);
    order.rows += 1;
    order.quantity += num(row[c("Số lượng")]);
  }
  const unique = [...orders.values()];
  const isSuccessful = (status) => status === "Hoàn thành" || status === "Đã giao" || status === "Đã nhận được hàng" || status.startsWith("Người mua xác nhận đã nhận được hàng");
  return {
    headerRow: hi + 1,
    headers,
    rowsInPeriod: rows.length,
    uniqueOrders: unique.length,
    statuses: Object.fromEntries([...unique.reduce((m, o) => m.set(o.status || "(trống)", (m.get(o.status || "(trống)") ?? 0) + 1), new Map())]),
    buyerPaidAll: unique.reduce((s, o) => s + o.buyerPaid, 0),
    orderValueAll: unique.reduce((s, o) => s + o.orderValue, 0),
    buyerPaidCompleted: unique.filter((o) => o.status === "Hoàn thành").reduce((s, o) => s + o.buyerPaid, 0),
    orderValueCompleted: unique.filter((o) => o.status === "Hoàn thành").reduce((s, o) => s + o.orderValue, 0),
    daily: Object.fromEntries([...unique.reduce((m, o) => {
      const d = m.get(o.date) ?? { orders: 0, successful: 0, cancelled: 0, pending: 0, buyerPaid: 0, orderValue: 0, successfulOrderValue: 0 };
      d.orders += 1;
      d.successful += isSuccessful(o.status) ? 1 : 0;
      d.cancelled += o.status === "Đã hủy" ? 1 : 0;
      d.pending += !isSuccessful(o.status) && o.status !== "Đã hủy" ? 1 : 0;
      d.buyerPaid += o.buyerPaid;
      d.orderValue += o.orderValue;
      d.successfulOrderValue += isSuccessful(o.status) ? o.orderValue : 0;
      m.set(o.date, d);
      return m;
    }, new Map())].sort()),
  };
}

async function analyzeTikTok() {
  const values = await workbookValues("tiktok");
  const hi = values.findIndex((row) => norm(row[0]) === "Ngày" && norm(row[1]) === "GMV");
  const headers = values[hi].map(norm);
  const rows = values.slice(hi + 1).filter((row) => dateKey(row[0]));
  return { headerRow: hi + 1, headers, daily: rows.map((row) => ({ date: dateKey(row[0]), gmv: num(row[1]), orders: num(row[2]), customers: num(row[3]), items: num(row[4]), refund: num(row[5]), revenue: num(row[7]), pageViews: num(row[8]), visitors: num(row[9]), conversionRate: num(row[10]), aov: num(row[15]) })), totals: { gmv: rows.reduce((s,r)=>s+num(r[1]),0), orders: rows.reduce((s,r)=>s+num(r[2]),0), revenue: rows.reduce((s,r)=>s+num(r[7]),0), refund: rows.reduce((s,r)=>s+num(r[5]),0) } };
}

async function analyzeFacebook() {
  const values = await workbookValues("facebook");
  const hi = headerIndex(values, ["Mã ĐH", "Ngày chứng từ"]);
  const headers = values[hi].map(norm);
  const c = (name) => headers.indexOf(name);
  const rows = values.slice(hi + 1).filter((row) => norm(row[c("Mã ĐH")]));
  const byId = new Map();
  for (const row of rows) {
    const id = norm(row[c("Mã ĐH")]);
    if (!byId.has(id)) byId.set(id, row);
  }
  const unique = [...byId.values()];
  return {
    headerRow: hi + 1,
    headers,
    rawRows: rows.length,
    uniqueOrders: unique.length,
    dateRange: [dateKey(unique[0]?.[c("Ngày chứng từ")]), dateKey(unique.at(-1)?.[c("Ngày chứng từ")])],
    sources: group(unique, c("Nguồn")),
    statuses: group(unique, c("Trạng thái đơn hàng")),
    revenue: unique.filter((row) => norm(row[c("Trạng thái đơn hàng")]) !== "Đã hủy").reduce((s, row) => s + num(row[c("Khách phải trả")]), 0),
    paid: unique.filter((row) => norm(row[c("Trạng thái đơn hàng")]) !== "Đã hủy").reduce((s, row) => s + num(row[c("Khách đã trả")]), 0),
    daily: Object.fromEntries([...unique.reduce((m, row) => {
      const date = dateKey(row[c("Ngày chứng từ")]);
      const status = norm(row[c("Trạng thái đơn hàng")]);
      const d = m.get(date) ?? { orders: 0, closed: 0, completed: 0, cancelled: 0, revenue: 0, paid: 0 };
      d.orders += 1;
      d.closed += status === "Đã hủy" ? 0 : 1;
      d.completed += status === "Hoàn thành" ? 1 : 0;
      d.cancelled += status === "Đã hủy" ? 1 : 0;
      d.revenue += status === "Đã hủy" ? 0 : num(row[c("Khách phải trả")]);
      d.paid += status === "Đã hủy" ? 0 : num(row[c("Khách đã trả")]);
      m.set(date, d);
      return m;
    }, new Map())].sort()),
  };
}

const requested = process.argv[2];
const result = requested === "shopee" ? { shopee: await analyzeShopee() }
  : requested === "tiktok" ? { tiktok: await analyzeTikTok() }
  : requested === "facebook" ? { facebook: await analyzeFacebook() }
  : { shopee: await analyzeShopee(), tiktok: await analyzeTikTok(), facebook: await analyzeFacebook() };
console.log(JSON.stringify(result, null, 2));

import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputDir = "/Users/minhdoanduc/Downloads/1";
const outputDir =
  "/Users/minhdoanduc/Documents/Ai chatbot stopirex/outputs/019fe976-2583-73f3-a746-0a179c39b31a";

const sourceFiles = {
  conversations: path.join(inputDir, "Báo-cáo-chưa-đặt-tên-từ-Tháng-7-1-2026-đến-Tháng-8-10-2026.xlsx"),
  orders: path.join(inputDir, "danh_sach_don_hang_10.08.2026_402e22852ea9de23ddfea73d5ae108e1.xlsx"),
  adsTai: path.join(inputDir, "Phát-Tài-_-Ads-03 (9).xlsx"),
  adsStopirex: path.join(inputDir, "Stopirex-Ads-01 (1).xlsx"),
};

async function importWorkbook(filePath) {
  return SpreadsheetFile.importXlsx(await FileBlob.load(filePath));
}

async function inspectSources() {
  for (const [key, filePath] of Object.entries(sourceFiles)) {
    const wb = await importWorkbook(filePath);
    const sheets = await wb.inspect({ kind: "sheet", include: "id,name", maxChars: 5000 });
    console.log(`SOURCE ${key} ${path.basename(filePath)}`);
    console.log(sheets.ndjson);
    for (const sheet of wb.worksheets.items) {
      const used = sheet.getUsedRange();
      const address = used?.address ?? "A1";
      const rowCount = used?.rowCount ?? 1;
      const colCount = used?.columnCount ?? 1;
      console.log(`SHEET ${sheet.name} USED ${address} ROWS ${rowCount} COLS ${colCount}`);
      const sampleRows = Math.min(rowCount, 18);
      const sampleCols = Math.min(colCount, 30);
      const sample = await wb.inspect({
        kind: "table",
        sheetId: sheet.name,
        range: sheet.getRangeByIndexes(0, 0, sampleRows, sampleCols).address,
        include: "values,formulas",
        tableMaxRows: sampleRows,
        tableMaxCols: sampleCols,
        tableMaxCellChars: 120,
        maxChars: 30000,
      });
      console.log(sample.ndjson);
    }
  }
}

function norm(value) {
  return value == null ? "" : String(value).trim();
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function campaignOwner(name) {
  const text = norm(name);
  const match = text.match(/^([^_\s]+)/);
  return match ? match[1].toUpperCase() : "KHÁC";
}

function findHeaderRow(values) {
  let best = { index: 0, count: -1 };
  values.slice(0, 40).forEach((row, index) => {
    const count = row.filter((v) => norm(v) !== "").length;
    if (count > best.count) best = { index, count };
  });
  return best;
}

function parseIsoDate(value) {
  const text = norm(value);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) : null;
}

function parseVietnameseDate(value) {
  const text = norm(value);
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)) : null;
}

function displayMkt(key) {
  const labels = {
    LONG: "Long MKT",
    TAITT: "Tài Tỏi MKT",
    DUNG: "Dũng MKT",
    CHIẾN: "Chiến MKT",
    CUONG: "Cường MKT",
  };
  return labels[key] ?? `${key} MKT`;
}

async function extractAdsRows() {
  const output = [];
  for (const key of ["conversations", "adsTai", "adsStopirex"]) {
    const wb = await importWorkbook(sourceFiles[key]);
    const sheet =
      wb.worksheets.items.find((item) => item.name === "Raw Data Report") ?? wb.worksheets.getItemAt(0);
    const values = sheet.getUsedRange().values;
    const headerInfo = findHeaderRow(values);
    const headers = values[headerInfo.index].map(norm);
    const col = (label) => headers.indexOf(label);
    const dateCol = col("Ngày");
    const campaignCol = col("Tên chiến dịch");
    const adsetCol = col("Tên nhóm quảng cáo");
    const platformCol = col("Nền tảng");
    const placementCol = col("Vị trí quảng cáo");
    const spendCol = col("Số tiền đã chi tiêu (VND)");
    const leadCol = col("Lượt đăng ký hoàn tất");
    const impressionsCol = col("Lượt hiển thị");
    const accountCol = col("Tên tài khoản");
    const ctrAllCol = col("CTR (tất cả)");
    const ctrLinkCol = col("CTR (tỷ lệ click vào liên kết)");
    const ctrCol = ctrAllCol >= 0 ? ctrAllCol : ctrLinkCol;
    const body = values.slice(headerInfo.index + 1);
    const hasPlacementLeaves = body.some((row) => {
      const campaign = norm(row[campaignCol]);
      return (
        campaign &&
        campaign !== "All" &&
        norm(row[placementCol]) &&
        norm(row[placementCol]) !== "All" &&
        norm(row[platformCol]) !== "All"
      );
    });
    for (const row of body) {
      const date = parseIsoDate(row[dateCol]);
      const campaign = norm(row[campaignCol]);
      const placement = norm(row[placementCol]);
      const platform = norm(row[platformCol]);
      const selectedLevel = hasPlacementLeaves
        ? placement !== "All" && platform !== "All"
        : norm(row[adsetCol]) === "All";
      if (!selectedLevel || !date || !campaign || campaign === "All") continue;
      // Business rule confirmed by the user: every campaign from every Ads file
      // belongs to Long MKT, regardless of campaign-name prefix.
      const mkt = "LONG";
      const impressions = numeric(row[impressionsCol]);
      const ctrRate = numeric(row[ctrCol]) / 100;
      output.push([
        path.basename(sourceFiles[key]),
        norm(row[accountCol]),
        date,
        campaign,
        mkt,
        numeric(row[spendCol]),
        numeric(row[leadCol]),
        impressions,
        ctrRate,
        impressions * ctrRate,
      ]);
    }
  }
  output.sort((a, b) => a[2] - b[2] || a[4].localeCompare(b[4]) || a[3].localeCompare(b[3]));
  return output;
}

async function extractOrderRows() {
  const wb = await importWorkbook(sourceFiles.orders);
  const sheet = wb.worksheets.getItemAt(0);
  const values = sheet.getUsedRange().values;
  const headerInfo = findHeaderRow(values);
  const headers = values[headerInfo.index].map(norm);
  const col = (label) => headers.indexOf(label);
  const dateCol = col("Ngày chứng từ");
  const orderIdCol = col("Mã ĐH");
  const sourceCol = col("Nguồn");
  const statusCol = col("Trạng thái đơn hàng");
  const revenueCol = col("Khách phải trả");
  const paidCol = col("Khách đã trả");
  const customerCol = col("Tên khách hàng");
  const phoneCol = col("Điện thoại KH");
  const rowsByOrder = new Map();
  for (const row of values.slice(headerInfo.index + 1)) {
    const orderId = norm(row[orderIdCol]);
    if (!orderId || rowsByOrder.has(orderId)) continue;
    const date = parseVietnameseDate(row[dateCol]);
    const source = norm(row[sourceCol]).toUpperCase();
    const revenue = numeric(row[revenueCol]);
    const paid = numeric(row[paidCol]);
    rowsByOrder.set(orderId, [
      date,
      orderId,
      source,
      norm(row[statusCol]),
      revenue,
      paid,
      revenue - paid,
      norm(row[customerCol]),
      norm(row[phoneCol]),
    ]);
  }
  return [...rowsByOrder.values()].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
}

function applyTitleStyle(range, fill = "#173F5F") {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF", size: 15 },
    verticalAlignment: "center",
    horizontalAlignment: "left",
  };
  range.format.rowHeight = 30;
}

function applyHeaderStyle(range, fill = "#20639B") {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF", size: 10 },
    verticalAlignment: "center",
    horizontalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#9FBAD0" },
  };
}

async function buildReport() {
  await fs.mkdir(outputDir, { recursive: true });
  const [adsRows, orderRows] = await Promise.all([extractAdsRows(), extractOrderRows()]);
  const periodStart = new Date(Date.UTC(2026, 7, 1, 12));
  const periodEnd = new Date(Date.UTC(2026, 7, 10, 12));
  const reportMkts = [...new Set(orderRows.map((r) => r[2]).filter(Boolean))].sort();

  const workbook = Workbook.create();
  const report = workbook.worksheets.add("Báo cáo");
  const daily = workbook.worksheets.add("Theo ngày");
  const ads = workbook.worksheets.add("Ads_Data");
  const orders = workbook.worksheets.add("Orders_Data");
  const qc = workbook.worksheets.add("Quy tắc & QC");

  for (const sheet of workbook.worksheets.items) sheet.showGridLines = false;

  // Source/clean data sheets
  const adsHeaders = [
    [
      "File nguồn",
      "Tài khoản Ads",
      "Ngày",
      "Tên chiến dịch",
      "MKT chuẩn hóa",
      "Chi phí Ads",
      "Tin nhắn",
      "Lượt hiển thị",
      "CTR",
      "CTR x hiển thị",
    ],
  ];
  ads.getRange("A1:J1").values = adsHeaders;
  if (adsRows.length) ads.getRangeByIndexes(1, 0, adsRows.length, 10).values = adsRows;
  applyHeaderStyle(ads.getRange("A1:J1"));
  ads.freezePanes.freezeRows(1);
  ads.getRange(`C2:C${adsRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
  ads.getRange(`F2:F${adsRows.length + 1}`).format.numberFormat = '#,##0 "đ"';
  ads.getRange(`G2:H${adsRows.length + 1}`).format.numberFormat = "#,##0";
  ads.getRange(`I2:I${adsRows.length + 1}`).format.numberFormat = "0.00%";
  ads.getRange(`J2:J${adsRows.length + 1}`).format.numberFormat = "#,##0.00";
  ads.getRange("A:A").format.columnWidth = 34;
  ads.getRange("B:B").format.columnWidth = 18;
  ads.getRange("C:C").format.columnWidth = 12;
  ads.getRange("D:D").format.columnWidth = 42;
  ads.getRange("E:E").format.columnWidth = 14;
  ads.getRange("F:J").format.columnWidth = 15;
  if (adsRows.length) {
    const adsTable = ads.tables.add(`A1:J${adsRows.length + 1}`, true, "AdsDataTable");
    adsTable.style = "TableStyleMedium2";
  }

  const orderHeaders = [
    [
      "Ngày",
      "Mã đơn",
      "Nguồn/MKT",
      "Trạng thái đơn hàng",
      "Doanh thu tạm tính",
      "Thực thu",
      "Còn nợ",
      "Khách hàng",
      "Số điện thoại",
    ],
  ];
  orders.getRange("A1:I1").values = orderHeaders;
  if (orderRows.length) orders.getRangeByIndexes(1, 0, orderRows.length, 9).values = orderRows;
  applyHeaderStyle(orders.getRange("A1:I1"));
  orders.freezePanes.freezeRows(1);
  orders.getRange(`A2:A${orderRows.length + 1}`).format.numberFormat = "yyyy-mm-dd";
  orders.getRange(`E2:G${orderRows.length + 1}`).format.numberFormat = '#,##0 "đ"';
  orders.getRange("A:A").format.columnWidth = 12;
  orders.getRange("B:B").format.columnWidth = 18;
  orders.getRange("C:C").format.columnWidth = 14;
  orders.getRange("D:D").format.columnWidth = 22;
  orders.getRange("E:G").format.columnWidth = 19;
  orders.getRange("H:H").format.columnWidth = 24;
  orders.getRange("I:I").format.columnWidth = 16;
  if (orderRows.length) {
    const orderTable = orders.tables.add(`A1:I${orderRows.length + 1}`, true, "OrdersDataTable");
    orderTable.style = "TableStyleMedium4";
  }

  // Assumptions, mapping and QA
  qc.mergeCells("A1:F1");
  qc.getRange("A1").values = [["QUY TẮC TÍNH & KIỂM TRA DỮ LIỆU"]];
  applyTitleStyle(qc.getRange("A1:F1"));
  qc.getRange("A3:B5").values = [
    ["Kỳ báo cáo", "Giá trị"],
    ["Từ ngày", periodStart],
    ["Đến ngày", periodEnd],
  ];
  applyHeaderStyle(qc.getRange("A3:B3"), "#3CAEA3");
  qc.getRange("B4:B5").format = {
    fill: "#FFF2CC",
    numberFormat: "yyyy-mm-dd",
    font: { color: "#7F6000", bold: true },
  };
  qc.getRange("D3:F3").values = [["Mã MKT", "Tên hiển thị", "Cách nhận diện"]];
  applyHeaderStyle(qc.getRange("D3:F3"), "#3CAEA3");
  const allMkts = [...new Set(adsRows.map((r) => r[4]).concat(reportMkts))].sort();
  const mapRows = allMkts.map((mkt) => [
    mkt,
    displayMkt(mkt),
    mkt === "LONG" ? "Tất cả chiến dịch trong 3 file Ads / Nguồn Sapo LONG" : `Nguồn Sapo ${mkt}`,
  ]);
  if (mapRows.length) qc.getRangeByIndexes(3, 3, mapRows.length, 3).values = mapRows;
  const ruleTitleRow = 10;
  qc.getRange(`A${ruleTitleRow}:F${ruleTitleRow}`).merge();
  qc.getRange(`A${ruleTitleRow}`).values = [["ĐỊNH NGHĨA CHỈ SỐ"]];
  applyHeaderStyle(qc.getRange(`A${ruleTitleRow}:F${ruleTitleRow}`), "#F6A623");
  const ruleRows = [
    ["Tin nhắn", "Lượt đăng ký hoàn tất trong file Meta (khớp cách tính CPL ở mẫu)."],
    ["Đơn chốt", "Tất cả đơn Sapo trong kỳ, loại trừ trạng thái Đã hủy."],
    ["Doanh thu tạm tính", "Tổng cột Khách phải trả của đơn không bị hủy."],
    ["Doanh thu thực tế", "Tổng cột Khách đã trả của đơn không bị hủy."],
    ["MER", "Chi phí Ads / Doanh thu, theo đúng công thức thể hiện trong mẫu người dùng."],
    ["CTR", "Bình quân gia quyền theo lượt hiển thị của CTR do Meta báo cáo."],
    ["Tỷ lệ giao thành công", "Đơn Hoàn thành / Tổng số đơn trong kỳ."],
    [
      "Quy tắc gán MKT",
      "Toàn bộ chiến dịch trong tất cả file Ads đều được gán cho Long MKT theo xác nhận của người dùng.",
    ],
    ["Kỳ dữ liệu", "01–10/08/2026 theo các file Ads và Sapo cập nhật mới nhất."],
  ];
  qc.getRangeByIndexes(ruleTitleRow, 0, ruleRows.length, 2).values = ruleRows;
  qc.getRange(`A${ruleTitleRow + 1}:A${ruleTitleRow + ruleRows.length}`).format.font = {
    bold: true,
    color: "#173F5F",
  };
  qc.getRange(`B${ruleTitleRow + 1}:B${ruleTitleRow + ruleRows.length}`).format.wrapText = true;
  const srcStart = 21;
  qc.getRange(`A${srcStart}:F${srcStart}`).merge();
  qc.getRange(`A${srcStart}`).values = [["NGUỒN DỮ LIỆU"]];
  applyHeaderStyle(qc.getRange(`A${srcStart}:F${srcStart}`), "#20639B");
  const sourceNotes = Object.values(sourceFiles).map((filePath) => [path.basename(filePath)]);
  qc.getRangeByIndexes(srcStart, 0, sourceNotes.length, 1).values = sourceNotes;
  qc.getRange(`D${srcStart + 1}:F${srcStart + 4}`).values = [
    ["QC", "Số dòng Ads đã chọn", adsRows.length],
    ["QC", "Số đơn duy nhất", orderRows.length],
    ["QC", "Nguồn đơn Sapo", reportMkts.join(", ")],
    [
      "QC",
      "MKT Ads không có đơn Sapo",
      allMkts.filter((x) => !reportMkts.includes(x)).join(", ") || "Không có",
    ],
  ];
  qc.getRange("A:A").format.columnWidth = 25;
  qc.getRange("B:B").format.columnWidth = 65;
  qc.getRange("C:C").format.columnWidth = 12;
  qc.getRange("D:D").format.columnWidth = 27;
  qc.getRange("E:E").format.columnWidth = 28;
  qc.getRange("F:F").format.columnWidth = 50;

  const adsEnd = adsRows.length + 1;
  const ordersEnd = orderRows.length + 1;
  const reportStartRow = 5;
  const reportDataStart = 6;
  const reportDataEnd = reportDataStart + reportMkts.length - 1;

  // Main report
  report.mergeCells("A1:K1");
  report.getRange("A1").values = [["📊 CHI TIẾT HIỆU QUẢ THEO NGƯỜI CHẠY ADS (MKT)"]];
  applyTitleStyle(report.getRange("A1:K1"));
  report.getRange("A2:D2").values = [["Kỳ báo cáo", null, "Đến", null]];
  report.getRange("B2").formulas = [["='Quy tắc & QC'!B4"]];
  report.getRange("D2").formulas = [["='Quy tắc & QC'!B5"]];
  report.getRange("B2").format.numberFormat = "dd/mm/yyyy";
  report.getRange("D2").format.numberFormat = "dd/mm/yyyy";
  report.getRange("A2:D2").format = {
    fill: "#EAF2F8",
    font: { bold: true, color: "#173F5F" },
    borders: { preset: "outside", style: "thin", color: "#B8CCE0" },
  };
  report.getRange(`A${reportStartRow}:K${reportStartRow}`).values = [
    [
      "MKT (Người chạy)",
      "Chi phí Ads",
      "Tin nhắn",
      "CPL",
      "Đơn chốt",
      "Doanh thu tạm tính (Sapo)",
      "Doanh thu thực tế (Sapo)",
      "CPA (Đơn chốt)",
      "MER (Tạm tính)",
      "MER (Thực tế)",
      "CTR",
    ],
  ];
  applyHeaderStyle(report.getRange(`A${reportStartRow}:K${reportStartRow}`));
  report.getRange(`A${reportDataStart}:A${reportDataEnd}`).values = reportMkts.map((mkt) => [
    displayMkt(mkt),
  ]);
  report.getRange(`L${reportStartRow}`).values = [["MKT key"]];
  report.getRange(`L${reportDataStart}:L${reportDataEnd}`).values = reportMkts.map((mkt) => [mkt]);
  for (let r = reportDataStart; r <= reportDataEnd; r++) {
    report.getRange(`B${r}`).formulas = [
      [
        `=SUMIFS('Ads_Data'!$F$2:$F$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},$L${r},'Ads_Data'!$C$2:$C$${adsEnd},">="&$B$2,'Ads_Data'!$C$2:$C$${adsEnd},"<="&$D$2)`,
      ],
    ];
    report.getRange(`C${r}`).formulas = [
      [
        `=SUMIFS('Ads_Data'!$G$2:$G$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},$L${r},'Ads_Data'!$C$2:$C$${adsEnd},">="&$B$2,'Ads_Data'!$C$2:$C$${adsEnd},"<="&$D$2)`,
      ],
    ];
    report.getRange(`D${r}`).formulas = [[`=IFERROR(B${r}/C${r},0)`]];
    report.getRange(`E${r}`).formulas = [
      [
        `=COUNTIFS('Orders_Data'!$C$2:$C$${ordersEnd},$L${r},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2,'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    report.getRange(`F${r}`).formulas = [
      [
        `=SUMIFS('Orders_Data'!$E$2:$E$${ordersEnd},'Orders_Data'!$C$2:$C$${ordersEnd},$L${r},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2,'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    report.getRange(`G${r}`).formulas = [
      [
        `=SUMIFS('Orders_Data'!$F$2:$F$${ordersEnd},'Orders_Data'!$C$2:$C$${ordersEnd},$L${r},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2,'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    report.getRange(`H${r}`).formulas = [[`=IFERROR(B${r}/E${r},0)`]];
    report.getRange(`I${r}`).formulas = [[`=IFERROR(B${r}/F${r},0)`]];
    report.getRange(`J${r}`).formulas = [[`=IFERROR(B${r}/G${r},0)`]];
    report.getRange(`K${r}`).formulas = [
      [
        `=IFERROR(SUMIFS('Ads_Data'!$J$2:$J$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},$L${r},'Ads_Data'!$C$2:$C$${adsEnd},">="&$B$2,'Ads_Data'!$C$2:$C$${adsEnd},"<="&$D$2)/SUMIFS('Ads_Data'!$H$2:$H$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},$L${r},'Ads_Data'!$C$2:$C$${adsEnd},">="&$B$2,'Ads_Data'!$C$2:$C$${adsEnd},"<="&$D$2),0)`,
      ],
    ];
  }
  report.getRange(`A${reportDataStart}:K${reportDataEnd}`).format = {
    fill: "#F8FBFD",
    borders: { preset: "all", style: "thin", color: "#D9E2F3" },
    verticalAlignment: "center",
  };
  report.getRange(`A${reportDataStart}:A${reportDataEnd}`).format.font = { bold: true, color: "#173F5F" };
  report.getRange(`B${reportDataStart}:B${reportDataEnd}`).format.numberFormat = '#,##0 "đ"';
  report.getRange(`C${reportDataStart}:C${reportDataEnd}`).format.numberFormat = "#,##0";
  report.getRange(`D${reportDataStart}:D${reportDataEnd}`).format.numberFormat = '#,##0 "đ"';
  report.getRange(`E${reportDataStart}:E${reportDataEnd}`).format.numberFormat = "#,##0";
  report.getRange(`F${reportDataStart}:H${reportDataEnd}`).format.numberFormat = '#,##0 "đ"';
  report.getRange(`I${reportDataStart}:K${reportDataEnd}`).format.numberFormat = "0.00%";
  report.getRange(`L1:L${reportDataEnd}`).format.columnWidth = 0;

  const activityTitleRow = reportDataEnd + 3;
  report.mergeCells(`A${activityTitleRow}:D${activityTitleRow}`);
  report.getRange(`A${activityTitleRow}`).values = [["📦 HOẠT ĐỘNG BÁN HÀNG"]];
  applyTitleStyle(report.getRange(`A${activityTitleRow}:D${activityTitleRow}`), "#3CAEA3");
  const activityStart = activityTitleRow + 1;
  const activityLabels = [
    "Tổng số đơn",
    "Đơn hoàn thành",
    "Đơn hủy",
    "Tỷ lệ giao thành công",
    "Tổng doanh thu",
    "Thực thu (Đã trả)",
    "Còn nợ",
    "Tỷ lệ chốt (Đơn/Hội thoại)",
  ];
  report.getRangeByIndexes(activityStart - 1, 0, activityLabels.length, 1).values = activityLabels.map(
    (x) => [x],
  );
  report.getRange(`A${activityStart}:A${activityStart + activityLabels.length - 1}`).format = {
    fill: "#E8F5F3",
    font: { bold: true, color: "#155E63" },
    borders: { preset: "inside", style: "thin", color: "#B7DCD7" },
  };
  const sourceList = reportMkts.map((mkt) => `"${mkt}"`).join(",");
  report.getRange(`B${activityStart}`).formulas = [
    [
      `=SUM(COUNTIFS('Orders_Data'!$C$2:$C$${ordersEnd},{${sourceList}},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2))`,
    ],
  ];
  report.getRange(`B${activityStart + 1}`).formulas = [
    [
      `=SUM(COUNTIFS('Orders_Data'!$C$2:$C$${ordersEnd},{${sourceList}},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2,'Orders_Data'!$D$2:$D$${ordersEnd},"Hoàn thành"))`,
    ],
  ];
  report.getRange(`B${activityStart + 2}`).formulas = [
    [
      `=SUM(COUNTIFS('Orders_Data'!$C$2:$C$${ordersEnd},{${sourceList}},'Orders_Data'!$A$2:$A$${ordersEnd},">="&$B$2,'Orders_Data'!$A$2:$A$${ordersEnd},"<="&$D$2,'Orders_Data'!$D$2:$D$${ordersEnd},"Đã hủy"))`,
    ],
  ];
  report.getRange(`B${activityStart + 3}`).formulas = [
    [`=IFERROR(B${activityStart + 1}/B${activityStart},0)`],
  ];
  report.getRange(`B${activityStart + 4}`).formulas = [[`=SUM(F${reportDataStart}:F${reportDataEnd})`]];
  report.getRange(`B${activityStart + 5}`).formulas = [[`=SUM(G${reportDataStart}:G${reportDataEnd})`]];
  report.getRange(`B${activityStart + 6}`).formulas = [[`=B${activityStart + 4}-B${activityStart + 5}`]];
  report.getRange(`B${activityStart + 7}`).formulas = [
    [`=IFERROR(SUM(E${reportDataStart}:E${reportDataEnd})/SUM(C${reportDataStart}:C${reportDataEnd}),0)`],
  ];
  report.getRange(`B${activityStart}:B${activityStart + activityLabels.length - 1}`).format = {
    fill: "#FFFFFF",
    font: { bold: true, color: "#173F5F" },
    borders: { preset: "inside", style: "thin", color: "#B7DCD7" },
  };
  report.getRange(`B${activityStart}:B${activityStart + 2}`).format.numberFormat = "#,##0";
  report.getRange(`B${activityStart + 3}`).format.numberFormat = "0.00%";
  report.getRange(`B${activityStart + 4}:B${activityStart + 6}`).format.numberFormat = '#,##0 "đ"';
  report.getRange(`B${activityStart + 7}`).format.numberFormat = "0.00%";
  const noteRow = activityStart + activityLabels.length + 2;
  report.mergeCells(`A${noteRow}:K${noteRow + 1}`);
  report.getRange(`A${noteRow}`).values = [
    [
      "Lưu ý: theo xác nhận của người dùng, toàn bộ chiến dịch trong cả 3 file Ads đều được cộng vào Long MKT. File Sapo được lọc Nguồn = LONG; kỳ báo cáo 01–10/08/2026.",
    ],
  ];
  report.getRange(`A${noteRow}:K${noteRow + 1}`).format = {
    fill: "#FFF4E5",
    font: { italic: true, color: "#7A4E00", size: 9 },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: "#F6C26B" },
  };
  report.getRange(`A${noteRow}:K${noteRow + 1}`).format.rowHeight = 24;
  report.freezePanes.freezeRows(5);
  report.getRange("A:A").format.columnWidth = 20;
  report.getRange("B:D").format.columnWidth = 16;
  report.getRange("E:E").format.columnWidth = 13;
  report.getRange("F:G").format.columnWidth = 23;
  report.getRange("H:H").format.columnWidth = 17;
  report.getRange("I:K").format.columnWidth = 16;
  report.getRange(`5:${reportDataEnd}`).format.rowHeight = 34;

  // Daily audit table
  daily.mergeCells("A1:J1");
  daily.getRange("A1").values = [["HIỆU QUẢ LONG MKT THEO NGÀY"]];
  applyTitleStyle(daily.getRange("A1:J1"));
  daily.getRange("A3:J3").values = [
    [
      "Ngày",
      "Chi phí Ads",
      "Tin nhắn",
      "Đơn chốt",
      "Doanh thu tạm tính",
      "Thực thu",
      "CPL",
      "CPA",
      "MER tạm tính",
      "CTR",
    ],
  ];
  applyHeaderStyle(daily.getRange("A3:J3"));
  const dayRows = [];
  for (let d = 1; d <= 10; d++) dayRows.push([new Date(Date.UTC(2026, 7, d, 12))]);
  daily.getRange("A4:A13").values = dayRows;
  for (let r = 4; r <= 13; r++) {
    daily.getRange(`B${r}`).formulas = [
      [
        `=SUMIFS('Ads_Data'!$F$2:$F$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},"LONG",'Ads_Data'!$C$2:$C$${adsEnd},$A${r})`,
      ],
    ];
    daily.getRange(`C${r}`).formulas = [
      [
        `=SUMIFS('Ads_Data'!$G$2:$G$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},"LONG",'Ads_Data'!$C$2:$C$${adsEnd},$A${r})`,
      ],
    ];
    daily.getRange(`D${r}`).formulas = [
      [
        `=COUNTIFS('Orders_Data'!$C$2:$C$${ordersEnd},"LONG",'Orders_Data'!$A$2:$A$${ordersEnd},$A${r},'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    daily.getRange(`E${r}`).formulas = [
      [
        `=SUMIFS('Orders_Data'!$E$2:$E$${ordersEnd},'Orders_Data'!$C$2:$C$${ordersEnd},"LONG",'Orders_Data'!$A$2:$A$${ordersEnd},$A${r},'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    daily.getRange(`F${r}`).formulas = [
      [
        `=SUMIFS('Orders_Data'!$F$2:$F$${ordersEnd},'Orders_Data'!$C$2:$C$${ordersEnd},"LONG",'Orders_Data'!$A$2:$A$${ordersEnd},$A${r},'Orders_Data'!$D$2:$D$${ordersEnd},"<>Đã hủy")`,
      ],
    ];
    daily.getRange(`G${r}`).formulas = [[`=IFERROR(B${r}/C${r},0)`]];
    daily.getRange(`H${r}`).formulas = [[`=IFERROR(B${r}/D${r},0)`]];
    daily.getRange(`I${r}`).formulas = [[`=IFERROR(B${r}/E${r},0)`]];
    daily.getRange(`J${r}`).formulas = [
      [
        `=IFERROR(SUMIFS('Ads_Data'!$J$2:$J$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},"LONG",'Ads_Data'!$C$2:$C$${adsEnd},$A${r})/SUMIFS('Ads_Data'!$H$2:$H$${adsEnd},'Ads_Data'!$E$2:$E$${adsEnd},"LONG",'Ads_Data'!$C$2:$C$${adsEnd},$A${r}),0)`,
      ],
    ];
  }
  daily.getRange("A4:J13").format = { borders: { preset: "all", style: "thin", color: "#D9E2F3" } };
  daily.getRange("A4:A13").format.numberFormat = "dd/mm/yyyy";
  daily.getRange("B4:B13").format.numberFormat = '#,##0 "đ"';
  daily.getRange("C4:D13").format.numberFormat = "#,##0";
  daily.getRange("E4:H13").format.numberFormat = '#,##0 "đ"';
  daily.getRange("I4:J13").format.numberFormat = "0.00%";
  daily.getRange("A:A").format.columnWidth = 14;
  daily.getRange("B:B").format.columnWidth = 17;
  daily.getRange("C:D").format.columnWidth = 13;
  daily.getRange("E:F").format.columnWidth = 21;
  daily.getRange("G:H").format.columnWidth = 16;
  daily.getRange("I:J").format.columnWidth = 16;
  daily.freezePanes.freezeRows(3);

  const checkMain = await workbook.inspect({
    kind: "table",
    sheetId: "Báo cáo",
    range: `A1:K${noteRow + 1}`,
    include: "values,formulas",
    tableMaxRows: noteRow + 1,
    tableMaxCols: 11,
    maxChars: 18000,
  });
  console.log("MAIN_CHECK");
  console.log(checkMain.ndjson);
  const checkDaily = await workbook.inspect({
    kind: "table",
    sheetId: "Theo ngày",
    range: "A1:J13",
    include: "values,formulas",
    tableMaxRows: 13,
    tableMaxCols: 10,
    maxChars: 12000,
  });
  console.log("DAILY_CHECK");
  console.log(checkDaily.ndjson);
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "final formula error scan",
    maxChars: 10000,
  });
  console.log("FORMULA_ERRORS");
  console.log(errors.ndjson);

  const renderSpecs = [
    ["Báo cáo", `A1:K${noteRow + 1}`, "bao-cao.png"],
    ["Theo ngày", "A1:J13", "theo-ngay.png"],
    ["Ads_Data", `A1:J18`, "ads-data.png"],
    ["Orders_Data", "A1:I18", "orders-data.png"],
    ["Quy tắc & QC", "A1:F26", "quy-tac-qc.png"],
  ];
  for (const [sheetName, range, fileName] of renderSpecs) {
    const preview = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
    await fs.writeFile(path.join(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
  }

  const outputPath = path.join(outputDir, "Bao_cao_hieu_qua_MKT_LONG_01-10_08_2026.xlsx");
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(outputPath);
  console.log(`OUTPUT ${outputPath}`);
}

async function writeGooglePayload() {
  const [adsRows, orderRows] = await Promise.all([extractAdsRows(), extractOrderRows()]);
  const leadActualDaily = [
    ["2026-08-01", 38],
    ["2026-08-02", 39],
    ["2026-08-03", 26],
    ["2026-08-04", 38],
    ["2026-08-05", 28],
    ["2026-08-06", 40],
    ["2026-08-07", 65],
    ["2026-08-08", 44],
    ["2026-08-09", 94],
    ["2026-08-10", 24],
  ];
  const payload = {
    adsRows: adsRows.map((row) =>
      row.map((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)),
    ),
    orderRows: orderRows.map((row) =>
      row.map((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value)),
    ),
    leadActualDaily,
    sourceFiles: Object.values(sourceFiles).map((filePath) => path.basename(filePath)),
  };
  const payloadPath = path.join(outputDir, "google_update_payload.json");
  await fs.writeFile(payloadPath, JSON.stringify(payload));
  console.log(
    JSON.stringify({
      payloadPath,
      adsRows: adsRows.length,
      orderRows: orderRows.length,
      leadActual: leadActualDaily.reduce((sum, row) => sum + row[1], 0),
    }),
  );
}

async function emitGooglePayloadChunk() {
  const type = process.argv[process.argv.indexOf("--payload-chunk") + 1];
  const start = Number(process.argv[process.argv.indexOf("--payload-chunk") + 2] ?? 0);
  const count = Number(process.argv[process.argv.indexOf("--payload-chunk") + 3] ?? 200);
  const payloadPath = path.join(outputDir, "google_update_payload.json");
  const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
  if (type === "ads") console.log(JSON.stringify(payload.adsRows.slice(start, start + count)));
  else if (type === "orders") console.log(JSON.stringify(payload.orderRows.slice(start, start + count)));
  else if (type === "leads") console.log(JSON.stringify(payload.leadActualDaily));
  else if (type === "meta")
    console.log(
      JSON.stringify({
        adsRows: payload.adsRows.length,
        orderRows: payload.orderRows.length,
        sourceFiles: payload.sourceFiles,
      }),
    );
  else throw new Error(`Unknown payload chunk type: ${type}`);
}

async function analyzeSources() {
  const orderWb = await importWorkbook(sourceFiles.orders);
  const orderSheet = orderWb.worksheets.getItemAt(0);
  const orderValues = orderSheet.getUsedRange().values;
  const headerInfo = findHeaderRow(orderValues);
  const headers = orderValues[headerInfo.index].map(norm);
  console.log(`ORDER_HEADER_ROW ${headerInfo.index + 1} NONEMPTY ${headerInfo.count}`);
  headers.forEach((header, index) => {
    if (header) console.log(`ORDER_COL ${index + 1} ${header}`);
  });
  const interesting = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) =>
      /trạng thái|nhân viên|nguồn|tổng|doanh thu|thanh toán|khách|thu|nợ|mã đơn|ngày tạo|phí|tiền/i.test(
        header,
      ),
    );
  for (const { header, index } of interesting) {
    const values = orderValues
      .slice(headerInfo.index + 1)
      .map((r) => norm(r[index]))
      .filter(Boolean);
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`ORDER_UNIQUE ${index + 1} ${header} ${JSON.stringify(top)}`);
  }
  const orderCol = (label) => headers.indexOf(label);
  const orderDateCol = orderCol("Ngày chứng từ");
  const orderIdCol = orderCol("Mã ĐH");
  const orderStatusCol = orderCol("Trạng thái đơn hàng");
  const orderRevenueCol = orderCol("Khách phải trả");
  const orderPaidCol = orderCol("Khách đã trả");
  const orderSourceCol = orderCol("Nguồn");
  const orderDaily = new Map();
  for (const row of orderValues.slice(headerInfo.index + 1)) {
    const id = norm(row[orderIdCol]);
    if (!id) continue;
    const date = norm(row[orderDateCol]).slice(0, 10);
    const source = norm(row[orderSourceCol]).toUpperCase();
    const key = `${date}|${source}`;
    const b = orderDaily.get(key) ?? {
      date,
      source,
      orders: new Set(),
      completed: new Set(),
      cancelled: new Set(),
      revenue: 0,
      paid: 0,
    };
    if (!b.orders.has(id)) {
      b.orders.add(id);
      if (norm(row[orderStatusCol]) === "Hoàn thành") b.completed.add(id);
      if (norm(row[orderStatusCol]) === "Đã hủy") b.cancelled.add(id);
      b.revenue += numeric(row[orderRevenueCol]);
      b.paid += numeric(row[orderPaidCol]);
    }
    orderDaily.set(key, b);
  }
  console.log("ORDER_DAILY");
  for (const b of [...orderDaily.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(
      JSON.stringify({
        ...b,
        orders: b.orders.size,
        completed: b.completed.size,
        cancelled: b.cancelled.size,
      }),
    );
  }

  for (const key of ["conversations", "adsTai", "adsStopirex"]) {
    const wb = await importWorkbook(sourceFiles[key]);
    const sheet =
      wb.worksheets.items.find((item) => item.name === "Raw Data Report") ?? wb.worksheets.getItemAt(0);
    const values = sheet.getUsedRange().values;
    const headerInfoAds = findHeaderRow(values);
    const hdr = values[headerInfoAds.index].map(norm);
    console.log(`ADS_HEADER ${key} ROW ${headerInfoAds.index + 1} ${JSON.stringify(hdr)}`);
    const col = (label) => hdr.indexOf(label);
    const dateCol = col("Ngày");
    const campaignCol = col("Tên chiến dịch");
    const platformCol = col("Nền tảng");
    const placementCol = col("Vị trí quảng cáo");
    const spendCol = col("Số tiền đã chi tiêu (VND)");
    const leadCol = col("Lượt đăng ký hoàn tất");
    const impressionsCol = col("Lượt hiển thị");
    const startMsgCol = col("Lượt bắt đầu cuộc trò chuyện qua tin nhắn");
    const responseMsgCol = col("Lượt phản hồi cuộc trò chuyện qua tin nhắn");
    const body = values.slice(headerInfoAds.index + 1);
    const hasPlacementLeaves = body.some((row) => {
      const campaign = norm(row[campaignCol]);
      return (
        campaign &&
        campaign !== "All" &&
        norm(row[placementCol]) &&
        norm(row[placementCol]) !== "All" &&
        norm(row[platformCol]) !== "All"
      );
    });
    const adsetCol = col("Tên nhóm quảng cáo");
    const daily = new Map();
    for (const row of body) {
      const date = norm(row[dateCol]);
      const campaign = norm(row[campaignCol]);
      const placement = norm(row[placementCol]);
      const platform = norm(row[platformCol]);
      const isLeaf = hasPlacementLeaves
        ? placement !== "All" && platform !== "All"
        : norm(row[adsetCol]) === "All";
      if (!isLeaf || !date || !campaign || campaign === "All") continue;
      const owner = campaignOwner(campaign);
      const bucketKey = `${date}|${owner}`;
      const bucket = daily.get(bucketKey) ?? {
        date,
        owner,
        spend: 0,
        leads: 0,
        starts: 0,
        responses: 0,
        impressions: 0,
        rows: 0,
      };
      bucket.spend += numeric(row[spendCol]);
      bucket.leads += numeric(row[leadCol]);
      bucket.starts += numeric(row[startMsgCol]);
      bucket.responses += numeric(row[responseMsgCol]);
      bucket.impressions += numeric(row[impressionsCol]);
      bucket.rows += 1;
      daily.set(bucketKey, bucket);
    }
    const summary = new Map();
    for (const b of daily.values()) {
      const s = summary.get(b.owner) ?? {
        owner: b.owner,
        spend: 0,
        leads: 0,
        starts: 0,
        responses: 0,
        impressions: 0,
        dates: new Set(),
        rows: 0,
      };
      s.spend += b.spend;
      s.leads += b.leads;
      s.starts += b.starts;
      s.responses += b.responses;
      s.impressions += b.impressions;
      s.dates.add(b.date);
      s.rows += b.rows;
      summary.set(b.owner, s);
    }
    console.log(`ADS_SUMMARY ${key}`);
    for (const s of [...summary.values()].sort((a, b) => b.spend - a.spend)) {
      console.log(JSON.stringify({ ...s, dates: [...s.dates].sort() }));
    }
    console.log(`ADS_DAILY ${key}`);
    for (const b of [...daily.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.owner.localeCompare(b.owner),
    )) {
      console.log(JSON.stringify(b));
    }
  }
}

if (process.argv.includes("--inspect")) {
  await inspectSources();
}

if (process.argv.includes("--analyze")) {
  await analyzeSources();
}

if (process.argv.includes("--build")) {
  await buildReport();
}

if (process.argv.includes("--google-payload")) {
  await writeGooglePayload();
}

if (process.argv.includes("--payload-chunk")) {
  await emitGooglePayloadChunk();
}

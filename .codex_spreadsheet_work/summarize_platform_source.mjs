import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = {
  shopee: "/Volumes/lưu trữ/Stopirex/shoppe/Order.all.20260711_20260810.xlsx",
  tiktok: "/Volumes/lưu trữ/Stopirex/tiktok/Shop Analytics_Key metrics_20260810.xlsx",
  facebook:
    "/Volumes/lưu trữ/Stopirex/facebook/danh_sach_don_hang_10.08.2026_1cd6393886028e2b8a8675f8a11412c1.xlsx",
};

const key = process.argv[2];
if (!files[key]) throw new Error(`Unknown source key: ${key}`);

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(files[key]));
const output = { file: path.basename(files[key]), sheets: [] };
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  const values = used?.values ?? [];
  const rowCount = used?.rowCount ?? 0;
  const colCount = used?.columnCount ?? 0;
  output.sheets.push({
    name: sheet.name,
    address: used?.address ?? "",
    rowCount,
    colCount,
    sample: values.slice(0, Math.min(rowCount, 15)).map((row) => row.slice(0, Math.min(colCount, 35))),
  });
}
console.log(JSON.stringify(output, null, 2));

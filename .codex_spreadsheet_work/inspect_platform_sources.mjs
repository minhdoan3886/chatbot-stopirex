import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const allFiles = [
  "/Volumes/lưu trữ/Stopirex/shoppe/Order.all.20260711_20260810.xlsx",
  "/Volumes/lưu trữ/Stopirex/tiktok/Shop Analytics_Key metrics_20260810.xlsx",
  "/Volumes/lưu trữ/Stopirex/facebook/danh_sach_don_hang_10.08.2026_1cd6393886028e2b8a8675f8a11412c1.xlsx",
];
const requested = process.argv[2];
const files = requested ? allFiles.filter((file) => file.includes(requested)) : allFiles;

for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  console.log(`FILE ${path.basename(file)}`);
  const overview = await workbook.inspect({
    kind: "workbook,sheet,table",
    include: "id,name",
    maxChars: 8000,
    tableMaxRows: 8,
    tableMaxCols: 8,
    tableMaxCellChars: 100,
  });
  console.log(overview.ndjson);

  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange();
    const rowCount = used?.rowCount ?? 1;
    const colCount = used?.columnCount ?? 1;
    console.log(`SHEET ${sheet.name} USED ${used?.address ?? "A1"} ROWS ${rowCount} COLS ${colCount}`);
    const sampleRows = Math.min(rowCount, 24);
    const sampleCols = Math.min(colCount, 40);
    const sample = await workbook.inspect({
      kind: "table",
      sheetId: sheet.name,
      range: sheet.getRangeByIndexes(0, 0, sampleRows, sampleCols).address,
      include: "values,formulas",
      tableMaxRows: sampleRows,
      tableMaxCols: sampleCols,
      tableMaxCellChars: 160,
      maxChars: 50000,
    });
    console.log(sample.ndjson);
  }
}

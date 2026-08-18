import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Volumes/lưu trữ/Stopirex/tiktok ads/Cost_7620380005591302161_2026-08-11 00_11_54.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const output = { file: path.basename(source), sheets: [] };
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
    sample: values.slice(0, Math.min(rowCount, 25)).map((row) => row.slice(0, Math.min(colCount, 50))),
  });
}
console.log(JSON.stringify(output, null, 2));

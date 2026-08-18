import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source =
  "/Users/minhdoanduc/Downloads/BBH - ANH QUÂN - AI BASE - 47476581.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));

const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 5000,
});
globalThis.console.log("SHEETS");
globalThis.console.log(sheets.ndjson);

for (const searchTerm of [
  "truyền thống|truyen thong|lăn thường|lan thuong|hằng ngày|hang ngay|giãn cách|gian cach",
  "2-3 lần|2–3 lần|2 đến 3 lần|2-3 lan|2–3 lan",
  "ngăn tiết mồ hôi|ngan tiet mo hoi|khử mùi|khu mui|tạo hương|tao huong",
]) {
  const result = await workbook.inspect({
    kind: "match",
    searchTerm,
    options: { useRegex: true, maxResults: 120 },
    maxChars: 15000,
  });
  globalThis.console.log(`MATCH ${searchTerm}`);
  globalThis.console.log(result.ndjson);
}

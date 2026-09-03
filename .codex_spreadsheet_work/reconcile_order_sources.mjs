import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = process.argv.slice(2);
const norm = (v) => (v == null ? "" : String(v).trim());
const safe = (v) => (v instanceof Date ? v.toISOString() : v);

function findHeader(values) {
  let best = { index: 0, score: -1 };
  values.slice(0, 60).forEach((row, index) => {
    const labels = row.map(norm);
    const signals = ["Mã ĐH", "Ngày chứng từ", "Nguồn", "Trạng thái đơn hàng", "Mã đơn hàng", "Ngày", "GMV"];
    const score = row.filter((v) => norm(v)).length + signals.filter((s) => labels.includes(s)).length * 100;
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

for (const path of files) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  const workbook = { path, sheets: [] };
  for (let i = 0; i < wb.worksheets.items.length; i++) {
    const sheet = wb.worksheets.getItemAt(i);
    const used = sheet.getUsedRange();
    const values = used?.values ?? [];
    const headerIndex = values.length ? findHeader(values) : 0;
    const headers = (values[headerIndex] ?? []).map(norm);
    const col = (name) => headers.indexOf(name);
    const dataRows = values.slice(headerIndex + 1).filter((r) => r.some((v) => norm(v)));
    const distribution = (name) => {
      const idx = col(name);
      if (idx < 0) return null;
      return Object.fromEntries(
        [
          ...dataRows.reduce((m, r) => {
            const key = norm(r[idx]) || "(trống)";
            m.set(key, (m.get(key) ?? 0) + 1);
            return m;
          }, new Map()),
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30),
      );
    };
    workbook.sheets.push({
      name: sheet.name,
      usedRange: used?.address ?? null,
      rowCount: values.length,
      columnCount: Math.max(0, ...values.map((r) => r.length)),
      headerRow: headerIndex + 1,
      headers,
      samples: dataRows.slice(0, 5).map((r) => r.map(safe)),
      distributions: {
        source: distribution("Nguồn"),
        orderStatus: distribution("Trạng thái đơn hàng"),
        trafficSource: distribution("Nguồn lưu lượng truy cập"),
        contentType: distribution("Loại nội dung"),
        channel: distribution("Kênh"),
      },
    });
  }
  console.log(JSON.stringify(workbook));
}

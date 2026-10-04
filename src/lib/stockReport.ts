import * as XLSX from "xlsx";

/**
 * Отчет «Остатки» из учетной системы (.xls или .xlsx) — источник себестоимости.
 *
 * Себестоимость в нем средняя по тому, что лежит на складе, поэтому есть только у товаров с остатком.
 * С Ozon сопоставляем по коду — штрихкоду: наименования в учете записаны иначе, чем артикулы Ozon
 * («6-205ЛЕО-34. Тапочки леопард» против «6-205ЛЕО-34-35. Тапочки леопард»), а по коду в октябре 2026
 * нашлись все 282 товара шаблона цен.
 */
export interface StockItem {
  barcode: string;
  name: string;
  stock: number;
  /** 0 — себестоимости в учете нет: товара нет на складе */
  cogs: number;
}

export interface StockReport {
  /** «04.10.2026 19:32» из строки «отчет создан» */
  createdAt: string | null;
  items: StockItem[];
}

const HEADER_SEARCH_ROWS = 30;

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** Штрихкод как строка: Excel хранит его числом, а у Ozon в одной ячейке их может быть несколько */
export const splitBarcodes = (value: unknown): string[] =>
  String(value ?? "")
    .split(/[,;\s]+/)
    .map((code) => code.trim().replace(/\.0+$/, ""))
    .filter(Boolean);

const formatExcelDate = (value: unknown): string | null => {
  if (typeof value !== "number") return typeof value === "string" && value.trim() ? value.trim() : null;
  const date = XLSX.SSF.parse_date_code(value);
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.d)}.${pad(date.m)}.${date.y} ${pad(date.H)}:${pad(date.M)}`;
};

export async function parseStockReport(file: File): Promise<StockReport> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });

    let createdAt: string | null = null;
    for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, rows.length); i++) {
      const row = rows[i] ?? [];
      const created = row.findIndex((cell) => normalize(cell).startsWith("отчет создан"));
      if (created !== -1) createdAt = formatExcelDate(row[created + 1]);

      const headers = row.map(normalize);
      const code = headers.indexOf("код");
      const cogs = headers.indexOf("себестоимость");
      if (code === -1 || cogs === -1) continue;

      const name = headers.indexOf("наименование");
      const stock = headers.indexOf("остаток");
      const items: StockItem[] = [];
      for (const dataRow of rows.slice(i + 1)) {
        const barcode = splitBarcodes(dataRow?.[code])[0];
        if (!barcode) continue;
        items.push({
          barcode,
          name: name !== -1 ? String(dataRow[name] ?? "").trim() : "",
          stock: stock !== -1 ? Number(dataRow[stock]) || 0 : 0,
          cogs: Math.max(0, Number(dataRow[cogs]) || 0)
        });
      }
      return { createdAt, items };
    }
  }

  throw new Error("Не найдены колонки «Код» и «Себестоимость». Нужен отчет «Остатки» из учетной системы.");
}

export interface StockSync {
  /** Артикул Ozon → себестоимость из учета: только новые и изменившиеся */
  changes: Record<string, number>;
  /** Самые заметные изменения — показать, чтобы сверить глазами */
  biggest: { article: string; from: number; to: number }[];
  matched: number;
  added: number;
  changed: number;
  unchanged: number;
  /** Найдены по коду, но в учете без себестоимости — нет на складе */
  noCogs: number;
  notFound: number;
}

/**
 * Себестоимость из учета для товаров шаблона, по штрихкоду. Округляем до рубля: в учете она средняя
 * по остатку и дрожит в копейках, а в Ozon так и так хранится в рублях — иначе каждая приемка
 * давала бы десятки «изменений».
 */
export function syncCogsFromStock(
  report: StockReport,
  items: { article: string; barcodes: string[] }[],
  current: Record<string, number>
): StockSync {
  const byBarcode = new Map(report.items.map((item) => [item.barcode, item]));
  const sync: StockSync = { changes: {}, biggest: [], matched: 0, added: 0, changed: 0, unchanged: 0, noCogs: 0, notFound: 0 };
  const diffs: { article: string; from: number; to: number }[] = [];

  for (const { article, barcodes } of items) {
    const stockItem = barcodes.map((code) => byBarcode.get(code)).find(Boolean);
    if (!stockItem) {
      sync.notFound++;
      continue;
    }
    sync.matched++;
    if (stockItem.cogs <= 0) {
      sync.noCogs++;
      continue;
    }

    const cogs = Math.round(stockItem.cogs);
    const was = current[article];
    if (!(was > 0)) {
      sync.added++;
      sync.changes[article] = cogs;
    } else if (cogs !== was) {
      sync.changed++;
      sync.changes[article] = cogs;
      diffs.push({ article, from: was, to: cogs });
    } else {
      sync.unchanged++;
    }
  }

  sync.biggest = diffs.sort((a, b) => Math.abs(b.to / b.from - 1) - Math.abs(a.to / a.from - 1)).slice(0, 3);
  return sync;
}

import * as XLSX from "xlsx";
import { columnName, type ParsedTemplate } from "./repricer";
import { splitBarcodes } from "./stockReport";
import type { OzonLivePrice } from "./ozonApi";
import type { AccrualsSummary } from "./parseAccruals";

/**
 * Проверка: дает ли Ozon API те же данные, что файлы, которые сейчас скачиваются вручную.
 * Только расчеты, без сети: страница проверки получает данные и сравнивает их здесь.
 */

/** Строка шаблона цен в тех полях, которые есть и в API */
export interface PriceRow {
  article: string;
  sku: string | null;
  price: number | null;
  oldPrice: number | null;
  minPrice: number | null;
  netPrice: number | null;
  /** Ставка как доля: 22% → 0.22 */
  vat: number | null;
  indexOzon: number | null;
  indexExternal: number | null;
  indexSelf: number | null;
  barcodes: string[] | null;
  buyerPrice: number | null;
}

type FieldKind = "money" | "index" | "rate" | "list";

export const PRICE_FIELDS: { key: Exclude<keyof PriceRow, "article" | "sku">; label: string; kind: FieldKind }[] = [
  { key: "price", label: "Предельная цена", kind: "money" },
  { key: "oldPrice", label: "Зачёркнутая цена", kind: "money" },
  { key: "minPrice", label: "Ограничение для акций и стратегий", kind: "money" },
  { key: "netPrice", label: "Себестоимость", kind: "money" },
  { key: "vat", label: "НДС", kind: "rate" },
  { key: "indexSelf", label: "Индекс «на рынке на мои товары» — по нему кнопка «По индексу»", kind: "index" },
  { key: "indexOzon", label: "Индекс «на Ozon»", kind: "index" },
  { key: "indexExternal", label: "Индекс «на рынке»", kind: "index" },
  { key: "barcodes", label: "Штрихкоды", kind: "list" },
  { key: "buyerPrice", label: "Цена реализации (для покупателя)", kind: "money" }
];

const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : parseFloat(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

/** «22» → 0.22; «Не облагается» → 0 */
const vatRate = (value: unknown): number | null => {
  if (/не облага|без ндс/i.test(String(value ?? ""))) return 0;
  const parsed = number(value);
  return parsed === null ? null : parsed > 1 ? parsed / 100 : parsed;
};

/** Колонка по точному названию без единиц: «НДС» не должна поймать «Новый НДС, %» */
function findColumn(headers: string[], names: string[]): number {
  for (const name of names) {
    const index = headers.findIndex((header) => normalize(columnName(header)) === normalize(name));
    if (index !== -1) return index;
  }
  return -1;
}

/** Шаблон цен в полях, которые можно сравнить с API */
export function templatePriceRows(parsed: ParsedTemplate): PriceRow[] {
  const sheet = parsed.workbook.Sheets[parsed.sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  const { headers, columns } = parsed;
  const col = {
    sku: findColumn(headers, ["SKU"]),
    minPrice: findColumn(headers, ["Ограничение для акций и стратегий", "Минимальная цена"]),
    vat: findColumn(headers, ["НДС"]),
    indexOzon: findColumn(headers, ["Ценовой индекс товара на Ozon"]),
    indexExternal: findColumn(headers, ["Ценовой индекс товара на рынке"]),
    indexSelf: findColumn(headers, ["Ценовой индекс товара на рынке на мои товары"])
  };
  const cell = (row: unknown[], index: number) => (index === -1 ? null : row[index]);

  return parsed.items.map((item) => {
    const row = rows[item.rowIndex] ?? [];
    const index = (value: unknown) => {
      const parsedIndex = number(value);
      return parsedIndex !== null && parsedIndex > 0 ? parsedIndex : null;
    };
    const sku = cell(row, col.sku);
    return {
      article: item.article,
      sku: sku === null || sku === undefined || sku === "" ? null : String(sku).replace(/\.0+$/, ""),
      price: number(cell(row, columns.currentPrice)),
      oldPrice: number(cell(row, columns.strikePrice)),
      minPrice: number(cell(row, col.minPrice)),
      netPrice: number(cell(row, columns.cogs)),
      vat: vatRate(cell(row, col.vat)),
      indexOzon: index(cell(row, col.indexOzon)),
      indexExternal: index(cell(row, col.indexExternal)),
      indexSelf: index(cell(row, col.indexSelf)),
      barcodes: columns.barcode === -1 ? null : splitBarcodes(row[columns.barcode]),
      buyerPrice: number(cell(row, columns.customerPrice))
    };
  });
}

/** То же из API: цены и индексы, штрихкоды, цена для покупателя (если Ozon ее отдал) */
export function apiPriceRows(
  live: Map<string, OzonLivePrice>,
  barcodes: Map<string, string[]> | null,
  buyerPrices: Map<string, number> | null
): Map<string, PriceRow> {
  const rows = new Map<string, PriceRow>();
  for (const [article, price] of live) {
    rows.set(article, {
      article,
      sku: null,
      price: price.price,
      oldPrice: price.oldPrice,
      minPrice: price.minPrice,
      netPrice: price.netPrice,
      vat: price.vat === null ? null : Number(price.vat),
      indexOzon: price.indexes.ozon,
      indexExternal: price.indexes.external,
      indexSelf: price.indexes.self,
      barcodes: barcodes ? barcodes.get(article) ?? [] : null,
      buyerPrice: buyerPrices ? buyerPrices.get(article) ?? null : null
    });
  }
  return rows;
}

export interface FieldCheck {
  key: string;
  label: string;
  compared: number;
  matched: number;
  diffs: { article: string; file: string; api: string }[];
  /** Сравнить нельзя: Ozon поле не отдал. Причина */
  unavailable: string | null;
}

export interface RowsComparison {
  checks: FieldCheck[];
  /** Есть в файле, нет в API */
  missing: string[];
  total: number;
}

const TOLERANCE: Record<FieldKind, number> = { money: 0.01, index: 0.005, rate: 0.0001, list: 0 };

const show = (value: PriceRow[keyof PriceRow]) =>
  value === null || value === undefined ? "—" : Array.isArray(value) ? value.join(", ") || "—" : String(value);

/** Значения нет: для денег ноль тоже пусто (нет зачеркнутой цены, нет ограничения), а ставка НДС 0 — настоящая */
function isEmpty(value: PriceRow[keyof PriceRow], kind: FieldKind): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return kind === "money" && value === 0;
}

function sameValue(a: PriceRow[keyof PriceRow], b: PriceRow[keyof PriceRow], kind: FieldKind): boolean {
  if (kind === "list") {
    const left = [...((a as string[] | null) ?? [])].sort().join(",");
    const right = [...((b as string[] | null) ?? [])].sort().join(",");
    return left === right;
  }
  // Пусто и ноль — одно и то же: так Ozon и шаблон показывают отсутствие зачеркнутой цены или ограничения
  const left = (a as number | null) || 0;
  const right = (b as number | null) || 0;
  return Math.abs(left - right) <= TOLERANCE[kind];
}

/** Поле за полем: сколько товаров совпало, и примеры расхождений */
export function compareRows(
  fileRows: PriceRow[],
  apiRows: Map<string, PriceRow>,
  unavailable: Partial<Record<keyof PriceRow, string>> = {}
): RowsComparison {
  const checks: FieldCheck[] = PRICE_FIELDS.map(({ key, label }) => ({
    key,
    label,
    compared: 0,
    matched: 0,
    diffs: [],
    unavailable: unavailable[key] ?? null
  }));
  const missing: string[] = [];

  for (const row of fileRows) {
    const api = apiRows.get(row.article);
    if (!api) {
      missing.push(row.article);
      continue;
    }
    PRICE_FIELDS.forEach(({ key, kind }, i) => {
      const check = checks[i];
      const fileValue = row[key];
      const apiValue = api[key];
      if (check.unavailable) return;
      // Колонки нет в файле или поле не пришло из API — сравнивать нечего
      if (kind === "list" && (fileValue === null || apiValue === null)) return;
      if (isEmpty(fileValue, kind) && isEmpty(apiValue, kind)) return;
      check.compared++;
      if (sameValue(fileValue, apiValue, kind)) check.matched++;
      else if (check.diffs.length < 5) check.diffs.push({ article: row.article, file: show(fileValue), api: show(apiValue) });
    });
  }
  return { checks, missing, total: fileRows.length };
}

/** «Период: 01.10.2026-31.10.2026» → даты по дням, «2026-10-01»… Не больше двух месяцев */
export function periodDates(period: string): string[] | null {
  const match = period.match(/(\d{2})\.(\d{2})\.(\d{4})\s*[-–—]\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  const [, d1, m1, y1, d2, m2, y2] = match;
  const from = Date.UTC(Number(y1), Number(m1) - 1, Number(d1));
  const to = Date.UTC(Number(y2), Number(m2) - 1, Number(d2));
  if (!(to >= from) || to - from > 62 * 86_400_000) return null;
  const dates: string[] = [];
  for (let day = from; day <= to; day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}

/** Начисления из API, сложенные так, чтобы их можно было положить рядом с отчетом Excel */
export interface AccrualTotals {
  days: number;
  pages: number;
  records: number;
  /** Сумма total_amount всех начислений — то же, что «Итого» отчета */
  total: number;
  /** Начисления с типом из справочника: название → сумма */
  byType: Map<string, number>;
  /** Продажи: в API они лежат не типами, а полями комиссии по товару */
  commission: Record<CommissionField, number>;
  /** Типы, которых нет в справочнике: идентификатор → сумма */
  unknownTypes: Map<number, number>;
}

export const COMMISSION_FIELDS = {
  sale_amount: "Реализовано на сумму (похоже на «Выручку»)",
  commission: "Итоговая комиссия (похоже на «Вознаграждение Ozon»)",
  bonus: "Баллы за скидки",
  coinvestment: "Программы партнёров",
  sale_commission: "Комиссия по прайс-листу (для справки)"
} as const;

export type CommissionField = keyof typeof COMMISSION_FIELDS;

export function emptyTotals(): AccrualTotals {
  return {
    days: 0,
    pages: 0,
    records: 0,
    total: 0,
    byType: new Map(),
    commission: { sale_amount: 0, commission: 0, bonus: 0, coinvestment: 0, sale_commission: 0 },
    unknownTypes: new Map()
  };
}

const amountOf = (value: unknown): number => {
  if (typeof value !== "object" || value === null) return 0;
  return number((value as { amount?: unknown }).amount) ?? 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Складывает страницу начислений из /v1/finance/accrual/by-day */
export function addAccrualRecords(totals: AccrualTotals, records: unknown[], typeNames: Map<number, string>) {
  // Услуги с типом лежат в разных местах записи: по товару, по отправлению, по контейнеру, без привязки к товару.
  // Ищем их по форме — { type_id, accrued }, — чтобы не пропустить новое место
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;
    if ("type_id" in node && "accrued" in node) {
      const typeId = Number(node.type_id);
      const amount = amountOf(node.accrued);
      const name = typeNames.get(typeId);
      if (name) totals.byType.set(name, (totals.byType.get(name) ?? 0) + amount);
      else totals.unknownTypes.set(typeId, (totals.unknownTypes.get(typeId) ?? 0) + amount);
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };

  for (const record of records) {
    if (!isRecord(record)) continue;
    totals.records++;
    totals.total += amountOf(record.total_amount);
    visit(record);

    const posting = record.posting;
    const products = isRecord(posting) && Array.isArray(posting.products) ? posting.products : [];
    for (const product of products) {
      if (!isRecord(product) || !isRecord(product.commission)) continue;
      for (const field of Object.keys(COMMISSION_FIELDS) as CommissionField[]) {
        totals.commission[field] += amountOf(product.commission[field]);
      }
    }
  }
}

export interface TypeComparison {
  name: string;
  file: number | null;
  api: number | null;
}

/** Отчет Excel по типам начислений (группы сложены) рядом с API */
export function compareAccrualTypes(summary: AccrualsSummary, apiByType: Map<string, number>): TypeComparison[] {
  const fileByType = new Map<string, number>();
  for (const item of summary.breakdown) fileByType.set(item.type, (fileByType.get(item.type) ?? 0) + item.amount);

  const names = new Set([...fileByType.keys(), ...apiByType.keys()]);
  return [...names]
    .map((name) => ({ name, file: fileByType.get(name) ?? null, api: apiByType.get(name) ?? null }))
    .sort((a, b) => Math.abs(b.file ?? b.api ?? 0) - Math.abs(a.file ?? a.api ?? 0));
}

/** Типы начислений отчета: название → сумма по всем группам. Для сравнения двух отчетов Excel */
export function typeTotals(summary: AccrualsSummary): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of summary.breakdown) totals.set(item.type, (totals.get(item.type) ?? 0) + item.amount);
  return totals;
}

export interface ReportFileSummary {
  kind: "xlsx" | "csv" | "other";
  size: number;
  sheets: string[];
  headers: string[];
  rows: number;
}

/** Что за файл вернул Ozon: формат, колонки и сколько строк */
export function inspectReportFile(bytes: Uint8Array): ReportFileSummary {
  const summary: ReportFileSummary = { kind: "other", size: bytes.length, sheets: [], headers: [], rows: 0 };
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (isZip) {
    const workbook = XLSX.read(bytes, { type: "array" });
    summary.kind = "xlsx";
    summary.sheets = workbook.SheetNames;
    const sheetName = workbook.SheetNames.find((name) => !/инструкц|как работать/i.test(name)) ?? workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1 });
    // Заголовок — самая заполненная из первых строк: над таблицей Ozon пишет период, пояснения и группы колонок
    const filledCells = (row: unknown[] | undefined) => (row ?? []).filter((cell) => String(cell ?? "").trim()).length;
    let headerIndex = -1;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      if (filledCells(rows[i]) >= 3 && (headerIndex === -1 || filledCells(rows[i]) > filledCells(rows[headerIndex]))) headerIndex = i;
    }
    if (headerIndex !== -1) {
      summary.headers = (rows[headerIndex] ?? []).map((cell) => String(cell ?? "").trim()).filter(Boolean);
      summary.rows = rows.length - headerIndex - 1;
    }
    return summary;
  }

  const text = new TextDecoder("utf-8").decode(bytes.slice(0, 2_000_000));
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > 0 && /[;,]/.test(lines[0])) {
    summary.kind = "csv";
    const separator = lines[0].includes(";") ? ";" : ",";
    summary.headers = lines[0].split(separator).map((cell) => cell.replace(/^"|"$/g, "").trim());
    summary.rows = lines.length - 1;
  }
  return summary;
}

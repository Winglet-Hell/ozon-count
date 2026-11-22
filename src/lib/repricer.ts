import * as XLSX from "xlsx";
import { splitBarcodes } from "./stockReport";

export interface RepricerItem {
  id: string; // The SKU or Article
  article: string;
  currentPrice: number;
  newPrice: number | null;
  multiplier: number; // to calculate new price before discount
  priceIndex: number | null; // from 'Ценовой индекс товара на рынке на мои товары'
  customerPrice: number | null; // from 'Цена реализации, руб.' (what the buyer actually pays)
  ozonDiscountPct: number; // calculated discount percentage provided by Ozon
  rowIndex: number; // to keep track of where to write back
  needsAttention?: boolean; // highlight if no index was found
  minPrice?: number | null; // promo floor to export ("Ограничение для акций и стратегий"); computed on the page
  templateCogs: number | null; // COGS stored in Ozon ("Себестоимость", or "Новая себестоимость" if filled in)
  newCogs?: number | null; // COGS to write back to Ozon ("Новая себестоимость"); computed on the page
  barcodes: string[]; // "Штрихкод" — links the item to the accounting system's stock report
}

export interface ParsedTemplate {
  items: RepricerItem[];
  workbook: XLSX.WorkBook;
  sheetName: string;
  headerRowIndex: number;
  columns: TemplateColumns;
  headers: string[]; // the header row as is: Ozon renames columns, so the page names them after the file
  /** "file" — a template downloaded from Ozon; "api" — loaded through the API: same items, but no file to write back into */
  source: "file" | "api";
  /** When the data was taken from Ozon (API only) */
  loadedAt?: string;
}

export interface TemplateColumns {
  article: number;
  strikePrice: number; // "Зачёркнутая цена" — price shown crossed out
  currentPrice: number; // "Предельная цена" (before 19.10.2026 "Предельная цена без акций") — price the seller sets manually
  customerPrice: number;
  priceIndex: number;
  newPrice: number;
  newStrikePrice: number;
  newMinPrice: number;
  cogs: number;
  newCogs: number;
  barcode: number;
  autoDisable: number[]; // "Автоматически добавлять товар в акции", in older templates also "Подключать подходящие акции"
}

// Ozon periodically renames the template columns. Each role lists the known names, current
// first. A header matches by its name — the part before units like ", руб." — exactly
// (case-insensitive, ё/е-insensitive): "Предельная цена" must not catch "Предельная цена
// для минимального бустинга в акциях, руб."
const COLUMN_ALIASES = {
  article: ["Артикул"],
  strikePrice: ["Зачёркнутая цена", "Цена до скидки"],
  currentPrice: ["Предельная цена", "Предельная цена без акций", "Текущая цена (со скидкой)"],
  customerPrice: ["Цена реализации", "Цена с учетом скидки от Ozon"],
  priceIndex: ["Ценовой индекс товара на рынке на мои товары"],
  newPrice: ["Новая предельная цена", "Новая предельная цена без акций", "Новая цена (со скидкой)"],
  newStrikePrice: ["Новая зачёркнутая цена", "Новая цена до скидки"],
  newMinPrice: ["Новое ограничение для акций и стратегий", "Новая минимальная цена"],
  cogs: ["Себестоимость"],
  newCogs: ["Новая себестоимость"],
  barcode: ["Штрихкод"],
} as const;

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");
}

/** Column name without units: "Новая предельная цена, руб." → "Новая предельная цена" */
export function columnName(header: unknown): string {
  return String(header ?? "").split(",")[0].trim();
}

function findColumn(headers: unknown[], aliases: readonly string[]): number {
  // Oldest name first: a template that still has it is an older one, where a newer name may mean
  // another column. Until 19.10.2026 "Предельная цена" was the price with promos, next to the
  // manual "Предельная цена без акций"
  for (const alias of [...aliases].reverse()) {
    const needle = normalizeHeader(alias);
    const idx = headers.findIndex((h) => normalizeHeader(columnName(h)) === needle);
    if (idx !== -1) return idx;
  }
  return -1;
}

function requireColumn(headers: unknown[], aliases: readonly string[]): number {
  const idx = findColumn(headers, aliases);
  if (idx === -1) {
    const [current, ...legacy] = aliases;
    const hint = legacy.length ? ` (в старых шаблонах — ${legacy.map((a) => `'${a}'`).join(", ")})` : "";
    throw new Error(`Не найден столбец '${current}'${hint}. Скачайте актуальный шаблон обновления цен в личном кабинете Ozon.`);
  }
  return idx;
}

export function resolveTemplateColumns(headers: unknown[]): TemplateColumns {
  // Columns that get "НЕТ" on export so Ozon doesn't auto-enroll repriced items into promos
  const autoDisable: number[] = [];
  headers.forEach((h, idx) => {
    const lower = normalizeHeader(h);
    if (lower.includes("подключать") || lower.includes("автоматиче")) {
      autoDisable.push(idx);
    }
  });

  return {
    article: requireColumn(headers, COLUMN_ALIASES.article),
    strikePrice: findColumn(headers, COLUMN_ALIASES.strikePrice),
    currentPrice: requireColumn(headers, COLUMN_ALIASES.currentPrice),
    customerPrice: findColumn(headers, COLUMN_ALIASES.customerPrice),
    priceIndex: findColumn(headers, COLUMN_ALIASES.priceIndex),
    newPrice: requireColumn(headers, COLUMN_ALIASES.newPrice),
    newStrikePrice: findColumn(headers, COLUMN_ALIASES.newStrikePrice),
    newMinPrice: findColumn(headers, COLUMN_ALIASES.newMinPrice),
    cogs: findColumn(headers, COLUMN_ALIASES.cogs),
    newCogs: findColumn(headers, COLUMN_ALIASES.newCogs),
    barcode: findColumn(headers, COLUMN_ALIASES.barcode),
    autoDisable,
  };
}

export async function parseOzonTemplate(file: File): Promise<ParsedTemplate> {
  return parseOzonTemplateData(new Uint8Array(await file.arrayBuffer()));
}

/** The template from its bytes: the page reads them from the chosen file, the checks from a file on disk */
export function parseOzonTemplateData(data: Uint8Array): ParsedTemplate {
  const workbook = XLSX.read(data, { type: "array" });

  const sheetName: string = workbook.SheetNames.find(s => s === "Товары и цены") ||
                            workbook.SheetNames.find(s => s !== "Инструкция" && s !== "Как работать с шаблоном") ||
                            workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Не найден лист 'Товары и цены' или аналогичный.");
  }

  const json = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, json.length); i++) {
    const row = json[i];
    if (row && row.includes("Артикул")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Не удалось найти заголовки таблицы. Убедитесь, что это правильный шаблон обновления цен.");
  }

  const headers = json[headerRowIndex];
  const columns = resolveTemplateColumns(headers);
  const {
    article: articleCol,
    strikePrice: oldPriceCol,
    currentPrice: currentPriceCol,
    newPrice: newPriceCol,
    priceIndex: priceIndexCol,
    customerPrice: customerPriceCol,
    cogs: cogsCol,
    newCogs: newCogsCol,
    barcode: barcodeCol,
  } = columns;

  const items: RepricerItem[] = [];

  // Data starts typically after headers + 1 (the 'Нередактируемое/Редактируемое' row) or immediately after headers
  const dataStartIndex = headerRowIndex + 2;

  for (let i = dataStartIndex; i < json.length; i++) {
    const row = json[i];
    if (!row || row.length === 0) continue;

    const article = row[articleCol];
    if (!article) continue; // Skip empty rows

    const currentPrice = parseFloat(String(row[currentPriceCol]).replace(",", ".")) || 0;
    const oldPrice = oldPriceCol !== -1 ? parseFloat(String(row[oldPriceCol]).replace(",", ".")) || 0 : 0;

    let newPrice: number | null = parseFloat(String(row[newPriceCol]).replace(",", "."));
    if (isNaN(newPrice)) {
      newPrice = null;
    }

    let priceIndex: number | null = priceIndexCol !== -1 ? parseFloat(String(row[priceIndexCol]).replace(",", ".")) : null;
    if (isNaN(priceIndex as number) || priceIndex === 0) {
      priceIndex = null;
    }

    let customerPrice: number | null = customerPriceCol !== -1 ? parseFloat(String(row[customerPriceCol]).replace(",", ".")) : null;
    if (isNaN(customerPrice as number)) {
      customerPrice = null;
    }

    let ozonDiscountPct = 0;
    if (customerPrice && currentPrice > 0 && customerPrice < currentPrice) {
      ozonDiscountPct = 1 - (customerPrice / currentPrice);
    }

    let multiplier = 1.5; // default 33% discount
    if (currentPrice > 0 && oldPrice > currentPrice) {
      multiplier = oldPrice / currentPrice;
    }

    // COGS kept in Ozon; "Новая себестоимость" wins if it was filled in before uploading
    const readCogs = (col: number) => {
      const value = col !== -1 ? parseFloat(String(row[col]).replace(",", ".")) : NaN;
      return value > 0 ? value : null;
    };
    const templateCogs = readCogs(newCogsCol) ?? readCogs(cogsCol);

    items.push({
      id: String(article), // Use article as ID
      article: String(article),
      currentPrice,
      newPrice,
      multiplier,
      priceIndex,
      customerPrice,
      ozonDiscountPct,
      rowIndex: i,
      templateCogs,
      barcodes: barcodeCol !== -1 ? splitBarcodes(row[barcodeCol]) : [],
    });
  }

  return {
    items,
    workbook,
    sheetName,
    headerRowIndex,
    columns,
    headers: Array.from(headers, (h) => String(h ?? "")),
    source: "file",
  };
}

/**
 * «По индексу»: новая цена = текущая / ценовой индекс («на рынке на мои товары»). Товару без индекса —
 * индекс соседнего размера той же модели с ближайшей ценой, а без такого — текущая цена; оба помечаются.
 * onlyRaise: индекс применяется только там, где он поднимает цену, остальные остаются с текущей
 */
export function priceByIndex(items: RepricerItem[], onlyRaise = false): RepricerItem[] {
  const clamp = (item: RepricerItem, price: number) => (onlyRaise ? Math.max(item.currentPrice, price) : price);
  // Model without sizes: the article with digits stripped
  const baseName = (article: string) => article.replace(/\d+/g, "");

  const indexed = new Map(
    items
      .filter((item) => item.priceIndex && item.priceIndex > 0)
      .map((item) => [item.id, { item, baseName: baseName(item.article), newPrice: clamp(item, Math.round(item.currentPrice / item.priceIndex!)) }])
  );
  const indexedList = [...indexed.values()];

  return items.map((item) => {
    const own = indexed.get(item.id);
    if (own) return { ...item, newPrice: own.newPrice, needsAttention: false };

    const candidates = indexedList.filter((entry) => entry.baseName === baseName(item.article));
    if (candidates.length === 0) return { ...item, newPrice: item.currentPrice, needsAttention: true };

    // The sibling with the closest current price
    let best = candidates[0];
    let minDiff = Math.abs(best.item.currentPrice - item.currentPrice);
    for (let i = 1; i < candidates.length; i++) {
      const diff = Math.abs(candidates[i].item.currentPrice - item.currentPrice);
      if (diff < minDiff) {
        best = candidates[i];
        minDiff = diff;
      }
    }
    // Borrow the sibling's index, not its new price: sizes of one model are priced differently,
    // and a copied price would drag a cheap size up to an expensive one. Without a price of its own, take the sibling's
    const newPrice = item.currentPrice > 0 ? Math.round(item.currentPrice / best.item.priceIndex!) : best.newPrice;
    return { ...item, newPrice: clamp(item, newPrice), needsAttention: true };
  });
}

/** What one template row sends to Ozon. null — the cell stays empty, and Ozon keeps what it has */
export interface OzonChange {
  article: string;
  rowIndex: number;
  /** «Новая предельная цена». Without it the strike price, the promo floor and the promo switches stay as they are too */
  price: number | null;
  /** «Новая зачёркнутая цена» */
  oldPrice: number | null;
  /** «Новое ограничение для акций и стратегий» */
  minPrice: number | null;
  /** «Новая себестоимость» */
  netPrice: number | null;
}

/**
 * Everything the app sends to Ozon, row by row. The downloaded file and the API request are both built
 * from it, so they can't drift apart
 */
export function templateChanges(parsed: ParsedTemplate, updatedItems: RepricerItem[]): OzonChange[] {
  const { newStrikePrice, newMinPrice, newCogs } = parsed.columns;
  const changes: OzonChange[] = [];

  for (const item of updatedItems) {
    // COGS goes back to Ozon independently of the price: Ozon keeps it, and the next template brings it along
    const netPrice = newCogs !== -1 && item.newCogs != null ? item.newCogs : null;
    const price = item.newPrice ?? null;
    if (price === null && netPrice === null) continue;

    changes.push({
      article: item.article,
      rowIndex: item.rowIndex,
      price,
      // The strike price follows the new price, so it always stays above it
      oldPrice: price !== null && newStrikePrice !== -1 ? Math.ceil(price * item.multiplier) : null,
      // Promo floor: the page passes a break-even based value (the price itself when it's unknown).
      // No blind fallback here: a 50% floor at Ozon's ~50% commission is a sure loss
      minPrice: price !== null && newMinPrice !== -1 && item.minPrice != null ? item.minPrice : null,
      netPrice,
    });
  }
  return changes;
}

/**
 * Promo switches a new price turns off, by the template columns that set them to «НЕТ». Only the ones the
 * template has: sending through the API must do exactly what the file does
 */
export interface AutoPromoSwitches {
  /** «Подключать подходящие акции» (in templates before 19.10.2026) → auto_action_enabled */
  autoActions: boolean;
  /** «Автоматически добавлять товар в акции» → auto_add_to_ozon_actions_list_enabled */
  autoAdd: boolean;
  /** Columns the file sets to «НЕТ» with no known API field: sending through the API would skip them */
  unknown: string[];
}

export function autoPromoSwitches(parsed: Pick<ParsedTemplate, "columns" | "headers">): AutoPromoSwitches {
  const switches: AutoPromoSwitches = { autoActions: false, autoAdd: false, unknown: [] };
  for (const col of parsed.columns.autoDisable) {
    const header = normalizeHeader(parsed.headers[col]);
    if (header.includes("акци") && header.includes("подключать")) switches.autoActions = true;
    else if (header.includes("акци") && header.includes("добавлять")) switches.autoAdd = true;
    else switches.unknown.push(columnName(parsed.headers[col]));
  }
  return switches;
}

export async function exportOzonTemplate(parsed: ParsedTemplate, updatedItems: RepricerItem[]): Promise<Blob> {
  if (parsed.source === "api") {
    throw new Error("Файл можно собрать только из загруженного шаблона: данные взяты из Ozon напрямую — отправьте их кнопкой «Отправить в Ozon»");
  }
  const { workbook, sheetName } = parsed;
  // Write into a copy of the sheet: the parsed workbook stays as Ozon sent it, so a value from a previous
  // download (a price or COGS changed since) doesn't leak into the next one
  const sheet: XLSX.WorkSheet = { ...workbook.Sheets[sheetName] };
  const setCell = (c: number, r: number, t: "n" | "s", v: number | string) => {
    const ref = XLSX.utils.encode_cell({ c, r });
    sheet[ref] = { ...sheet[ref], t, v };
  };
  const {
    newPrice: newPriceCol,
    newStrikePrice: newStrikePriceCol,
    newMinPrice: minPriceCol,
    newCogs: newCogsCol,
    autoDisable: autoDisableCols,
  } = parsed.columns;

  for (const change of templateChanges(parsed, updatedItems)) {
    const row = change.rowIndex;
    if (change.netPrice !== null) setCell(newCogsCol, row, "n", change.netPrice);
    if (change.price === null) continue;

    setCell(newPriceCol, row, "n", change.price);
    if (change.oldPrice !== null) setCell(newStrikePriceCol, row, "n", change.oldPrice);
    if (change.minPrice !== null) setCell(minPriceCol, row, "n", change.minPrice);
    // Automatically disable auto-promos and auto-connections
    autoDisableCols.forEach((colIdx) => setCell(colIdx, row, "s", "НЕТ"));
  }

  const wbout = XLSX.write({ ...workbook, Sheets: { ...workbook.Sheets, [sheetName]: sheet } }, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

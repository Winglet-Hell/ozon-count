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
}

export interface TemplateColumns {
  article: number;
  strikePrice: number; // "Зачёркнутая цена" — price shown crossed out
  currentPrice: number; // "Предельная цена без акций" — price the seller sets manually
  customerPrice: number;
  priceIndex: number;
  newPrice: number;
  newStrikePrice: number;
  newMinPrice: number;
  cogs: number;
  newCogs: number;
  barcode: number;
  autoDisable: number[]; // "Подключать подходящие акции", "Автоматически добавлять товар в акции"
}

// Ozon periodically renames the template columns. Each role lists the known header
// variants, newest first; a header matches when it starts with the variant
// (case-insensitive, ё/е-insensitive), so suffixes like ", руб." don't matter.
const COLUMN_ALIASES = {
  article: ["Артикул"],
  strikePrice: ["Зачёркнутая цена", "Цена до скидки"],
  currentPrice: ["Предельная цена без акций", "Текущая цена (со скидкой)"],
  customerPrice: ["Цена реализации", "Цена с учетом скидки от Ozon"],
  priceIndex: ["Ценовой индекс товара на рынке на мои товары"],
  newPrice: ["Новая предельная цена без акций", "Новая цена (со скидкой)"],
  newStrikePrice: ["Новая зачёркнутая цена", "Новая цена до скидки"],
  newMinPrice: ["Новое ограничение для акций и стратегий", "Новая минимальная цена"],
  cogs: ["Себестоимость"],
  newCogs: ["Новая себестоимость"],
  barcode: ["Штрихкод"],
} as const;

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

function findColumn(headers: unknown[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const needle = normalizeHeader(alias);
    const idx = headers.findIndex((h) => normalizeHeader(h).startsWith(needle));
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        
        let sheetName: string = workbook.SheetNames.find(s => s === "Товары и цены") || 
                                workbook.SheetNames.find(s => s !== "Инструкция" && s !== "Как работать с шаблоном") || 
                                workbook.SheetNames[0];

        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          throw new Error("Не найден лист 'Товары и цены' или аналогичный.");
        }

        const json = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        
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

        resolve({
          items,
          workbook,
          sheetName,
          headerRowIndex,
          columns,
        });

      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

export async function exportOzonTemplate(parsed: ParsedTemplate, updatedItems: RepricerItem[]): Promise<Blob> {
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
    newStrikePrice: newPriceNoDiscountCol,
    newMinPrice: minPriceCol,
    newCogs: newCogsCol,
    autoDisable: autoDisableCols,
  } = parsed.columns;

  updatedItems.forEach((item) => {
    // COGS goes back to Ozon independently of the price: Ozon keeps it, and the next template brings it along
    if (newCogsCol !== -1 && item.newCogs != null) {
      setCell(newCogsCol, item.rowIndex, "n", item.newCogs);
    }

    if (item.newPrice !== null && item.newPrice !== undefined) {
      setCell(newPriceCol, item.rowIndex, "n", item.newPrice);

      // Automatically calculate "price before discount" to always be greater
      if (newPriceNoDiscountCol !== -1) {
        setCell(newPriceNoDiscountCol, item.rowIndex, "n", Math.ceil(item.newPrice * item.multiplier));
      }

      // Promo floor: the page passes a break-even based value (the price itself when it's unknown).
      // No blind fallback here: a 50% floor at Ozon's ~50% commission is a sure loss
      if (minPriceCol !== -1 && item.minPrice != null) {
        setCell(minPriceCol, item.rowIndex, "n", item.minPrice);
      }

      // Automatically disable auto-promos and auto-connections
      autoDisableCols.forEach((colIdx) => setCell(colIdx, item.rowIndex, "s", "НЕТ"));
    }
  });

  const wbout = XLSX.write({ ...workbook, Sheets: { ...workbook.Sheets, [sheetName]: sheet } }, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

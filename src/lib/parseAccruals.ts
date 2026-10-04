import JSZip from "jszip";

export interface AccrualsBreakdownItem {
  group: string;
  type: string;
  amount: number;
  pctOfInflow: number;
  pctOfOutflow: number;
  pctOfTotalInflowForOutflow: number;
}

export interface SkuTransaction {
  sku: string;
  group: string;
  type: string;
  quantity: number;
  amount: number;
}

export interface AccrualsSummary {
  period: string;
  totalInflow: number;
  totalOutflow: number;
  netResult: number;
  breakdown: AccrualsBreakdownItem[];
  skuTransactions: SkuTransaction[];
}

const getColIndex = (cellRef: string): number => {
  const colLetter = cellRef.replace(/[0-9]/g, "");
  let index = 0;
  for (let i = 0; i < colLetter.length; i++) {
    index = index * 26 + (colLetter.charCodeAt(i) - 64);
  }
  return index - 1;
};

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Ozon экранирует в XML каждый не-ASCII символ (&#x41F;), поэтому значения нужно раскодировать */
const decodeXml = (text: string): string =>
  text.indexOf("&") === -1
    ? text
    : text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) =>
        entity[0] !== "#"
          ? XML_ENTITIES[entity]
          : String.fromCodePoint(entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10))
      );

const ROW_RE = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const CELL_REF_RE = /\br="([A-Z]+)\d*"/;
const CELL_TYPE_RE = /\bt="([^"]*)"/;
const VALUE_RE = /<v>([\s\S]*?)<\/v>/;
const TEXT_RE = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;

/** Текст из <si> или <is>: строка может быть разбита на несколько <t> */
const readRichText = (xml: string): string => {
  let text = "";
  for (const match of xml.matchAll(TEXT_RE)) {
    text += match[1];
  }
  return decodeXml(text);
};

/**
 * Значения ячеек строки по номеру колонки. Ячейки без атрибута r идут подряд за предыдущей.
 * wanted — читать только нужные колонки: в отчете за месяц сотни тысяч строк.
 * decode — раскодирование значения; для отчета начислений с кэшем, потому что группы, типы
 * и артикулы повторяются в сотнях тысяч строк, а каждая кириллическая буква в них экранирована.
 */
const readRowCells = (
  rowXml: string,
  sharedStrings: string[],
  wanted?: boolean[],
  decode: (value: string) => string = decodeXml
): string[] => {
  const cells: string[] = [];
  let col = 0;
  CELL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CELL_RE.exec(rowXml)) !== null) {
    const attrs = match[1];
    const ref = CELL_REF_RE.exec(attrs);
    if (ref) col = getColIndex(ref[1]);

    if (!wanted || wanted[col]) {
      const inner = match[2] ?? "";
      const type = CELL_TYPE_RE.exec(attrs)?.[1];
      if (type === "inlineStr") {
        cells[col] = readRichText(inner);
      } else {
        const value = VALUE_RE.exec(inner)?.[1] ?? "";
        cells[col] = type === "s" ? sharedStrings[parseInt(value, 10)] ?? "" : decode(value);
      }
    }
    col++;
  }
  return cells;
};

const cachedDecoder = (): ((value: string) => string) => {
  const cache = new Map<string, string>();
  return (value) => {
    if (value.indexOf("&") === -1) return value;
    let decoded = cache.get(value);
    if (decoded === undefined) {
      decoded = decodeXml(value);
      cache.set(value, decoded);
    }
    return decoded;
  };
};

const readSharedStrings = async (zip: JSZip): Promise<string[]> => {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("text");
  return Array.from(xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g), (match) => readRichText(match[1] ?? ""));
};

// internalStream — документированный API JSZip, но в index.d.ts его нет
type StreamableZipObject = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

/**
 * Отдает строки листа по одной, не собирая XML целиком. Склеить его в строку нельзя:
 * у браузера лимит ~537 млн символов, а лист отчета за сентябрь 2026 уже занимает 424 млн.
 */
const streamSheetRows = (sheetFile: JSZip.JSZipObject, onRow: (rowXml: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const decoder = new TextDecoder("utf-8");
    let tail = "";
    const emitRows = (xml: string) => {
      ROW_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ROW_RE.exec(xml)) !== null) {
        onRow(match[1] ?? "");
      }
    };

    const stream = (sheetFile as StreamableZipObject).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        try {
          const text = tail + decoder.decode(chunk, { stream: true });
          // Отдаем только завершенные строки, хвост ждет следующего куска
          const end = text.lastIndexOf("</row>");
          if (end === -1) {
            tail = text;
            return;
          }
          emitRows(text.slice(0, end + 6));
          tail = text.slice(end + 6);
        } catch (err) {
          stream.pause();
          reject(err);
        }
      })
      .on("error", reject)
      .on("end", () => {
        try {
          emitRows(tail + decoder.decode());
          resolve();
        } catch (err) {
          reject(err);
        }
      })
      .resume();
  });

interface AccrualsColumns {
  group: number;
  type: number;
  amount: number;
  sku: number;
  qty: number;
}

/** Ozon добавляет и переставляет строки над таблицей — ищем заголовок среди первых строк, а не во второй */
const HEADER_SEARCH_ROWS = 10;

const findAccrualsColumns = (header: string[]): AccrualsColumns | null => {
  const find = (name: string) => header.findIndex((h) => h && h.trim().toLowerCase().includes(name));
  const columns = {
    group: find("группа услуг"),
    type: find("тип начисления"),
    amount: find("сумма итого"),
    sku: find("артикул"),
    qty: find("количество")
  };
  return columns.group !== -1 && columns.type !== -1 && columns.amount !== -1 ? columns : null;
};

export const parseAccrualsReport = async (file: File): Promise<AccrualsSummary> => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sharedStrings = await readSharedStrings(zip);

  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) {
    throw new Error("Не удалось найти рабочий лист xl/worksheets/sheet1.xml в архиве Excel");
  }

  let period = "";
  // Заголовок находится внутри колбэка потока — держим его в объекте, чтобы после await
  // TypeScript не считал колонки так и оставшимися null
  const header: { columns: AccrualsColumns | null; wanted: boolean[] } = { columns: null, wanted: [] };
  let rowCount = 0;
  let totalInflow = 0;
  let totalOutflow = 0;
  const breakdownMap: Record<string, number> = {};
  const skuTransactions: SkuTransaction[] = [];
  const decode = cachedDecoder();

  await streamSheetRows(sheetFile, (rowXml) => {
    rowCount++;

    const columns = header.columns;
    if (!columns) {
      const cells = readRowCells(rowXml, sharedStrings);
      const found = findAccrualsColumns(cells);
      if (found) {
        header.columns = found;
        [found.group, found.type, found.amount, found.sku, found.qty].forEach((idx) => {
          if (idx !== -1) header.wanted[idx] = true;
        });
        return;
      }
      if (!period) {
        period = cells.find((val) => val && (val.includes("Период") || val.toLowerCase().includes("period")))?.trim() ?? "";
      }
      if (rowCount >= HEADER_SEARCH_ROWS) {
        throw new Error(
          "Неверный формат отчета начислений. Убедитесь, что загружаете правильный файл и в нем присутствуют колонки 'Группа услуг', 'Тип начисления' и 'Сумма итого, руб.'"
        );
      }
      return;
    }

    const cells = readRowCells(rowXml, sharedStrings, header.wanted, decode);
    const grp = cells[columns.group]?.trim() || "Без группы";
    const typ = cells[columns.type]?.trim() || "Без типа";
    const amount = parseFloat((cells[columns.amount] ?? "").replace(",", ".")) || 0;
    let sku = columns.sku !== -1 ? cells[columns.sku]?.trim() ?? "" : "";
    if (sku.endsWith(".0")) {
      sku = sku.slice(0, -2);
    }
    const qty = columns.qty !== -1 ? parseFloat(cells[columns.qty] ?? "") || 0 : 0;

    if (amount !== 0) {
      const key = `${grp}::${typ}`;
      breakdownMap[key] = (breakdownMap[key] || 0) + amount;
      if (amount > 0) {
        totalInflow += amount;
      } else {
        totalOutflow += amount;
      }
    }

    if (sku) {
      skuTransactions.push({
        sku,
        group: grp,
        type: typ,
        quantity: qty,
        amount
      });
    }
  });

  if (rowCount === 0) {
    throw new Error("Таблица Excel пуста");
  }
  if (!header.columns) {
    throw new Error(
      "Неверный формат отчета начислений. Убедитесь, что загружаете правильный файл и в нем присутствуют колонки 'Группа услуг', 'Тип начисления' и 'Сумма итого, руб.'"
    );
  }

  const breakdown: AccrualsBreakdownItem[] = [];
  for (const [key, amount] of Object.entries(breakdownMap)) {
    const [group, type] = key.split("::");
    const pctOfInflow = amount > 0 ? (amount / totalInflow) * 100 : 0;
    const pctOfOutflow = amount < 0 ? (Math.abs(amount) / Math.abs(totalOutflow)) * 100 : 0;
    const pctOfTotalInflowForOutflow = amount < 0 ? (Math.abs(amount) / totalInflow) * 100 : 0;

    breakdown.push({
      group,
      type,
      amount,
      pctOfInflow,
      pctOfOutflow,
      pctOfTotalInflowForOutflow
    });
  }

  // Sort: positive (inflow) desc, then negative (outflow) desc by absolute value
  breakdown.sort((a, b) => {
    if (a.amount > 0 && b.amount < 0) return -1;
    if (a.amount < 0 && b.amount > 0) return 1;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });

  return {
    period,
    totalInflow,
    totalOutflow,
    netResult: totalInflow + totalOutflow,
    breakdown,
    skuTransactions
  };
};

export const parseCogsCsv = (csvText: string): Record<string, number> => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return {};

  // Find the header row (usually the one containing Артикул and Себестоимость)
  let headerIndex = -1;
  let skuIndex = -1;
  let cogsIndex = -1;

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = lines[i].split(";");
    const skuIdx = cols.findIndex(c => c.trim().toLowerCase().includes("артикул"));
    const cogsIdx = cols.findIndex(c => c.trim().toLowerCase() === "себестоимость");
    if (skuIdx !== -1 && cogsIdx !== -1) {
      headerIndex = i;
      skuIndex = skuIdx;
      cogsIndex = cogsIdx;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Не удалось найти колонки 'SKU' и 'Себестоимость' в CSV-файле");
  }

  const skuCogs: Record<string, number> = {};

  // Data starts after the header. We also skip helper text lines (like row 3 and 4)
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const row = lines[i].split(";");
    if (row.length > Math.max(skuIndex, cogsIndex)) {
      let sku = row[skuIndex].trim();
      if (sku.startsWith('"') && sku.endsWith('"')) {
        sku = sku.slice(1, -1);
      }
      
      const cogsStr = row[cogsIndex].trim().replace(/\s/g, "").replace(",", ".");
      if (sku && cogsStr) {
        if (sku.toLowerCase().includes("нередактируемое") || cogsStr.toLowerCase().includes("нередактируемое")) {
          continue;
        }
        const cogs = parseFloat(cogsStr);
        if (!isNaN(cogs)) {
          skuCogs[sku] = cogs;
        }
      }
    }
  }

  return skuCogs;
};

export const parseCogsXlsx = async (file: File): Promise<Record<string, number>> => {
  const zip = await JSZip.loadAsync(file);

  // 1. Parse shared strings
  const sharedStrings: string[] = [];
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  if (sharedStringsFile) {
    const ssText = await sharedStringsFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(ssText, "application/xml");
    const siElements = doc.getElementsByTagName("si");
    for (let i = 0; i < siElements.length; i++) {
      sharedStrings.push(siElements[i].textContent || "");
    }
  }

  // 2. Find target worksheet from xl/workbook.xml
  let sheetPath = "xl/worksheets/sheet1.xml"; // default fallback
  const workbookFile = zip.file("xl/workbook.xml");
  if (workbookFile) {
    const wbText = await workbookFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(wbText, "application/xml");
    const sheets = doc.getElementsByTagName("sheet");
    
    // Look for sheet named "Товары и цены"
    let targetSheetId = "";
    for (let i = 0; i < sheets.length; i++) {
      const name = sheets[i].getAttribute("name") || "";
      if (name.toLowerCase().includes("товары и цены") || name.toLowerCase().includes("товары")) {
        const sheetIdAttr = sheets[i].getAttribute("sheetId");
        if (sheetIdAttr) {
          targetSheetId = sheetIdAttr;
        }
        break;
      }
    }
    
    if (targetSheetId) {
      const path1 = `xl/worksheets/sheet${targetSheetId}.xml`;
      if (zip.file(path1)) {
        sheetPath = path1;
      } else {
        const matches = Object.keys(zip.files).filter(k => k.startsWith("xl/worksheets/sheet"));
        if (matches.length >= parseInt(targetSheetId, 10)) {
          sheetPath = matches[parseInt(targetSheetId, 10) - 1];
        }
      }
    }
  }

  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    throw new Error(`Не удалось найти лист с товарами в файле ${sheetPath}`);
  }

  const sheetText = await sheetFile.async("text");
  const parser = new DOMParser();
  const doc = parser.parseFromString(sheetText, "application/xml");
  const rows = doc.getElementsByTagName("row");

  if (rows.length < 2) {
    throw new Error("Файл себестоимости пуст");
  }

  // Find headers from row 2 (index 1)
  const header: string[] = [];
  const r2Cells = rows[1].getElementsByTagName("c");
  let currentIdx = 0;
  for (let i = 0; i < r2Cells.length; i++) {
    const cell = r2Cells[i];
    const rAttr = cell.getAttribute("r");
    if (rAttr) {
      currentIdx = getColIndex(rAttr);
    }
    const t = cell.getAttribute("t");
    const vNode = cell.getElementsByTagName("v")[0];
    const isNode = cell.getElementsByTagName("is")[0];
    let val = "";
    if (t === "s" && vNode) {
      val = sharedStrings[parseInt(vNode.textContent || "0", 10)] || "";
    } else if (isNode) {
      val = isNode.textContent || "";
    } else if (vNode) {
      val = vNode.textContent || "";
    }
    header[currentIdx] = val.trim();
    if (!rAttr) {
      currentIdx++;
    }
  }

  const artColIdx = header.findIndex(h => h && h.toLowerCase().includes("артикул"));
  const cogsColIdx = header.findIndex(h => h && h.toLowerCase() === "себестоимость");
  const newCogsColIdx = header.findIndex(h => h && h.toLowerCase().includes("новая себестоимость"));

  if (artColIdx === -1) {
    throw new Error("Не удалось найти колонку 'Артикул' в файле шаблона себестоимости");
  }
  if (cogsColIdx === -1 && newCogsColIdx === -1) {
    throw new Error("Не удалось найти колонку 'Себестоимость' или 'Новая себестоимость' в файле шаблона");
  }

  const skuCogs: Record<string, number> = {};

  // Parse data rows (start from row 3, index 2)
  for (let r = 2; r < rows.length; r++) {
    const rowEl = rows[r];
    const cells = rowEl.getElementsByTagName("c");
    let art = "";
    let cogsVal = NaN;
    let newCogsVal = NaN;

    let cIdx = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const rAttr = cell.getAttribute("r");
      if (rAttr) {
        cIdx = getColIndex(rAttr);
      }
      const t = cell.getAttribute("t");
      const vNode = cell.getElementsByTagName("v")[0];
      const isNode = cell.getElementsByTagName("is")[0];
      let val = "";
      if (t === "s" && vNode) {
        val = sharedStrings[parseInt(vNode.textContent || "0", 10)] || "";
      } else if (isNode) {
        val = isNode.textContent || "";
      } else if (vNode) {
        val = vNode.textContent || "";
      }

      if (cIdx === artColIdx) {
        art = val.trim();
      } else if (cIdx === cogsColIdx) {
        cogsVal = parseFloat(val);
      } else if (cIdx === newCogsColIdx) {
        newCogsVal = parseFloat(val);
      }

      if (!rAttr) {
        cIdx++;
      }
    }

    if (art) {
      if (art.toLowerCase().includes("нередактируемое")) {
        continue;
      }
      
      let finalCogs = NaN;
      if (!isNaN(newCogsVal)) {
        finalCogs = newCogsVal;
      } else if (!isNaN(cogsVal)) {
        finalCogs = cogsVal;
      }

      if (!isNaN(finalCogs)) {
        skuCogs[art] = finalCogs;
      }
    }
  }

  return skuCogs;
};

const DEFAULT_COGS_TEMPLATE = "Шаблон для обновления цен_18.06.26 (2).xlsx";
const DEFAULT_COGS_CSV = "Товары что мы продаем.csv";

/** Себестоимость снятых с продажи артикулов, которых уже нет в шаблоне */
export const fetchArchivedCogs = async (): Promise<Record<string, number>> => {
  try {
    const res = await fetch("/archived_cogs.csv");
    return res.ok ? parseCogsCsv(await res.text()) : {};
  } catch {
    return {};
  }
};

/** Себестоимость по умолчанию из public: шаблон цен или CSV, дополненные архивом */
export const loadDefaultCogs = async (): Promise<{ cogs: Record<string, number>; fileName: string } | null> => {
  let cogs: Record<string, number> = {};
  let fileName = "";

  try {
    const xlsxRes = await fetch(`/${DEFAULT_COGS_TEMPLATE}`);
    if (xlsxRes.ok) {
      cogs = await parseCogsXlsx(new File([await xlsxRes.blob()], DEFAULT_COGS_TEMPLATE));
      fileName = `${DEFAULT_COGS_TEMPLATE} (авто)`;
    } else {
      const csvRes = await fetch(`/${DEFAULT_COGS_CSV}`);
      if (csvRes.ok) {
        cogs = parseCogsCsv(await csvRes.text());
        fileName = `${DEFAULT_COGS_CSV} (авто)`;
      }
    }
  } catch (err) {
    console.error("Ошибка автозагрузки себестоимости:", err);
  }

  // Архив только дополняет: значения из актуального файла важнее старых
  const archived = await fetchArchivedCogs();
  if (Object.keys(archived).length > 0) {
    cogs = { ...archived, ...cogs };
    fileName = fileName ? `${fileName} + Архив` : "archived_cogs.csv (авто)";
  }

  return Object.keys(cogs).length > 0 ? { cogs, fileName } : null;
};



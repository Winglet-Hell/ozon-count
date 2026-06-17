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

export const parseAccrualsReport = async (file: File): Promise<AccrualsSummary> => {
  const zip = await JSZip.loadAsync(file);

  // 1. Parse shared strings table if it exists
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

  // 2. Parse sheet1.xml worksheet
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) {
    throw new Error("Не удалось найти рабочий лист xl/worksheets/sheet1.xml в архиве Excel");
  }

  const sheetText = await sheetFile.async("text");
  const parser = new DOMParser();
  const doc = parser.parseFromString(sheetText, "application/xml");
  const rows = doc.getElementsByTagName("row");

  if (rows.length === 0) {
    throw new Error("Таблица Excel пуста");
  }

  let period = "";
  const header: string[] = [];
  let totalInflow = 0;
  let totalOutflow = 0;
  const breakdownMap: Record<string, number> = {};

  // Extract period from Row 1 if present
  const r1Cells = rows[0].getElementsByTagName("c");
  if (r1Cells.length > 0) {
    const cell = r1Cells[0];
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
    if (val.includes("Период") || val.toLowerCase().includes("period")) {
      period = val;
    }
  }

  // Extract headers from Row 2
  if (rows.length > 1) {
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
  }

  // Find target column indices
  const groupColIdx = header.findIndex(h => h && h.toLowerCase().includes("группа услуг"));
  const typeColIdx = header.findIndex(h => h && h.toLowerCase().includes("тип начисления"));
  const amountColIdx = header.findIndex(h => h && h.toLowerCase().includes("сумма итого"));
  const skuColIdx = header.findIndex(h => h && h.toLowerCase().includes("артикул"));
  const qtyColIdx = header.findIndex(h => h && h.toLowerCase().includes("количество"));

  if (groupColIdx === -1 || typeColIdx === -1 || amountColIdx === -1) {
    throw new Error(
      "Неверный формат отчета начислений. Убедитесь, что загружаете правильный файл и в нем присутствуют колонки 'Группа услуг', 'Тип начисления' и 'Сумма итого, руб.'"
    );
  }

  const skuTransactions: SkuTransaction[] = [];

  // Parse remaining data rows
  for (let r = 2; r < rows.length; r++) {
    const rowEl = rows[r];
    const cells = rowEl.getElementsByTagName("c");
    
    let grp = "Без группы";
    let typ = "Без типа";
    let amount = 0;
    let sku = "";
    let qty = 0;
    
    let currentIdx = 0;
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
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

      if (currentIdx === groupColIdx) {
        grp = val.trim() || "Без группы";
      } else if (currentIdx === typeColIdx) {
        typ = val.trim() || "Без типа";
      } else if (currentIdx === amountColIdx) {
        amount = parseFloat(val) || 0;
      } else if (skuColIdx !== -1 && currentIdx === skuColIdx) {
        sku = val.trim();
        if (sku.endsWith(".0")) {
          sku = sku.slice(0, -2);
        }
      } else if (qtyColIdx !== -1 && currentIdx === qtyColIdx) {
        qty = parseFloat(val) || 0;
      }

      if (!rAttr) {
        currentIdx++;
      }
    }

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



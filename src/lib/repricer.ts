import * as XLSX from "xlsx";

export interface RepricerItem {
  id: string; // The SKU or Article
  article: string;
  currentPrice: number;
  newPrice: number | null;
  multiplier: number; // to calculate new price before discount
  priceIndex: number | null; // from 'Ценовой индекс товара на рынке на мои товары'
  customerPrice: number | null; // from 'Цена с учетом скидки от Ozon, руб.'
  ozonDiscountPct: number; // calculated discount percentage provided by Ozon
  rowIndex: number; // to keep track of where to write back
  needsAttention?: boolean; // highlight if no index was found
}

export interface ParsedTemplate {
  items: RepricerItem[];
  workbook: XLSX.WorkBook;
  sheetName: string;
  headerRowIndex: number;
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
        const articleCol = headers.indexOf("Артикул");
        const oldPriceCol = headers.findIndex((h: string) => h && h.includes("Цена до скидки"));
        const currentPriceCol = headers.findIndex((h: string) => h && h.includes("Текущая цена (со скидкой)"));
        const newPriceCol = headers.findIndex((h: string) => h && h.includes("Новая цена (со скидкой)"));
        const priceIndexCol = headers.findIndex((h: string) => h && h.includes("Ценовой индекс товара на рынке на мои товары"));
        const customerPriceCol = headers.findIndex((h: string) => h && h.includes("Цена с учетом скидки от Ozon"));

        if (articleCol === -1) throw new Error("Не найден столбец 'Артикул'");
        if (currentPriceCol === -1) throw new Error("Не найден столбец 'Текущая цена (со скидкой)'");
        if (newPriceCol === -1) throw new Error("Не найден столбец 'Новая цена (со скидкой)'");

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
          });
        }

        resolve({
          items,
          workbook,
          sheetName,
          headerRowIndex,
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
  const { workbook, sheetName, headerRowIndex } = parsed;
  const sheet = workbook.Sheets[sheetName];
  
  const json = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const headers = json[headerRowIndex];
  const newPriceCol = headers.findIndex((h: any) => h && String(h).includes("Новая цена (со скидкой)"));
  const newPriceNoDiscountCol = headers.findIndex((h: any) => h && String(h).includes("Новая цена до скидки"));
  const minPriceCol = headers.findIndex((h: any) => {
    const lower = String(h).toLowerCase();
    return lower.includes("новая") && lower.includes("минимальн");
  });

  // Find all columns related to "Подключать" or "Автоматическое..."
  const autoDisableCols: number[] = [];
  headers.forEach((h: any, idx: number) => {
    if (!h) return;
    const lower = String(h).toLowerCase();
    if (lower.includes("подключать") || lower.includes("автоматиче")) {
      autoDisableCols.push(idx);
    }
  });

  updatedItems.forEach((item) => {
    if (item.newPrice !== null && item.newPrice !== undefined) {
      const cellRefNewPrice = XLSX.utils.encode_cell({ c: newPriceCol, r: item.rowIndex });
      
      if (!sheet[cellRefNewPrice]) {
         sheet[cellRefNewPrice] = { t: 'n', v: item.newPrice };
      } else {
         sheet[cellRefNewPrice].v = item.newPrice;
         sheet[cellRefNewPrice].t = 'n';
      }

      // Automatically calculate "price before discount" to always be greater
      if (newPriceNoDiscountCol !== -1) {
          const autoOldPrice = Math.ceil(item.newPrice * item.multiplier);
          const cellRefOld = XLSX.utils.encode_cell({ c: newPriceNoDiscountCol, r: item.rowIndex });
          if (!sheet[cellRefOld]) {
             sheet[cellRefOld] = { t: 'n', v: autoOldPrice };
          } else {
             sheet[cellRefOld].v = autoOldPrice;
             sheet[cellRefOld].t = 'n';
          }
      }

      // Automatically calculate "minimum price" as 50% of the new price
      if (minPriceCol !== -1) {
          const autoMinPrice = Math.round(item.newPrice * 0.5);
          const cellRefMin = XLSX.utils.encode_cell({ c: minPriceCol, r: item.rowIndex });
          if (!sheet[cellRefMin]) {
             sheet[cellRefMin] = { t: 'n', v: autoMinPrice };
          } else {
             sheet[cellRefMin].v = autoMinPrice;
             sheet[cellRefMin].t = 'n';
          }
      }

      // Automatically disable auto-promos and auto-connections
      autoDisableCols.forEach(colIdx => {
          const cellRefAuto = XLSX.utils.encode_cell({ c: colIdx, r: item.rowIndex });
          if (!sheet[cellRefAuto]) {
             sheet[cellRefAuto] = { t: 's', v: 'НЕТ' };
          } else {
             sheet[cellRefAuto].v = 'НЕТ';
             sheet[cellRefAuto].t = 's';
          }
      });
    }
  });

  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

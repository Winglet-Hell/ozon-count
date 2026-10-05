"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Loader2, FileSpreadsheet, Download, RefreshCw, TrendingUp, Plus, Minus, AlertTriangle, Coins, ListChecks, Search, ArrowUp, ArrowDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { CogsInput } from "@/components/CogsInput";
import { parseOzonTemplate, exportOzonTemplate, type RepricerItem } from "@/lib/repricer";
import { cn } from "@/lib/utils";
import { useAppState } from "@/components/StoreProvider";
import { buildSkuEconomics, skuUnitEconomics, pretaxProfitAt, profitAt, breakEvenOf, type UnitEconomics } from "@/lib/unitEconomics";
import { suggestCogs } from "@/lib/cogsSuggest";
import { parseStockReport, syncCogsFromStock, type StockSync } from "@/lib/stockReport";

const RUB = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const NUM0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NUM2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (share: number) => `${NUM1.format(share * 100)}%`;
const signedPct = (share: number) => `${share > 0 ? "+" : ""}${NUM1.format(share * 100)}%`;

interface MinPrice {
  value: number;
  breakEven: number | null;
  source: "unknown" | "capped" | "ozonMin" | "breakeven";
}

/** Everything a table row shows, computed once per change instead of on every render */
interface Row {
  item: RepricerItem;
  price: number;
  /** New price relative to the current one; null while the price is unchanged */
  change: number | null;
  cogs: number;
  /** COGS that goes to Ozon on download */
  toOzon: number | null;
  profit: number | null;
  margin: number | null;
  min: MinPrice;
  discount: number;
  discountSource: string;
  customerPrice: number;
}

type Filter = "all" | "noCogs" | "loss" | "changed" | "toOzon";
type SortKey = "article" | "price" | "change" | "cogs" | "margin";

const FILTERS: { key: Filter; label: string; title?: string }[] = [
  { key: "all", label: "Все" },
  { key: "noCogs", label: "Без себестоимости" },
  { key: "loss", label: "Убыточные", title: "Прогноз чистой прибыли на единицу ниже нуля" },
  { key: "changed", label: "Цена изменена" },
  { key: "toOzon", label: "Себестоимость → Ozon", title: "Новая или изменившаяся себестоимость: уйдет в Ozon при выгрузке" }
];

const matchesFilter = (row: Row, filter: Filter) => {
  switch (filter) {
    case "noCogs": return row.cogs <= 0;
    case "loss": return row.profit !== null && row.profit < 0;
    case "changed": return row.change !== null;
    case "toOzon": return row.toOzon !== null;
    default: return true;
  }
};

const sortValue = (row: Row, key: SortKey): number | string | null => {
  switch (key) {
    case "article": return row.item.article;
    case "price": return row.price;
    case "change": return row.change;
    case "cogs": return row.cogs > 0 ? row.cogs : null;
    case "margin": return row.margin;
  }
};

const normalizeSearch = (value: string) => value.toLowerCase().replace(/ё/g, "е").trim();

// Group key for alternating row backgrounds: the letters of the article, i.e. kind and color without sizes
const groupKey = (article: string) => article.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, "").toLowerCase();

const minHint = (min: MinPrice): { short: string; full: string } => {
  const breakEven = min.breakEven === null ? "" : NUM0.format(min.breakEven);
  switch (min.source) {
    case "unknown": return { short: "= цене · нет данных", full: "Равно цене: нет себестоимости или отчета, безубыточность неизвестна" };
    case "capped": return { short: `= цене · 0% при ${breakEven}`, full: `Равно цене: безубыточная цена ${breakEven} ₽ выше нее` };
    case "ozonMin": return { short: `50% · 0% при ${breakEven}`, full: `50% от цены — меньше Ozon не принимает; безубыточная цена ниже: ${breakEven} ₽` };
    case "breakeven": return { short: "маржа 0%", full: "Безубыточная цена: маржа 0%" };
  }
};

export default function RepricerPage() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkPct, setBulkPct] = useState("10");
  const [stockSync, setStockSync] = useState<(StockSync & { createdAt: string | null }) | null>(null);
  const [lastDownload, setLastDownload] = useState<{ fileName: string; prices: number; cogs: number } | null>(null);
  // COGS typed into a field but not committed yet (it commits on Enter or leaving the field)
  const cogsDrafts = useRef<Record<string, number | null>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "article", dir: 1 });

  const {
    repricerParsedData: parsedData,
    setRepricerParsedData: setParsedData,
    repricerItems: items,
    setRepricerItems: setItems,
    accrualsResult,
    skuCogs,
    setCogsEdits,
    getCurrentCogs,
    mergeTemplateCogs,
    vatRate,
    cogsVatShare,
    incomeTaxRate
  } = useAppState();

  // Fallback Ozon discount from the report: share of "баллы за скидки" in what the seller receives
  // (sales net of returns). Used only when the template has no customer price.
  const accrualsDiscountMap = useMemo(() => {
    if (!accrualsResult) return {};

    const map: Record<string, { revenue: number; compensation: number }> = {};
    accrualsResult.skuTransactions.forEach(tx => {
      const type = tx.type.toLowerCase();
      const isRevenue = type.includes("выручка");
      const isCompensation = type.includes("баллы за скидки") || tx.group.toLowerCase().includes("баллы за скидки");
      if (!isRevenue && !isCompensation) return;
      if (!map[tx.sku]) map[tx.sku] = { revenue: 0, compensation: 0 };
      if (isRevenue) map[tx.sku].revenue += tx.amount;
      if (isCompensation) map[tx.sku].compensation += tx.amount;
    });

    const discounts: Record<string, number> = {};
    for (const [sku, data] of Object.entries(map)) {
      const total = data.revenue + data.compensation;
      discounts[sku] = total > 0 && data.compensation > 0 ? data.compensation / total : 0;
    }
    return discounts;
  }, [accrualsResult]);

  // Unit economics per SKU from the accruals report — the same model as «Реальная экономика» (see lib/unitEconomics)
  const economicsModel = useMemo(() => (accrualsResult ? buildSkuEconomics(accrualsResult) : null), [accrualsResult]);
  const taxSettings = useMemo(() => ({ vatRate, cogsVatShare, incomeTaxRate }), [vatRate, cogsVatShare, incomeTaxRate]);

  // Null without the report or COGS — a forecast without Ozon's costs or the product cost would mislead
  const unitEconomics = useCallback((article: string): UnitEconomics | null => {
    if (!economicsModel) return null;
    return skuUnitEconomics(economicsModel, article, skuCogs[article] || 0);
  }, [economicsModel, skuCogs]);

  // Overall weighted margin: forecast profit at the planned prices over last period's volumes.
  // Income tax is taken from the total, as on the accruals page: losses of some SKUs reduce the tax on the rest
  const overallMetrics = useMemo(() => {
    if (!items.length) return null;

    let totalRevenue = 0;
    let totalPretax = 0;
    let totalQuantity = 0;

    items.forEach(item => {
      const econ = unitEconomics(item.article);
      if (!econ || econ.quantity <= 0) return;
      const basePrice = item.newPrice ?? item.currentPrice;
      totalRevenue += basePrice * econ.quantity;
      totalPretax += pretaxProfitAt(econ, basePrice, taxSettings) * econ.quantity;
      totalQuantity += econ.quantity;
    });

    if (totalRevenue === 0 || totalQuantity === 0) return null;

    const totalProfit = totalPretax - Math.max(0, totalPretax * (incomeTaxRate / 100));
    return {
      totalRevenue,
      totalProfit,
      totalQuantity,
      marginPct: totalProfit / totalRevenue
    };
  }, [items, unitEconomics, taxSettings, incomeTaxRate]);

  // Promo floor ("Ограничение для акций и стратегий"): break-even, but Ozon rejects a floor below 50%
  // of the price ("Укажите минимальную цену не меньше 50%"), and it can't exceed the price itself.
  // Unknown break-even (no COGS or report) keeps the floor at the price: with Ozon's ~50% commission
  // a blind 50% floor lets promos and strategies sell at a sure loss
  const minPriceFor = useCallback((item: RepricerItem, econ: UnitEconomics | null): MinPrice => {
    const price = item.newPrice ?? item.currentPrice;
    const ozonMin = Math.round(price * 0.5);
    const breakEven = econ ? breakEvenOf(econ, taxSettings) : null;
    if (breakEven === null) return { value: Math.round(price), breakEven, source: "unknown" };
    const floor = Math.ceil(breakEven);
    if (floor >= price) return { value: Math.round(price), breakEven, source: "capped" };
    if (floor < ozonMin) return { value: ozonMin, breakEven, source: "ozonMin" };
    return { value: floor, breakEven, source: "breakeven" };
  }, [taxSettings]);

  // COGS for items that have none yet: suggested from the nearest size or color of the same model
  const cogsSuggestions = useMemo(
    () => suggestCogs(items.filter(item => !(skuCogs[item.article] > 0)).map(item => item.article), skuCogs),
    [items, skuCogs]
  );

  // One table row from an item and its COGS. The download reuses it with the store's latest COGS
  const computeRow = useCallback((item: RepricerItem, cogs: number): Row => {
    const price = item.newPrice ?? item.currentPrice;
    const econ = economicsModel ? skuUnitEconomics(economicsModel, item.article, cogs) : null;
    const profit = econ ? profitAt(econ, price, taxSettings) : null;

    // Prefer the template discount: it's a fresh snapshot of what the buyer pays right now,
    // while the report discount is a period average that lags behind recent price changes
    const useTemplateDiscount = item.ozonDiscountPct > 0;
    const discount = useTemplateDiscount ? item.ozonDiscountPct : accrualsDiscountMap[item.article] ?? 0;

    return {
      item,
      price,
      change: item.newPrice !== null && item.currentPrice > 0 && item.newPrice !== item.currentPrice
        ? item.newPrice / item.currentPrice - 1
        : null,
      cogs,
      toOzon: cogs > 0 && cogs !== item.templateCogs ? cogs : null,
      profit,
      margin: profit !== null && price > 0 ? profit / price : null,
      min: minPriceFor(item, econ),
      discount,
      discountSource: useTemplateDiscount ? "по шаблону" : "по отчету",
      customerPrice: price * (1 - discount)
    };
  }, [economicsModel, taxSettings, accrualsDiscountMap, minPriceFor]);

  const rows = useMemo(() => items.map(item => computeRow(item, skuCogs[item.article] || 0)), [items, skuCogs, computeRow]);

  const filterCounts = useMemo(() => {
    const counts: Record<Filter, number> = { all: 0, noCogs: 0, loss: 0, changed: 0, toOzon: 0 };
    rows.forEach(row => FILTERS.forEach(({ key }) => { if (matchesFilter(row, key)) counts[key]++; }));
    return counts;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const search = normalizeSearch(query);
    const filtered = rows.filter(row => matchesFilter(row, filter) && (!search || normalizeSearch(row.item.article).includes(search)));

    const sorted = [...filtered].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      // Rows without a value stay at the bottom in both directions
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const diff = typeof x === "string" ? x.localeCompare(String(y), "ru", { numeric: true }) : x - (y as number);
      return diff * sort.dir;
    });

    // Alternate backgrounds by model only in article order — sorted by numbers, the groups break apart
    let isAlternate = false;
    return sorted.map((row, index) => {
      if (sort.key === "article" && index > 0 && groupKey(row.item.article) !== groupKey(sorted[index - 1].item.article)) {
        isAlternate = !isAlternate;
      }
      return { row, isAlternate };
    });
  }, [rows, query, filter, sort]);

  const handleSort = (key: SortKey) => {
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  };

  const handleFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedData(null);
    setItems([]);

    try {
      if (!file.name.endsWith(".xlsx")) {
        throw new Error("Пожалуйста, загрузите файл отчета в формате Excel (.xlsx)");
      }

      const parsed = await parseOzonTemplate(file);
      setParsedData(parsed);
      const sortedItems = [...parsed.items].sort((a, b) => a.article.localeCompare(b.article, "ru", { numeric: true }));
      setItems(sortedItems);
      // The template carries the COGS stored in Ozon — the freshest source there is
      mergeTemplateCogs(Object.fromEntries(
        parsed.items.filter(item => item.templateCogs !== null).map(item => [item.article, item.templateCogs as number])
      ));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Произошла ошибка при обработке файла");
    } finally {
      setIsProcessing(false);
    }
  }, [mergeTemplateCogs]);

  // Stock report from the accounting system: COGS by barcode, new and changed values go to Ozon on download
  const handleStockFile = async (file: File) => {
    setError(null);
    try {
      const report = await parseStockReport(file);
      const sync = syncCogsFromStock(report, items, skuCogs);
      setCogsEdits(sync.changes);
      setStockSync({ ...sync, createdAt: report.createdAt });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Не удалось прочитать отчет из учетной системы");
    }
  };

  const handleReset = () => {
    setParsedData(null);
    setItems([]);
    setError(null);
    setStockSync(null);
    setLastDownload(null);
    setQuery("");
    setFilter("all");
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handlePriceChange = (id: string, newPriceStr: string) => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        let val: number | null = parseFloat(newPriceStr.replace(",", "."));
        if (isNaN(val)) val = null;
        if (newPriceStr.trim() === "") val = null;
        return { ...item, newPrice: val, needsAttention: false };
      }
      return item;
    }));
  };

  // onlyRaise: apply the index only where it raises the price; items the index would lower keep their current price
  const handleApplyIndexGlobal = (onlyRaise = false) => {
    const clamp = (item: RepricerItem, price: number) => (onlyRaise ? Math.max(item.currentPrice, price) : price);

    setItems(prev => {
      // Step 1: Compute adjusted prices for items that HAVE an index
      const indexedItems = prev
        .filter(item => item.priceIndex && item.priceIndex > 0)
        .map(item => ({
          ...item,
          newPrice: clamp(item, Math.round(item.currentPrice / item.priceIndex!)),
          needsAttention: false,
          baseName: item.article.replace(/\d+/g, '') // strip digits for similarity matching
        }));

      // Step 2: Assign prices for all items
      return prev.map(item => {
        if (item.priceIndex && item.priceIndex > 0) {
          // Return the already calculated indexed item (excluding the temporary baseName field)
          const matched = indexedItems.find(i => i.id === item.id)!;
          const { baseName, ...rest } = matched as any;
          return rest;
        }

        // For items WITHOUT an index, look for a similar item
        const itemBaseName = item.article.replace(/\d+/g, '');
        const candidates = indexedItems.filter(i => i.baseName === itemBaseName);

        if (candidates.length > 0) {
          // Find the candidate whose current price is closest
          let bestCandidate = candidates[0];
          let minDiff = Math.abs(bestCandidate.currentPrice - item.currentPrice);
          for (let i = 1; i < candidates.length; i++) {
            const diff = Math.abs(candidates[i].currentPrice - item.currentPrice);
            if (diff < minDiff) {
              bestCandidate = candidates[i];
              minDiff = diff;
            }
          }
          // Borrow the sibling's index, not its new price: sizes of one model are priced differently,
          // and a copied price would drag a cheap size up to an expensive one. Without a price of its own, take the sibling's
          const newPrice = item.currentPrice > 0
            ? Math.round(item.currentPrice / bestCandidate.priceIndex!)
            : bestCandidate.newPrice!;
          return { ...item, newPrice: clamp(item, newPrice), needsAttention: true };
        }

        // Fallback: If no similar item is found, just use currentPrice
        return { ...item, newPrice: item.currentPrice, needsAttention: true };
      });
    });
  };

  const bulkPctValue = parseFloat(bulkPct.replace(",", "."));
  const bulkPctValid = !isNaN(bulkPctValue) && bulkPctValue > 0;

  // Shift every new price by ±bulkPct%. Items without a new price start from their current price,
  // so repeated clicks compound on top of whatever is in the "Новая" column
  const handleBulkAdjust = (direction: 1 | -1) => {
    if (!bulkPctValid) return;
    const factor = 1 + (direction * bulkPctValue) / 100;
    setItems(prev => prev.map(item => {
      const base = item.newPrice ?? item.currentPrice;
      if (base <= 0) return item;
      return { ...item, newPrice: Math.round(base * factor) };
    }));
  };

  const handleApplyIndexItem = (id: string, currentPrice: number, index: number) => {
    const adjustedPrice = Math.round(currentPrice / index);
    handlePriceChange(id, adjustedPrice.toString());
  };

  const handleDownload = async () => {
    if (!parsedData) return;
    // A COGS still being typed hasn't been committed: Safari and Firefox don't take focus from a field when
    // a button is clicked, so it never blurs. Commit such drafts and build the file from the store's latest
    // values — the rows of this render predate the commit
    const drafts = cogsDrafts.current;
    cogsDrafts.current = {};
    if (Object.keys(drafts).length > 0) setCogsEdits(drafts);
    const cogsNow = getCurrentCogs();
    const exportRows = items.map(item => computeRow(item, cogsNow[item.article] || 0));
    try {
      setIsProcessing(true);
      const blob = await exportOzonTemplate(
        parsedData,
        exportRows.map(row => ({ ...row.item, minPrice: row.min.value, newCogs: row.toOzon }))
      );
      const fileName = `Обновленные_цены_${new Date().toLocaleDateString("ru-RU")}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setLastDownload({
        fileName,
        prices: exportRows.filter(row => row.item.newPrice !== null).length,
        cogs: exportRows.filter(row => row.toOzon !== null).length
      });
    } catch (err) {
      console.error(err);
      setError("Ошибка при сохранении файла");
    } finally {
      setIsProcessing(false);
    }
  };

  const suggestionCount = Object.keys(cogsSuggestions).length;
  const isLoaded = !!parsedData && items.length > 0;

  const errorBanner = (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="p-4 bg-rose-50 text-rose-700 rounded-2xl border border-rose-200/60 text-sm flex items-center gap-3 shadow-sm"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1"><strong className="font-semibold">Ошибка:</strong> {error}</span>
          <button onClick={() => setError(null)} className="p-1 rounded-md hover:bg-rose-100" aria-label="Скрыть">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <main className="min-h-screen bg-slate-50/50 flex flex-col selection:bg-blue-500/20">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!parsedData}
        uploadLabel="Другой шаблон"
        activeTab="repricer"
      />

      {!isLoaded ? (
        <div className="flex-1 px-4 sm:px-6 lg:px-8 py-8 w-full">
          <div className="mt-16 max-w-2xl mx-auto w-full space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                Управление ценами <span className="text-blue-600">Ozon</span>
              </h2>
              <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                Загрузите шаблон обновления цен, чтобы быстро переоценить товары и скачать готовый файл для Ozon.
              </p>
            </div>

            <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 p-2 overflow-hidden">
              <div className="p-6 sm:p-10 space-y-8 bg-slate-50/50 rounded-[1.25rem]">
                <div
                  className={cn(
                    "relative group p-10 border-2 border-dashed rounded-2xl transition-all duration-300 ease-out cursor-pointer flex flex-col items-center justify-center gap-4 min-h-[240px] overflow-hidden",
                    isDragActive
                      ? "border-blue-500 bg-blue-50/80 scale-[0.98]"
                      : "border-slate-300 hover:border-blue-400 hover:bg-white hover:shadow-xl hover:shadow-blue-500/5",
                    isProcessing && "opacity-50 pointer-events-none"
                  )}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => document.getElementById("xlsx-file-upload")?.click()}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-50/0 to-blue-50/0 group-hover:from-blue-50/50 group-hover:to-transparent transition-colors duration-500" />
                  <input
                    id="xlsx-file-upload"
                    type="file"
                    className="hidden"
                    accept=".xlsx"
                    onChange={onFileInputChange}
                  />

                  <div className={cn(
                    "p-4 rounded-2xl transition-all duration-300 relative z-10",
                    isProcessing ? "bg-blue-100 text-blue-600" : "bg-white shadow-sm border border-slate-100 text-blue-500 group-hover:scale-110 group-hover:shadow-md"
                  )}>
                    {isProcessing ? (
                      <Loader2 className="w-8 h-8 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-8 h-8" />
                    )}
                  </div>

                  <div className="text-center space-y-2 relative z-10">
                    <p className="text-base font-bold text-slate-800">
                      {isProcessing ? "Обработка шаблона..." : "Загрузите шаблон обновления цен (.xlsx)"}
                    </p>
                    <p className="text-sm text-slate-500">
                      Перетащите файл сюда или нажмите для выбора
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {errorBanner}
          </div>
        </div>
      ) : (
        // Workspace fills the window: the table scrolls inside, so its header and the article column stay in view
        <div className="flex flex-col gap-3 w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-4 h-[calc(100dvh-4rem)]">
          {errorBanner}

          <div className="shrink-0 flex flex-wrap items-end gap-x-6 gap-y-3 bg-white px-4 sm:px-5 py-3 rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="min-w-[10rem]">
              <div className="text-sm font-bold text-slate-900">Товаров: {items.length}</div>
              {overallMetrics ? (
                <div
                  className="text-sm text-slate-500 mt-0.5"
                  title={`Прогноз чистой прибыли при новых ценах на объемах прошлого периода: ${RUB.format(overallMetrics.totalProfit)}`}
                >
                  Маржа (прогноз):{" "}
                  <span className={cn("font-bold", overallMetrics.marginPct > 0 ? "text-emerald-600" : "text-rose-600")}>
                    {pct(overallMetrics.marginPct)}
                  </span>
                  <span className="text-slate-400"> · ~{RUB.format(overallMetrics.totalProfit)}</span>
                </div>
              ) : (
                <div className="text-xs text-amber-600 mt-0.5">
                  {accrualsResult ? "Нет себестоимости для прогноза" : "Для прогноза маржи загрузите отчет о начислениях"}
                </div>
              )}
            </div>

            <ToolbarGroup label="Цены">
              <div
                className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg"
                title="Изменить все новые цены на указанный процент. Если новая цена не задана — считается от текущей"
              >
                <button
                  onClick={() => handleBulkAdjust(-1)}
                  disabled={isProcessing || !bulkPctValid}
                  className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-rose-600 disabled:opacity-40 transition-colors"
                  title="Снизить все новые цены"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bulkPct}
                  onChange={(e) => setBulkPct(e.target.value)}
                  className="w-9 py-1 bg-transparent text-center text-sm font-semibold text-slate-700 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  aria-label="Процент изменения цены"
                />
                <span className="text-sm font-semibold text-slate-500 pr-1">%</span>
                <button
                  onClick={() => handleBulkAdjust(1)}
                  disabled={isProcessing || !bulkPctValid}
                  className="p-1.5 rounded-md text-slate-600 hover:bg-white hover:text-emerald-600 disabled:opacity-40 transition-colors"
                  title="Поднять все новые цены"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <ToolbarButton
                onClick={() => handleApplyIndexGlobal()}
                disabled={isProcessing}
                icon={<RefreshCw className="w-4 h-4" />}
                title="Новая цена = текущая / ценовой индекс. Товарам без индекса — коэффициент соседнего размера"
              >
                По индексу
              </ToolbarButton>
              <ToolbarButton
                onClick={() => handleApplyIndexGlobal(true)}
                disabled={isProcessing}
                icon={<TrendingUp className="w-4 h-4" />}
                title="Поднять цену там, где индекс ниже 1. Товары, которым индекс снизил бы цену, остаются с текущей"
              >
                Только вверх
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarGroup label="Себестоимость">
              <ToolbarButton
                onClick={() => document.getElementById("stock-file-upload")?.click()}
                disabled={isProcessing}
                icon={<Coins className="w-4 h-4" />}
                title="Загрузить отчет «Остатки» из учетной системы (.xls): себестоимость подтянется по коду — штрихкоду товара, новая и изменившаяся уйдет в Ozon при выгрузке"
              >
                Из учета
              </ToolbarButton>
              <input
                id="stock-file-upload"
                type="file"
                className="hidden"
                accept=".xls,.xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleStockFile(file);
                  e.target.value = "";
                }}
              />
              {suggestionCount > 0 && (
                <ToolbarButton
                  onClick={() => setCogsEdits(Object.fromEntries(
                    Object.entries(cogsSuggestions).map(([article, suggestion]) => [article, suggestion.value])
                  ))}
                  disabled={isProcessing}
                  icon={<ListChecks className="w-4 h-4" />}
                  title="Принять подсказки «≈» для всех товаров без себестоимости: по соседнему размеру или цвету той же модели"
                  tone="amber"
                >
                  По аналогам ({suggestionCount})
                </ToolbarButton>
              )}
            </ToolbarGroup>

            <div className="ml-auto flex items-end gap-3">
              <div className="text-xs text-slate-500 text-right leading-snug pb-0.5">
                <div className="font-semibold text-slate-600">В файл для Ozon</div>
                <div>
                  цены: {filterCounts.changed} · себестоимость: {filterCounts.toOzon}
                </div>
              </div>
              <button
                onClick={handleDownload}
                disabled={isProcessing}
                title={filterCounts.toOzon > 0
                  ? `Вместе с ценами в файл попадет себестоимость ${filterCounts.toOzon} товаров («Новая себестоимость»): Ozon сохранит ее, и следующий шаблон придет уже с ней`
                  : undefined}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Скачать для Ozon
              </button>
            </div>
          </div>

          {lastDownload && (
            <div className="shrink-0 flex items-start justify-between gap-4 px-4 sm:px-5 py-3 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-sm text-slate-700">
              <div>
                <span className="font-bold text-slate-900">Файл «{lastDownload.fileName}» сохранен.</span>{" "}
                В нем новые цены — {lastDownload.prices} (колонка «Новая предельная цена без акций»)
                {" "}и себестоимость — {lastDownload.cogs} (колонка «Новая себестоимость», в конце таблицы; колонка
                «Себестоимость» показывает то, что в Ozon сейчас).
              </div>
              <button
                onClick={() => setLastDownload(null)}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-emerald-100 transition-colors"
                aria-label="Скрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {stockSync && (
            <div className="shrink-0 flex items-start justify-between gap-4 px-4 sm:px-5 py-3 bg-blue-50/60 border border-blue-100 rounded-2xl text-sm text-slate-700">
              <div className="space-y-1">
                <div>
                  <span className="font-bold text-slate-900">
                    Себестоимость из учета{stockSync.createdAt ? ` — остатки на ${stockSync.createdAt}` : ""}.
                  </span>{" "}
                  По коду найдено {stockSync.matched} из {items.length}:{" "}
                  <b>новая — {stockSync.added}</b>, <b>изменилась — {stockSync.changed}</b>, без изменений — {stockSync.unchanged}
                  {stockSync.noCogs > 0 && `, нет на складе — ${stockSync.noCogs}`}
                  {stockSync.notFound > 0 && `, не найдено по коду — ${stockSync.notFound}`}.
                </div>
                {stockSync.biggest.length > 0 && (
                  <div className="text-xs text-slate-500">
                    Заметнее всего изменились:{" "}
                    {stockSync.biggest.map((d) => `${d.article} ${NUM0.format(d.from)} → ${NUM0.format(d.to)} ₽`).join("; ")}
                  </div>
                )}
              </div>
              <button
                onClick={() => setStockSync(null)}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-blue-100 transition-colors"
                aria-label="Скрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="shrink-0 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по артикулу"
                className="w-60 pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            {FILTERS.filter(({ key }) => key === "all" || key === filter || filterCounts[key] > 0).map(({ key, label, title }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                title={title}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                  filter === key ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                )}
              >
                {label} <span className={filter === key ? "text-white/60" : "text-slate-400"}>{filterCounts[key]}</span>
              </button>
            ))}
            {visibleRows.length !== rows.length && (
              <span className="ml-auto text-xs text-slate-400">Показано {visibleRows.length} из {rows.length}</span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-white rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <table className="w-full text-left text-sm whitespace-nowrap border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 text-slate-500 text-[11px] font-semibold uppercase tracking-wider">
                <tr className="[&>th]:bg-slate-50 [&>th]:border-b [&>th]:border-slate-200">
                  <SortTh label="Артикул" sortKey="article" sort={sort} onSort={handleSort} className="sticky left-0 z-30" />
                  <th className="px-2.5 py-2.5 text-center">Индекс</th>
                  <SortTh label="Текущая" sortKey="price" sort={sort} onSort={handleSort} align="right" title="Предельная цена без акций сейчас" />
                  <SortTh label="Новая" sortKey="change" sort={sort} onSort={handleSort} title="Новая цена и изменение к текущей" />
                  <SortTh
                    label="Себест."
                    sortKey="cogs"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    title="Себестоимость единицы с НДС — по цене оплаты поставщикам. Ввод — Enter. «≈» — подсказка по соседнему размеру или цвету той же модели, галочка ее принимает. Синяя точка — значение уйдет в Ozon при выгрузке («Новая себестоимость»)"
                  />
                  <SortTh
                    label="Маржа"
                    sortKey="margin"
                    sort={sort}
                    onSort={handleSort}
                    align="right"
                    title={`Прогноз чистой прибыли на единицу при новой цене: цена − расходы Ozon − себестоимость невозвращенных единиц − НДС ${vatRate}% (с вычетами по услугам Ozon и ${cogsVatShare}% себестоимости) − налог на прибыль ${incomeTaxRate}%. Та же модель, что «Реальная экономика» на странице начислений`}
                  />
                  <th
                    className="px-2.5 py-2.5 text-right"
                    title="Ограничение для акций и стратегий: ниже этой цены Ozon не опустит цену при автодобавлении в акции. Цена с маржой 0%, но не меньше 50% от новой цены (требование Ozon) и не выше нее. Без себестоимости или отчета — равно цене"
                  >
                    Мин.
                  </th>
                  <th className="px-2.5 py-2.5 text-right" title="Цена для покупателя с учетом скидки Ozon за свой счет">Клиенту</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center text-slate-400">Ничего не найдено</td>
                  </tr>
                )}
                {visibleRows.map(({ row, isAlternate }) => {
                  const { item } = row;
                  const hint = minHint(row.min);
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "[&>td]:border-b [&>td]:border-slate-100 transition-colors hover:bg-slate-100",
                        isAlternate ? "bg-slate-50" : "bg-white"
                      )}
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-2.5 py-1.5 font-medium text-slate-900">
                        <div className="max-w-[12.5rem] truncate" title={item.article}>{item.article}</div>
                      </td>
                      <td className="px-2.5 py-1.5 text-center">
                        {item.priceIndex ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded-md text-xs font-bold tabular-nums",
                              item.priceIndex > 1.05 ? "bg-rose-50 text-rose-600" :
                              item.priceIndex < 0.95 ? "bg-emerald-50 text-emerald-600" :
                              "bg-slate-100 text-slate-600"
                            )}>
                              {NUM2.format(item.priceIndex)}
                            </span>
                            <button
                              onClick={() => handleApplyIndexItem(item.id, item.currentPrice, item.priceIndex!)}
                              className="p-1 hover:bg-slate-200 text-slate-400 hover:text-blue-600 rounded-md transition-colors"
                              title="Применить индекс для этого товара"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right text-slate-600 tabular-nums">
                        {RUB.format(item.currentPrice)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step="1"
                            placeholder={NUM0.format(item.currentPrice)}
                            value={item.newPrice ?? ""}
                            onChange={(e) => handlePriceChange(item.id, e.target.value)}
                            className={cn(
                              "w-20 px-2 py-1.5 border rounded-lg text-sm font-medium tabular-nums focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300",
                              item.needsAttention
                                ? "bg-amber-50 border-amber-300 focus:ring-amber-500/20 focus:border-amber-500 text-amber-900"
                                : "bg-white border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                            )}
                          />
                          <span className={cn(
                            "w-11 text-xs font-semibold tabular-nums",
                            row.change === null ? "text-transparent" : row.change > 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {row.change === null ? "·" : signedPct(row.change)}
                          </span>
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <CogsInput
                          value={row.cogs > 0 ? row.cogs : undefined}
                          suggestion={cogsSuggestions[item.article]}
                          pending={row.toOzon === null ? undefined : item.templateCogs
                            ? `В Ozon сейчас ${NUM0.format(item.templateCogs)} ₽ — при выгрузке запишется ${NUM0.format(row.toOzon)} ₽`
                            : "В Ozon себестоимости нет — при выгрузке запишется это значение"}
                          onCommit={(value) => setCogsEdits({ [item.article]: value })}
                          onDraft={(value) => {
                            if (value === undefined) delete cogsDrafts.current[item.article];
                            else cogsDrafts.current[item.article] = value;
                          }}
                        />
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        {row.profit !== null && row.margin !== null ? (
                          <div title={`Чистая прибыль на единицу: ${RUB.format(row.profit)}`}>
                            <div className={cn("font-bold tabular-nums", row.profit > 0 ? "text-emerald-600" : "text-rose-600")}>
                              {pct(row.margin)}
                            </div>
                            <div className="text-[11px] text-slate-400 tabular-nums">{RUB.format(row.profit)}</div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-600">
                            {!accrualsResult ? "Нет отчета" : row.cogs <= 0 ? "Нет себест." : "Нет данных"}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right" title={hint.full}>
                        <div className={cn(
                          "font-medium tabular-nums",
                          row.min.source === "unknown" || row.min.source === "capped" ? "text-amber-600" : "text-slate-700"
                        )}>
                          {RUB.format(row.min.value)}
                        </div>
                        <div className="text-[11px] text-slate-400">{hint.short}</div>
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-slate-700 tabular-nums">{RUB.format(row.customerPrice)}</span>
                          {row.discount > 0 && (
                            <span
                              className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md tabular-nums"
                              title={`Скидка Ozon за свой счет (${row.discountSource}) — продавец получает полную цену`}
                            >
                              −{NUM0.format(row.discount * 100)}%
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  title,
  tone = "slate",
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title?: string;
  tone?: "slate" | "amber";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50",
        tone === "amber"
          ? "bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200"
          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  title,
  className
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn("px-2.5 py-2.5", align === "right" && "text-right", className)}
      title={title}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-900 transition-colors",
          active && "text-slate-900"
        )}
      >
        {label}
        {active && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

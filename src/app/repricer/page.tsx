"use client";

import { useState, useCallback, useMemo } from "react";
import { Upload, Loader2, FileSpreadsheet, Download, RefreshCw, TrendingUp, Plus, Minus, AlertTriangle, Coins } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { parseOzonTemplate, exportOzonTemplate, type ParsedTemplate, type RepricerItem } from "@/lib/repricer";
import { cn } from "@/lib/utils";
import { useAppState } from "@/components/StoreProvider";
import { isVatFree, vatFraction } from "@/lib/vat";

interface SkuMetrics {
  pct: number; // percent-of-price costs as a share of what the seller receives
  fixedVatable: number; // per unit sold, Ozon services with VAT
  fixedVatFree: number; // per unit sold, compensations and fines without VAT
  quantity: number; // units sold in the report period
}

interface UnitEconomics extends Omit<SkuMetrics, "quantity"> {
  cogs: number;
  quantity: number;
}

export default function RepricerPage() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkPct, setBulkPct] = useState("10");
  
  const { 
    repricerParsedData: parsedData, 
    setRepricerParsedData: setParsedData, 
    repricerItems: items, 
    setRepricerItems: setItems,
    accrualsResult,
    skuCogs,
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

  // Unit economics per SKU from the accruals report — the same model as «Реальная экономика»
  // on the accruals page:
  //   • percent-of-price costs — commission, acquiring, search promotion and return reversals
  //     (revenue and points given back; refunded commission nets against them);
  //   • fixed per unit sold — logistics, delivery, return logistics, packaging, storage and everything else;
  //   • VAT-free lines (compensations, fines) are kept apart: they give no VAT deduction.
  // Costs booked without an article (ads per click, cross-docking, insurance) are spread over all units sold.
  const { skuMetricsMap, globalFixed, avgPct, avgSkuFixed } = useMemo(() => {
    const empty = { skuMetricsMap: {} as Record<string, SkuMetrics>, globalFixed: { vatable: 0, vatFree: 0 }, avgPct: 0, avgSkuFixed: { vatable: 0, vatFree: 0 } };
    if (!accrualsResult) return empty;

    const isPercentOfPrice = (group: string, type: string) => {
      const g = group.toLowerCase();
      const t = type.toLowerCase();
      return (
        g.includes("вознаграждение") || t.includes("вознаграждение") || g.includes("комисси") || t.includes("комисси") ||
        g.includes("эквайринг") || t.includes("эквайринг") ||
        g.includes("продвижение в поиске") || t.includes("продвижение в поиске") ||
        t.includes("возврат выручки") || t.includes("баллы за скидки") || g.includes("баллы за скидки")
      );
    };
    const isRevenue = (group: string, type: string, amount: number) => {
      const g = group.toLowerCase();
      const t = type.toLowerCase();
      return amount > 0 && (g === "продажи" || t.includes("выручка") || t.includes("баллы за скидки") || g.includes("баллы за скидки"));
    };

    const perSku: Record<string, { revenue: number; pctCost: number; fixedVatable: number; fixedVatFree: number; quantity: number }> = {};
    // Remainder of each group::type after subtracting SKU rows = rows booked without an article
    const globalByType: Record<string, { type: string; amount: number }> = {};
    accrualsResult.breakdown.forEach(b => {
      globalByType[`${b.group}::${b.type}`] = { type: b.type, amount: b.amount };
    });

    let totalSalesQuantity = 0;
    accrualsResult.skuTransactions.forEach(tx => {
      const key = `${tx.group}::${tx.type}`;
      if (globalByType[key]) globalByType[key].amount -= tx.amount;

      const sku = perSku[tx.sku] || (perSku[tx.sku] = { revenue: 0, pctCost: 0, fixedVatable: 0, fixedVatFree: 0, quantity: 0 });
      const lowerType = tx.type.toLowerCase();

      if (isRevenue(tx.group, tx.type, tx.amount)) {
        sku.revenue += tx.amount;
      } else if (isPercentOfPrice(tx.group, tx.type)) {
        sku.pctCost -= tx.amount; // refunds (positive) reduce the percent cost
      } else if (isVatFree(tx.type)) {
        sku.fixedVatFree -= tx.amount;
      } else {
        sku.fixedVatable -= tx.amount;
      }

      // Units sold — only from revenue rows, so compensation rows aren't double counted
      if (tx.group === "Продажи" && tx.quantity > 0 && tx.amount > 0 && (lowerType.includes("выручка") || lowerType.includes("доставлен покупателю"))) {
        sku.quantity += tx.quantity;
        totalSalesQuantity += tx.quantity;
      }
    });

    let globalVatable = 0;
    let globalVatFree = 0;
    Object.values(globalByType).forEach(({ type, amount }) => {
      if (isVatFree(type)) globalVatFree -= amount;
      else globalVatable -= amount;
    });
    if (globalVatable + globalVatFree < 0) { globalVatable = 0; globalVatFree = 0; }
    const perUnit = (value: number) => (totalSalesQuantity > 0 ? value / totalSalesQuantity : 0);
    const globalFixed = { vatable: perUnit(globalVatable), vatFree: perUnit(globalVatFree) };

    const skuMetricsMap: Record<string, SkuMetrics> = {};
    let totalRevenue = 0;
    let totalPctCost = 0;
    let totalFixedVatable = 0;
    let totalFixedVatFree = 0;
    for (const [sku, d] of Object.entries(perSku)) {
      skuMetricsMap[sku] = {
        pct: d.revenue > 0 ? d.pctCost / d.revenue : 0,
        fixedVatable: d.quantity > 0 ? d.fixedVatable / d.quantity : 0,
        fixedVatFree: d.quantity > 0 ? d.fixedVatFree / d.quantity : 0,
        quantity: d.quantity
      };
      totalRevenue += d.revenue;
      totalPctCost += d.pctCost;
      totalFixedVatable += d.fixedVatable;
      totalFixedVatFree += d.fixedVatFree;
    }

    return {
      skuMetricsMap,
      globalFixed,
      avgPct: totalRevenue > 0 ? totalPctCost / totalRevenue : 0,
      avgSkuFixed: { vatable: perUnit(totalFixedVatable), vatFree: perUnit(totalFixedVatFree) }
    };
  }, [accrualsResult]);

  const vatFrac = vatFraction(vatRate);
  const cogsVatFrac = cogsVatShare / 100;
  const taxRate = incomeTaxRate / 100;

  // Everything needed to price one unit of a SKU. Store averages stand in for SKUs without sales history.
  // Null without the report or COGS — a forecast without Ozon's costs or the product cost would mislead.
  const unitEconomics = useCallback((article: string): UnitEconomics | null => {
    if (!accrualsResult) return null;
    const cogs = skuCogs[article] || 0;
    if (cogs <= 0) return null;
    const metrics = skuMetricsMap[article];
    const pct = metrics ? metrics.pct : avgPct;
    if (pct >= 1) return null;
    return {
      pct,
      fixedVatable: (metrics ? metrics.fixedVatable : avgSkuFixed.vatable) + globalFixed.vatable,
      fixedVatFree: (metrics ? metrics.fixedVatFree : avgSkuFixed.vatFree) + globalFixed.vatFree,
      cogs,
      quantity: metrics?.quantity ?? 0
    };
  }, [accrualsResult, skuCogs, skuMetricsMap, avgPct, avgSkuFixed, globalFixed]);

  // Net profit per unit at a given price: price − Ozon costs − COGS − VAT payable − income tax.
  // VAT payable = VAT on the price − deductions on Ozon services with VAT and on the VAT-bearing share of COGS.
  const profitAt = useCallback((econ: UnitEconomics, price: number) => {
    const pctCost = price * econ.pct;
    const services = pctCost + econ.fixedVatable + econ.fixedVatFree;
    const vatPayable = vatFrac * (price - pctCost - econ.fixedVatable) - vatFrac * econ.cogs * cogsVatFrac;
    const taxable = price - services - econ.cogs - vatPayable;
    return taxable - Math.max(0, taxable * taxRate);
  }, [vatFrac, cogsVatFrac, taxRate]);

  // Break-even (0% margin): the price where pre-tax profit is zero, solved from profitAt in closed form
  const breakEvenOf = useCallback((econ: UnitEconomics) => {
    const numerator = econ.fixedVatable * (1 - vatFrac) + econ.fixedVatFree + econ.cogs * (1 - vatFrac * cogsVatFrac);
    return numerator / ((1 - vatFrac) * (1 - econ.pct));
  }, [vatFrac, cogsVatFrac]);

  // Overall weighted margin: forecast profit at the planned prices over last period's volumes
  const overallMetrics = useMemo(() => {
    if (!items.length) return null;

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalQuantity = 0;

    items.forEach(item => {
      const econ = unitEconomics(item.article);
      if (!econ || econ.quantity <= 0) return;
      const basePrice = item.newPrice ?? item.currentPrice;
      totalRevenue += basePrice * econ.quantity;
      totalProfit += profitAt(econ, basePrice) * econ.quantity;
      totalQuantity += econ.quantity;
    });

    if (totalRevenue === 0 || totalQuantity === 0) return null;

    return {
      totalRevenue,
      totalProfit,
      totalQuantity,
      marginPct: totalProfit / totalRevenue
    };
  }, [items, unitEconomics, profitAt]);

  const breakEvenPrice = useCallback((article: string): number | null => {
    const econ = unitEconomics(article);
    return econ ? breakEvenOf(econ) : null;
  }, [unitEconomics, breakEvenOf]);

  // Promo floor ("Ограничение для акций и стратегий"): break-even, but Ozon rejects a floor below 50%
  // of the price ("Укажите минимальную цену не меньше 50%"), and it can't exceed the price itself.
  const minPriceFor = useCallback((item: RepricerItem) => {
    const price = item.newPrice ?? item.currentPrice;
    const ozonMin = Math.round(price * 0.5);
    const breakEven = breakEvenPrice(item.article);
    if (breakEven === null) return { value: ozonMin, breakEven, source: "fallback" as const };
    const floor = Math.ceil(breakEven);
    if (floor >= price) return { value: Math.round(price), breakEven, source: "capped" as const };
    if (floor < ozonMin) return { value: ozonMin, breakEven, source: "ozonMin" as const };
    return { value: floor, breakEven, source: "breakeven" as const };
  }, [breakEvenPrice]);

  // Group items by base model to alternate background colors
  const itemsWithGroups = useMemo(() => {
    let isAlternate = false;
    let lastGroup = "";

    return items.map((item, index) => {
      // Extract all alphabetical characters to form a strong group key (ignores all numbers and punctuation)
      const currentGroup = item.article.replace(/[^a-zA-Zа-яА-ЯёЁ]/g, '').toLowerCase();
      
      if (index === 0) {
        lastGroup = currentGroup;
      } else if (currentGroup !== lastGroup) {
        isAlternate = !isAlternate;
        lastGroup = currentGroup;
      }
      
      return { ...item, isAlternate };
    });
  }, [items]);

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
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Произошла ошибка при обработке файла");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleReset = () => {
    setParsedData(null);
    setItems([]);
    setError(null);
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
          // Borrow the calculated newPrice from the best matching sibling
          return { ...item, newPrice: clamp(item, bestCandidate.newPrice!), needsAttention: true };
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
    try {
      setIsProcessing(true);
      const blob = await exportOzonTemplate(
        parsedData,
        items.map(item => ({ ...item, minPrice: minPriceFor(item).value }))
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Обновленные_цены_${new Date().toLocaleDateString("ru-RU")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      setError("Ошибка при сохранении файла");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50/50 flex flex-col selection:bg-blue-500/20">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!parsedData}
        activeTab="repricer"
      />

      <div className="flex-1 flex flex-col px-4 sm:px-6 lg:px-8 py-8 w-full mx-auto">
        <div className="w-full space-y-8 transition-all duration-500 ease-out">
          
          {!parsedData && (
            <div className="mt-16 max-w-2xl mx-auto w-full">
              <div className="text-center space-y-4 mb-10">
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
            </div>
          )}

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-rose-50 text-rose-700 rounded-2xl border border-rose-200/60 text-sm flex items-center gap-3 max-w-2xl mx-auto shadow-sm"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span><strong className="font-semibold">Ошибка:</strong> {error}</span>
              </motion.div>
            )}

            {parsedData && items.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="space-y-6"
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-4 sm:p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60">
                   <div className="flex flex-wrap items-center gap-6">
                     <div>
                        <h3 className="text-lg font-bold text-slate-900">Список товаров</h3>
                        <p className="text-sm text-slate-500">Товаров: {items.length}</p>
                     </div>
                     {overallMetrics && (
                       <>
                         <div className="hidden sm:block h-10 w-px bg-slate-200"></div>
                         <div className="flex flex-col">
                           <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Средняя маржа (Прогноз)</span>
                           <div className="flex items-baseline gap-2 mt-0.5">
                             <span className={cn(
                               "text-xl font-bold",
                               overallMetrics.marginPct > 0 ? "text-emerald-600" : "text-rose-600"
                             )}>
                               {(overallMetrics.marginPct * 100).toFixed(1)}%
                             </span>
                             <span className="text-sm font-medium text-slate-400" title={`Прогноз чистой прибыли по всему проданному объему: ${new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(overallMetrics.totalProfit)}`}>
                               (~{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(overallMetrics.totalProfit)})
                             </span>
                           </div>
                         </div>
                       </>
                     )}
                   </div>
                   <div className="flex flex-wrap items-center gap-3">
                     <div
                        className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shadow-sm"
                        title="Изменить все новые цены на указанный процент. Если новая цена не задана — считается от текущей"
                     >
                        <button
                          onClick={() => handleBulkAdjust(-1)}
                          disabled={isProcessing || !bulkPctValid}
                          className="p-2 rounded-lg text-slate-600 hover:bg-white hover:text-rose-600 hover:shadow-sm disabled:opacity-40 disabled:hover:bg-transparent transition-all active:scale-95"
                          title="Снизить все новые цены"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <div className="flex items-center">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={bulkPct}
                            onChange={(e) => setBulkPct(e.target.value)}
                            className="w-12 py-1.5 bg-transparent text-center text-sm font-semibold text-slate-700 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            aria-label="Процент изменения цены"
                          />
                          <span className="text-sm font-semibold text-slate-500 pr-1">%</span>
                        </div>
                        <button
                          onClick={() => handleBulkAdjust(1)}
                          disabled={isProcessing || !bulkPctValid}
                          className="p-2 rounded-lg text-slate-600 hover:bg-white hover:text-emerald-600 hover:shadow-sm disabled:opacity-40 disabled:hover:bg-transparent transition-all active:scale-95"
                          title="Поднять все новые цены"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                     </div>
                     <button
                        onClick={() => handleApplyIndexGlobal()}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-95"
                     >
                        <RefreshCw className="w-4 h-4" />
                        Корректировать по индексу (Все)
                     </button>
                     <button
                        onClick={() => handleApplyIndexGlobal(true)}
                        disabled={isProcessing}
                        title="Поднять цену там, где индекс ниже 1. Товары, которым индекс снизил бы цену, остаются с текущей"
                        className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-95"
                     >
                        <TrendingUp className="w-4 h-4" />
                        Корректировать по индексу (Только вверх)
                     </button>
                     <button
                      onClick={handleDownload}
                      disabled={isProcessing}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95"
                     >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Скачать Excel для Ozon
                     </button>
                   </div>
                </div>

                <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-200/60">
                        <tr>
                          <th className="px-6 py-4">Артикул</th>
                          <th className="px-6 py-4 text-center">Индекс</th>
                          <th className="px-6 py-4 text-right">Текущая, ₽</th>
                          <th className="px-6 py-4">Новая, ₽</th>
                          <th className="px-6 py-4 text-right" title="Ограничение для акций и стратегий: ниже этой цены Ozon не опустит цену при автодобавлении в акции. Считается как цена с маржой 0%, но не меньше 50% от новой цены (требование Ozon) и не выше неё">Мин., ₽</th>
                          <th className="px-6 py-4 text-right">Клиенту, ₽</th>
                          <th className="px-6 py-4 text-right" title={`Чистая прибыль на единицу: цена − расходы Ozon − себестоимость − НДС ${vatRate}% (с вычетами по услугам Ozon и ${cogsVatShare}% себестоимости) − налог на прибыль ${incomeTaxRate}%. Та же модель, что «Реальная экономика» на странице начислений`}>Маржа (Прогноз)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {itemsWithGroups.map((item) => {
                          // Prefer the template discount: it's a fresh snapshot of what the buyer pays right now,
                          // while the report discount is a period average that lags behind recent price changes
                          const reportDiscount = accrualsDiscountMap[item.article] ?? 0;
                          const useTemplateDiscount = item.ozonDiscountPct > 0;
                          const discountToUse = useTemplateDiscount ? item.ozonDiscountPct : reportDiscount;
                          const sourceOfDiscount = useTemplateDiscount ? "по шаблону" : "по отчету";

                          // Calculate predicted customer price
                          const basePrice = item.newPrice ?? item.currentPrice;
                          const predictedCustomerPrice = basePrice * (1 - discountToUse);

                          const minPrice = minPriceFor(item);
                          const breakEvenLabel = minPrice.breakEven === null
                            ? ""
                            : `0% при ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(minPrice.breakEven)} ₽`;
                          const minPriceHint = {
                            fallback: "50% — нет данных для расчёта",
                            capped: `= цене, ${breakEvenLabel}`,
                            ozonMin: `50% от цены, ${breakEvenLabel}`,
                            breakeven: "маржа 0%",
                          }[minPrice.source];

                          // Calculate Margin
                          const cogs = skuCogs[item.article] || 0;
                          const econ = unitEconomics(item.article);
                          const expectedProfit = econ ? profitAt(econ, basePrice) : null;
                          const expectedMarginPct = expectedProfit !== null && basePrice > 0 ? expectedProfit / basePrice : null;

                          return (
                            <tr key={item.id} className={cn(
                              "transition-colors",
                              item.isAlternate ? "bg-slate-50/80 hover:bg-slate-100/60" : "bg-white hover:bg-slate-50/50"
                            )}>
                              <td className="px-6 py-4 font-medium text-slate-900 max-w-[200px] xl:max-w-[300px] truncate" title={item.article}>
                                {item.article}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {item.priceIndex ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className={cn(
                                      "px-2 py-1 rounded-md text-xs font-bold",
                                      item.priceIndex > 1.05 ? "bg-rose-50 text-rose-600" :
                                      item.priceIndex < 0.95 ? "bg-emerald-50 text-emerald-600" :
                                      "bg-slate-100 text-slate-600"
                                    )}>
                                      {item.priceIndex.toFixed(2)}
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
                                  <span className="text-slate-400 text-xs">—</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right font-medium text-slate-700">
                                {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(item.currentPrice)}
                              </td>
                              <td className="px-6 py-4">
                                <input 
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  placeholder={item.currentPrice.toString()}
                                  value={item.newPrice ?? ""}
                                  onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                  className={cn(
                                    "w-32 px-3 py-2 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 transition-all placeholder:text-slate-300",
                                    item.needsAttention 
                                      ? "bg-amber-50 border-amber-300 focus:ring-amber-500/20 focus:border-amber-500 text-amber-900" 
                                      : "bg-white border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
                                  )}
                                />
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex flex-col items-end">
                                  <span className={cn(
                                    "font-medium",
                                    minPrice.source === "fallback" ? "text-slate-400" : minPrice.source === "capped" ? "text-amber-600" : "text-slate-700"
                                  )}>
                                    {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(minPrice.value)}
                                  </span>
                                  <span className="text-[10px] text-slate-400 mt-0.5">{minPriceHint}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="font-bold text-emerald-600">
                                    {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(predictedCustomerPrice)}
                                  </span>
                                  {discountToUse > 0 && (
                                    <span 
                                      className="text-[11px] font-bold text-white bg-rose-500 shadow-sm px-2 py-0.5 rounded-full tracking-wide"
                                      title={`Скидка Ozon (${sourceOfDiscount})`}
                                    >
                                      -{(discountToUse * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                {expectedProfit !== null && expectedMarginPct !== null ? (
                                  <div className="flex flex-col items-end">
                                    <span className={cn(
                                      "font-bold",
                                      expectedProfit > 0 ? "text-emerald-600" : "text-rose-600"
                                    )}>
                                      {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(expectedProfit)}
                                    </span>
                                    <span className={cn(
                                      "text-[10px] font-semibold mt-0.5",
                                      expectedMarginPct > 0 ? "text-emerald-500/80" : "text-rose-500/80"
                                    )}>
                                      {(expectedMarginPct * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end">
                                    <span className="text-slate-400 text-sm">—</span>
                                    <span className="text-[10px] text-amber-500 mt-0.5">
                                      {!accrualsResult ? "Нет отчёта о начислениях" : cogs === 0 ? "Нет себестоимости" : "Нет данных"}
                                    </span>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

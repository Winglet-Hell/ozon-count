"use client";

import { useState, useCallback, useMemo } from "react";
import { Upload, Loader2, FileSpreadsheet, Download, RefreshCw, AlertTriangle, Coins } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { parseOzonTemplate, exportOzonTemplate, type ParsedTemplate, type RepricerItem } from "@/lib/repricer";
import { cn } from "@/lib/utils";
import { useAppState } from "@/components/StoreProvider";

export default function RepricerPage() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { 
    repricerParsedData: parsedData, 
    setRepricerParsedData: setParsedData, 
    repricerItems: items, 
    setRepricerItems: setItems,
    accrualsResult,
    skuCogs
  } = useAppState();

  // Extract real Ozon discounts from the Accruals report if available
  const accrualsDiscountMap = useMemo(() => {
    if (!accrualsResult) return {};
    
    const map: Record<string, { revenue: number, compensation: number }> = {};
    
    accrualsResult.skuTransactions.forEach(tx => {
      const isRevenue = tx.group === "Продажи" && tx.type === "Выручка";
      const isCompensation = tx.group.toLowerCase().includes("баллы за скидки") || tx.type.toLowerCase().includes("баллы за скидки");
      
      if (isRevenue || isCompensation) {
        if (!map[tx.sku]) map[tx.sku] = { revenue: 0, compensation: 0 };
        if (isRevenue) map[tx.sku].revenue += tx.amount;
        // Compensations are usually positive in the report, but just in case we take Math.abs
        if (isCompensation) map[tx.sku].compensation += Math.abs(tx.amount);
      }
    });

    const discounts: Record<string, number> = {};
    for (const [sku, data] of Object.entries(map)) {
      const total = data.revenue + data.compensation;
      if (total > 0 && data.compensation > 0) {
        discounts[sku] = data.compensation / total;
      } else {
        discounts[sku] = 0;
      }
    }
    return discounts;
  }, [accrualsResult]);

  // Extract Ozon expenses per SKU, separated into variable (%) and fixed (RUB), and global fixed expenses
  const { skuMetricsMap, globalFixedRubPerUnit, globalVariablePct, avgSkuFixedRubPerUnit } = useMemo(() => {
    if (!accrualsResult) return { skuMetricsMap: {}, globalFixedRubPerUnit: 0, globalVariablePct: 0, avgSkuFixedRubPerUnit: 0 };
    
    const map: Record<string, { revenue: number; variableExpenses: number; fixedExpenses: number; salesQuantity: number }> = {};
    
    let totalSkuOutflow = 0;
    let totalSkuInflow = 0;
    let totalSalesQuantity = 0;

    accrualsResult.skuTransactions.forEach(tx => {
      if (!map[tx.sku]) {
        map[tx.sku] = { revenue: 0, variableExpenses: 0, fixedExpenses: 0, salesQuantity: 0 };
      }
      
      const lowerGrp = tx.group.toLowerCase();
      const lowerType = tx.type.toLowerCase();

      if (tx.amount > 0) {
        totalSkuInflow += tx.amount;
        if (lowerGrp === "продажи" || lowerType.includes("выручка") || lowerType.includes("баллы за скидки") || lowerGrp.includes("баллы за скидки")) {
          map[tx.sku].revenue += tx.amount;
        } else {
          // Other positive compensations reduce fixed expenses
          map[tx.sku].fixedExpenses -= tx.amount;
        }
      } else if (tx.amount < 0) {
        totalSkuOutflow += tx.amount;
        const isVariable = 
          lowerGrp.includes("вознаграждение") ||
          lowerType.includes("вознаграждение") ||
          lowerGrp.includes("эквайринг") ||
          lowerType.includes("эквайринг") ||
          lowerType.includes("последняя миля") ||
          lowerType.includes("доставка до места выдачи") ||
          lowerType.includes("логистика") ||
          lowerGrp.includes("логистика") ||
          lowerGrp.includes("продвижение в поиске") ||
          lowerType.includes("возврат выручки") ||
          lowerType.includes("баллы за скидки");

        if (isVariable) {
          map[tx.sku].variableExpenses += Math.abs(tx.amount);
        } else {
          map[tx.sku].fixedExpenses += Math.abs(tx.amount);
        }
      }
      
      // Track quantity for weighted average margin ONLY from actual revenue rows to prevent double-counting compensation rows
      if (tx.group === "Продажи" && tx.quantity > 0 && tx.amount > 0 && (lowerType.includes("выручка") || lowerType.includes("доставлен покупателю"))) {
        map[tx.sku].salesQuantity += tx.quantity;
        totalSalesQuantity += tx.quantity;
      }
    });
    
    let totalVar = 0;
    let totalRev = 0;
    let totalSkuFixed = 0;

    const skuMetricsMap: Record<string, { variablePct: number; fixedRubPerUnit: number; quantity: number }> = {};
    for (const [sku, data] of Object.entries(map)) {
      skuMetricsMap[sku] = {
        variablePct: data.revenue > 0 ? (data.variableExpenses / data.revenue) : 0,
        fixedRubPerUnit: data.salesQuantity > 0 ? (data.fixedExpenses / data.salesQuantity) : 0,
        quantity: data.salesQuantity
      };
      totalVar += data.variableExpenses;
      totalRev += data.revenue;
      totalSkuFixed += data.fixedExpenses;
    }

    const globalOutflow = accrualsResult.totalOutflow - totalSkuOutflow; // both negative
    const globalInflow = accrualsResult.totalInflow - totalSkuInflow;
    const netGlobalExpenses = Math.max(0, Math.abs(globalOutflow) - globalInflow);
    const globalFixedRubPerUnit = totalSalesQuantity > 0 ? (netGlobalExpenses / totalSalesQuantity) : 0;
    
    const globalVariablePct = totalRev > 0 ? (totalVar / totalRev) : 0;
    const avgSkuFixedRubPerUnit = totalSalesQuantity > 0 ? (totalSkuFixed / totalSalesQuantity) : 0;

    return { skuMetricsMap, globalFixedRubPerUnit, globalVariablePct, avgSkuFixedRubPerUnit };
  }, [accrualsResult]);

  // Calculate overall weighted margin and profit based on history
  const overallMetrics = useMemo(() => {
    if (!items.length) return null;

    let totalRevenue = 0;
    let totalProfit = 0;
    let totalQuantity = 0;
    const taxRate = 0.25;

    items.forEach(item => {
      const basePrice = item.newPrice ?? item.currentPrice;
      const metrics = skuMetricsMap[item.article];
      const cogs = skuCogs[item.article] || 0;
      const qty = metrics?.quantity || 0;

      if (qty > 0) {
        let expectedProfit = 0;
        if (metrics) {
          const varExp = basePrice * metrics.variablePct;
          const fixExp = metrics.fixedRubPerUnit + globalFixedRubPerUnit;
          const taxableProfit = basePrice - varExp - fixExp - cogs;
          const taxAmount = Math.max(0, taxableProfit * taxRate);
          expectedProfit = taxableProfit - taxAmount;
        } else if (cogs > 0) {
          const varExp = basePrice * globalVariablePct;
          const fixExp = avgSkuFixedRubPerUnit + globalFixedRubPerUnit;
          const taxableProfit = basePrice - varExp - fixExp - cogs;
          const taxAmount = Math.max(0, taxableProfit * taxRate);
          expectedProfit = taxableProfit - taxAmount;
        }
        
        totalRevenue += basePrice * qty;
        totalProfit += expectedProfit * qty;
        totalQuantity += qty;
      }
    });

    if (totalRevenue === 0 || totalQuantity === 0) return null;

    return {
      totalRevenue,
      totalProfit,
      totalQuantity,
      marginPct: totalProfit / totalRevenue
    };
  }, [items, skuMetricsMap, skuCogs, globalFixedRubPerUnit, globalVariablePct, avgSkuFixedRubPerUnit]);

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

  const handleApplyIndexGlobal = () => {
    setItems(prev => {
      // Step 1: Compute adjusted prices for items that HAVE an index
      const indexedItems = prev
        .filter(item => item.priceIndex && item.priceIndex > 0)
        .map(item => ({
          ...item,
          newPrice: Math.round(item.currentPrice / item.priceIndex!),
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
          return { ...item, newPrice: bestCandidate.newPrice, needsAttention: true };
        }

        // Fallback: If no similar item is found, just use currentPrice
        return { ...item, newPrice: item.currentPrice, needsAttention: true };
      });
    });
  };

  const handleApplyIndexItem = (id: string, currentPrice: number, index: number) => {
    const adjustedPrice = Math.round(currentPrice / index);
    handlePriceChange(id, adjustedPrice.toString());
  };

  const handleDownload = async () => {
    if (!parsedData) return;
    try {
      setIsProcessing(true);
      const blob = await exportOzonTemplate(parsedData, items);
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
                     <button
                        onClick={handleApplyIndexGlobal}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all active:scale-95"
                     >
                        <RefreshCw className="w-4 h-4" />
                        Корректировать по индексу (Все)
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
                          <th className="px-6 py-4 text-right">Клиенту, ₽</th>
                          <th className="px-6 py-4 text-right">Маржа (Прогноз)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/80">
                        {itemsWithGroups.map((item) => {
                          // Determine the most accurate discount available
                          const reportDiscount = accrualsDiscountMap[item.article];
                          const discountToUse = reportDiscount !== undefined && reportDiscount > 0 ? reportDiscount : item.ozonDiscountPct;
                          const sourceOfDiscount = reportDiscount !== undefined && reportDiscount > 0 ? "по отчету" : "шаблон";

                          // Calculate predicted customer price
                          const basePrice = item.newPrice ?? item.currentPrice;
                          const predictedCustomerPrice = basePrice * (1 - discountToUse);

                          // Calculate Margin
                          const metrics = skuMetricsMap[item.article];
                          const cogs = skuCogs[item.article] || 0;
                          
                          let expectedProfit: number | null = null;
                          let expectedMarginPct: number | null = null;
                          const taxRate = 0.25;
                          
                          if (metrics) {
                            const varExp = basePrice * metrics.variablePct;
                            const fixExp = metrics.fixedRubPerUnit + globalFixedRubPerUnit;
                            const taxableProfit = basePrice - varExp - fixExp - cogs;
                            const taxAmount = Math.max(0, taxableProfit * taxRate);
                            expectedProfit = taxableProfit - taxAmount;
                            expectedMarginPct = basePrice > 0 ? expectedProfit / basePrice : 0;
                          } else if (cogs > 0) {
                            const varExp = basePrice * globalVariablePct;
                            const fixExp = avgSkuFixedRubPerUnit + globalFixedRubPerUnit;
                            const taxableProfit = basePrice - varExp - fixExp - cogs;
                            const taxAmount = Math.max(0, taxableProfit * taxRate);
                            expectedProfit = taxableProfit - taxAmount;
                            expectedMarginPct = basePrice > 0 ? expectedProfit / basePrice : 0;
                          }

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
                                    {cogs === 0 && <span className="text-[10px] text-amber-500 mt-0.5">Нет себестоимости</span>}
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

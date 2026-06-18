"use client";

import { useState, useCallback, useEffect } from "react";
import { Upload, Loader2, Coins, TrendingUp, TrendingDown, ReceiptText, ArrowRightLeft, FileSpreadsheet, Info, Percent, AlertTriangle, Check, FileDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { parseAccrualsReport, parseCogsCsv, parseCogsXlsx, type AccrualsSummary, type AccrualsBreakdownItem } from "@/lib/parseAccruals";
import { cn } from "@/lib/utils";

import { useAppState } from "@/components/StoreProvider";

const formatCurrency = (val: number, compact: boolean = false): string => {
  if (compact && Math.abs(val) >= 1000) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }).format(val);
  }
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

const getCategoryFromArticle = (article: string): string => {
  const artLower = article.toLowerCase();
  if (artLower.includes("тапоч") || artLower.includes("тапок")) return "Тапочки";
  if (artLower.includes("жилет")) return "Жилеты";
  if (artLower.includes("рубашк")) return "Рубашки";
  if (artLower.includes("носк")) return "Носки";
  return "Прочее";
};

const isCommission = (group: string, type: string): boolean => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  return g.includes("вознаграждение") || g.includes("комисси") || t.includes("вознаграждение") || t.includes("комисси");
};

const isLogistics = (group: string, type: string): boolean => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  const keywords = ["логистик", "доставк", "магистрал", "обработк", "сборк", "склад", "хранени", "кросс-док", "размещен", "упаковк", "сортировк"];
  return keywords.some(k => g.includes(k) || t.includes(k));
};

const isVolumeDependent = (group: string, type: string): boolean => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  
  if (g.includes("продажи") || g.includes("возвраты")) return true;
  if (isCommission(group, type)) return true;
  if (g.includes("эквайринг") || t.includes("эквайринг")) return true;
  
  if (isLogistics(group, type)) {
    // Исключаем хранение и размещение из пропорционального масштабирования
    if (g.includes("хранени") || t.includes("хранени") || g.includes("размещен") || t.includes("размещен") || g.includes("кросс-док") || t.includes("кросс-док")) {
      return false;
    }
    return true;
  }
  return false;
};

export default function AccrualsPage() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { accrualsResult: result, setAccrualsResult: setResult, skuCogs, setSkuCogs, cogsFileName, setCogsFileName } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "inflow" | "outflow">("all");
  const [groupingMode, setGroupingMode] = useState<"narrow" | "extended" | "hierarchical">("extended");

  // Cost Database States
  const [isCogsLoading, setIsCogsLoading] = useState(false);
  const [cogsError, setCogsError] = useState<string | null>(null);

  // Forecasting States
  const [isForecastMode, setIsForecastMode] = useState(false);
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [logisticsRate, setLogisticsRate] = useState<number | null>(null);
  const [cogsRate, setCogsRate] = useState<number | null>(null);
  const [categoryGrowth, setCategoryGrowth] = useState<Record<string, number>>({});

  // Auto-load default себестоимость file on mount (prefers XLSX template if available)
  useEffect(() => {
    const fetchDefaultCogs = async () => {
      try {
        let finalCogs: Record<string, number> = {};
        let finalName = "";

        // Try XLSX template first
        const xlsxRes = await fetch("/Шаблон для обновления цен_18.06.26 (2).xlsx");
        if (xlsxRes.ok) {
          const blob = await xlsxRes.blob();
          const file = new File([blob], "Шаблон для обновления цен_18.06.26 (2).xlsx");
          finalCogs = await parseCogsXlsx(file);
          finalName = "Шаблон для обновления цен_18.06.26 (2).xlsx (авто)";
        } else {
          // Fallback to CSV database
          const csvRes = await fetch("/Товары что мы продаем.csv");
          if (csvRes.ok) {
            const text = await csvRes.text();
            finalCogs = parseCogsCsv(text);
            finalName = "Товары что мы продаем.csv (авто)";
          }
        }

        // Merge with archived COGS
        try {
          const archRes = await fetch("/archived_cogs.csv");
          if (archRes.ok) {
            const text = await archRes.text();
            const archCogs = parseCogsCsv(text);
            finalCogs = { ...finalCogs, ...archCogs };
            if (finalName) {
              finalName += " + Архив";
            } else {
              finalName = "archived_cogs.csv (авто)";
            }
          }
        } catch (e) {}

        if (Object.keys(finalCogs).length > 0) {
          setSkuCogs(finalCogs);
          setCogsFileName(finalName);
        }
      } catch (err) {
        console.error("Ошибка автозагрузки себестоимости:", err);
      }
    };
    fetchDefaultCogs();
  }, []);

  const handleCogsFile = useCallback(async (file: File) => {
    setIsCogsLoading(true);
    setCogsError(null);
    try {
      let parsed: Record<string, number> = {};
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        parsed = parseCogsCsv(text);
      } else if (file.name.endsWith(".xlsx")) {
        parsed = await parseCogsXlsx(file);
      } else {
        throw new Error("Пожалуйста, загрузите себестоимость в формате CSV (.csv) или Excel (.xlsx)");
      }

      // Automatically merge with archived COGS if available
      try {
        const archRes = await fetch("/archived_cogs.csv");
        if (archRes.ok) {
          const text = await archRes.text();
          const archCogs = parseCogsCsv(text);
          parsed = { ...parsed, ...archCogs };
        }
      } catch (e) {}

      setSkuCogs(parsed);
      setCogsFileName(file.name + " + Архив");

    } catch (err) {
      console.error(err);
      setCogsError(err instanceof Error ? err.message : "Ошибка загрузки себестоимости");
    } finally {
      setIsCogsLoading(false);
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      if (!file.name.endsWith(".xlsx")) {
        throw new Error("Пожалуйста, загрузите файл отчета в формате Excel (.xlsx)");
      }

      const data = await parseAccrualsReport(file);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Произошла ошибка при обработке файла");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleReset = () => {
    setResult(null);
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

  // Calculate COGS and real economy metrics (unadjusted)
  let baseProductionCogs = 0;
  let scaledBaseProductionCogs = 0;
  const missingCogsSkus: Record<string, { qty: number }> = {};

  const categoryData: Record<string, { sold: number; returned: number; revenue: number }> = {
    "Тапочки": { sold: 0, returned: 0, revenue: 0 },
    "Жилеты": { sold: 0, returned: 0, revenue: 0 },
    "Рубашки": { sold: 0, returned: 0, revenue: 0 },
    "Носки": { sold: 0, returned: 0, revenue: 0 },
    "Прочее": { sold: 0, returned: 0, revenue: 0 }
  };

  if (result && result.skuTransactions) {
    result.skuTransactions.forEach((tx) => {
      const isSale = tx.group === "Продажи" && tx.type === "Выручка";
      const isReturn = tx.group === "Возвраты" && tx.type === "Возврат выручки";

      if (isSale || isReturn) {
        const cogsRateVal = skuCogs[tx.sku] || 0;
        const qty = tx.quantity;
        const amt = tx.amount;
        const category = getCategoryFromArticle(tx.sku);
        const growth = isForecastMode ? (categoryGrowth[category] ?? 1) : 1;

        if (cogsRateVal === 0) {
          if (!missingCogsSkus[tx.sku]) {
            missingCogsSkus[tx.sku] = { qty: 0 };
          }
          missingCogsSkus[tx.sku].qty += qty;
        }

        const rowCogs = qty * cogsRateVal;
        const scaledRowCogs = rowCogs * growth;
        if (isSale) {
          baseProductionCogs += rowCogs;
          scaledBaseProductionCogs += scaledRowCogs;
          categoryData[category].sold += qty;
          categoryData[category].revenue += amt;
        } else if (isReturn) {
          baseProductionCogs -= rowCogs;
          scaledBaseProductionCogs -= scaledRowCogs;
          categoryData[category].returned += qty;
          categoryData[category].revenue += amt;
        }
      }
    });
  }

  const activeCategories = Object.entries(categoryData)
    .map(([name, data]) => ({
      name,
      ...data,
      net: data.sold - data.returned
    }))
    .filter(cat => cat.sold > 0 || cat.returned > 0)
    .sort((a, b) => b.net - a.net);

  const totalNetItems = activeCategories.reduce((sum, cat) => sum + cat.net, 0);

  // Calculate actual base sums for Ozon commission and logistics
  let actualCommissionSum = 0;
  let actualLogisticsSum = 0;
  if (result) {
    result.breakdown.forEach((item) => {
      if (isCommission(item.group, item.type)) {
        actualCommissionSum += -item.amount; // commissions are negative, sum as positive
      } else if (isLogistics(item.group, item.type)) {
        actualLogisticsSum += -item.amount; // logistics are negative, sum as positive
      }
    });
  }

  // Actual (un-adjusted) Ozon Flow Metrics
  const actualTotalInflow = result ? result.totalInflow : 0;
  const actualTotalOutflow = result ? result.totalOutflow : 0;
  const actualNetResult = result ? result.netResult : 0;
  const actualOzonMargin = actualTotalInflow > 0 ? (actualNetResult / actualTotalInflow) * 100 : 0;

  // Actual rates relative to inflow
  const actualCommissionRate = actualTotalInflow > 0 ? (actualCommissionSum / actualTotalInflow) * 100 : 0;
  const actualLogisticsRate = actualTotalInflow > 0 ? (actualLogisticsSum / actualTotalInflow) * 100 : 0;
  const actualCogsRate = actualTotalInflow > 0 ? (baseProductionCogs / actualTotalInflow) * 100 : 0;

  // Sync sliders to report actual rates when a new report/cogs loads
  useEffect(() => {
    if (result) {
      setCommissionRate(actualCommissionRate);
      setLogisticsRate(actualLogisticsRate);
      setCogsRate(actualCogsRate);
    } else {
      setCommissionRate(null);
      setLogisticsRate(null);
      setCogsRate(null);
    }
  }, [result, actualCommissionRate, actualLogisticsRate, actualCogsRate]);

  // Target rates (user selected or fallback to actuals)
  const targetCommissionRate = isForecastMode && commissionRate !== null ? commissionRate : actualCommissionRate;
  const targetLogisticsRate = isForecastMode && logisticsRate !== null ? logisticsRate : actualLogisticsRate;
  const targetCogsRate = isForecastMode && cogsRate !== null ? cogsRate : actualCogsRate;

  // Generate adjusted breakdown and totals
  const adjustedBreakdownItems = result ? result.breakdown.map((item) => {
    let amt = item.amount;
    
    if (isForecastMode) {
      // 1. Scale based on volume
      const txs = result.skuTransactions.filter(tx => tx.group === item.group && tx.type === item.type);
      if (txs.length > 0 && isVolumeDependent(item.group, item.type)) {
        let skuPortion = 0;
        let scaledSkuPortion = 0;
        txs.forEach(tx => {
          const cat = getCategoryFromArticle(tx.sku);
          const growth = categoryGrowth[cat] ?? 1;
          skuPortion += tx.amount;
          scaledSkuPortion += tx.amount * growth;
        });
        amt = amt - skuPortion + scaledSkuPortion;
      }

      // 2. Apply rate adjustments (Commission, Logistics)
      if (amt < 0) {
        if (isCommission(item.group, item.type)) {
          amt = actualCommissionRate > 0 
            ? amt * (targetCommissionRate / actualCommissionRate)
            : amt;
        } else if (isLogistics(item.group, item.type)) {
          amt = actualLogisticsRate > 0 
            ? amt * (targetLogisticsRate / actualLogisticsRate)
            : amt;
        }
      }
    }
    
    return {
      ...item,
      amount: amt
    };
  }) : [];

  if (isForecastMode && result) {
    if (actualCommissionRate === 0 && targetCommissionRate > 0) {
      adjustedBreakdownItems.push({
        group: "Комиссии (Моделирование)",
        type: "Смоделированная комиссия",
        amount: -actualTotalInflow * (targetCommissionRate / 100),
        pctOfInflow: 0,
        pctOfOutflow: 0,
        pctOfTotalInflowForOutflow: 0
      });
    }
    if (actualLogisticsRate === 0 && targetLogisticsRate > 0) {
      adjustedBreakdownItems.push({
        group: "Логистика (Моделирование)",
        type: "Смоделированная логистика",
        amount: -actualTotalInflow * (targetLogisticsRate / 100),
        pctOfInflow: 0,
        pctOfOutflow: 0,
        pctOfTotalInflowForOutflow: 0
      });
    }
  }

  let adjustedTotalInflow = actualTotalInflow;
  let adjustedTotalOutflow = actualTotalOutflow;

  if (isForecastMode && result) {
    adjustedBreakdownItems.forEach((item, i) => {
      const origItem = i < result.breakdown.length ? result.breakdown[i] : null;
      const delta = origItem ? item.amount - origItem.amount : item.amount;
      
      if (delta !== 0) {
        if ((origItem && origItem.amount < 0) || !origItem) {
          adjustedTotalOutflow += delta;
        } else {
          adjustedTotalInflow += delta;
        }
      }
    });
  }

  const adjustedNetResultFromFlows = adjustedTotalInflow + adjustedTotalOutflow;

  const finalBreakdown = adjustedBreakdownItems.map((item) => {
    const pctOfInflow = item.amount > 0 ? (item.amount / (adjustedTotalInflow || 1)) * 100 : 0;
    const pctOfOutflow = item.amount < 0 ? (Math.abs(item.amount) / (Math.abs(adjustedTotalOutflow) || 1)) * 100 : 0;
    const pctOfTotalInflowForOutflow = item.amount < 0 ? (Math.abs(item.amount) / (adjustedTotalInflow || 1)) * 100 : 0;

    return {
      ...item,
      pctOfInflow,
      pctOfOutflow,
      pctOfTotalInflowForOutflow
    };
  });

  finalBreakdown.sort((a, b) => {
    if (a.amount > 0 && b.amount < 0) return -1;
    if (a.amount < 0 && b.amount > 0) return 1;
    return Math.abs(b.amount) - Math.abs(a.amount);
  });

  // Get aggregated breakdown based on groupingMode
  const getAggregatedBreakdown = () => {
    if (!result) return [];
    if (groupingMode === "extended") return finalBreakdown;

    const map: Record<string, { group: string; type: string; amount: number }> = {};
    finalBreakdown.forEach((item) => {
      if (!map[item.group]) {
        map[item.group] = {
          group: item.group,
          type: "Все операции группы",
          amount: 0
        };
      }
      map[item.group].amount += item.amount;
    });

    const list = Object.values(map);
    list.sort((a, b) => {
      if (a.amount > 0 && b.amount < 0) return -1;
      if (a.amount < 0 && b.amount > 0) return 1;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });

    return list.map((item) => {
      const pctOfInflow = item.amount > 0 ? (item.amount / (adjustedTotalInflow || 1)) * 100 : 0;
      const pctOfOutflow = item.amount < 0 ? (Math.abs(item.amount) / (Math.abs(adjustedTotalOutflow) || 1)) * 100 : 0;
      const pctOfTotalInflowForOutflow = item.amount < 0 ? (Math.abs(item.amount) / (adjustedTotalInflow || 1)) * 100 : 0;

      return {
        group: item.group,
        type: item.type,
        amount: item.amount,
        pctOfInflow,
        pctOfOutflow,
        pctOfTotalInflowForOutflow
      };
    });
  };

  // Get hierarchical breakdown
  const getHierarchicalBreakdown = () => {
    if (!result) return [];

    const map: Record<string, {
      group: string;
      amount: number;
      children: { type: string; amount: number }[];
    }> = {};

    finalBreakdown.forEach((item) => {
      if (!map[item.group]) {
        map[item.group] = {
          group: item.group,
          amount: 0,
          children: []
        };
      }
      map[item.group].amount += item.amount;
      map[item.group].children.push({
        type: item.type,
        amount: item.amount
      });
    });

    const list = Object.values(map);

    const resolvedList = list.map((item) => {
      const pctOfInflow = item.amount > 0 ? (item.amount / (adjustedTotalInflow || 1)) * 100 : 0;
      const pctOfOutflow = item.amount < 0 ? (Math.abs(item.amount) / (Math.abs(adjustedTotalOutflow) || 1)) * 100 : 0;
      const pctOfTotalInflowForOutflow = item.amount < 0 ? (Math.abs(item.amount) / (adjustedTotalInflow || 1)) * 100 : 0;

      const children = item.children
        .map((child) => {
          const cPctOfInflow = child.amount > 0 ? (child.amount / (adjustedTotalInflow || 1)) * 100 : 0;
          const cPctOfOutflow = child.amount < 0 ? (Math.abs(child.amount) / (Math.abs(adjustedTotalOutflow) || 1)) * 100 : 0;
          const cPctOfTotalInflowForOutflow = child.amount < 0 ? (Math.abs(child.amount) / (adjustedTotalInflow || 1)) * 100 : 0;

          return {
            type: child.type,
            amount: child.amount,
            pctOfInflow: cPctOfInflow,
            pctOfOutflow: cPctOfOutflow,
            pctOfTotalInflowForOutflow: cPctOfTotalInflowForOutflow
          };
        })
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

      return {
        group: item.group,
        amount: item.amount,
        pctOfInflow,
        pctOfOutflow,
        pctOfTotalInflowForOutflow,
        children
      };
    });

    resolvedList.sort((a, b) => {
      if (a.amount > 0 && b.amount < 0) return -1;
      if (a.amount < 0 && b.amount > 0) return 1;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });

    return resolvedList;
  };

  // Filter hierarchical items based on activeFilter
  const filteredHierarchical = (() => {
    const list = getHierarchicalBreakdown();
    
    return list.map(groupItem => {
      const filteredChildren = groupItem.children.filter(child => {
        if (activeFilter === "inflow") return child.amount > 0;
        if (activeFilter === "outflow") return child.amount < 0;
        return true;
      });
      
      const filteredSum = filteredChildren.reduce((sum, c) => sum + c.amount, 0);
      
      return {
        ...groupItem,
        children: filteredChildren,
        filteredSum
      };
    }).filter(groupItem => {
      if (activeFilter === "inflow") return groupItem.children.length > 0 && groupItem.filteredSum > 0;
      if (activeFilter === "outflow") return groupItem.children.length > 0 && groupItem.filteredSum < 0;
      return groupItem.children.length > 0;
    });
  })();

  // Filter flat breakdown items
  const filteredBreakdown = getAggregatedBreakdown().filter((item) => {
    if (activeFilter === "inflow") return item.amount > 0;
    if (activeFilter === "outflow") return item.amount < 0;
    return true;
  });

  const totalProductionCogs = (isForecastMode && actualCogsRate === 0)
    ? (adjustedTotalInflow * (targetCogsRate / 100))
    : scaledBaseProductionCogs * (actualCogsRate > 0 ? targetCogsRate / actualCogsRate : 1);

  const taxableProfit = adjustedTotalInflow + adjustedTotalOutflow - totalProductionCogs;
  const taxRate = 0.25; // Ставка налога на прибыль ОСНО на 2026 год составляет 25%
  const taxAmount = Math.max(0, taxableProfit * taxRate);
  const adjustedNetResult = taxableProfit - taxAmount;
  const adjustedMargin = adjustedTotalInflow ? (adjustedNetResult / adjustedTotalInflow) * 100 : 0;

  // Actual (un-adjusted) Real Economy Metrics
  const actualProductionCogs = baseProductionCogs;
  const actualTaxableProfit = actualNetResult - actualProductionCogs;
  const actualTaxAmount = Math.max(0, actualTaxableProfit * taxRate);
  const actualRealNetResult = actualTaxableProfit - actualTaxAmount;
  const actualRealMargin = actualTotalInflow ? (actualRealNetResult / actualTotalInflow) * 100 : 0;



  return (
    <main className="min-h-screen bg-slate-50/50 flex flex-col selection:bg-blue-500/20">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!result}
        period={result?.period || undefined}
      >
        {result && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => document.getElementById("csv-file-upload-active")?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-900"
              title={cogsFileName ? `Себестоимость: ${cogsFileName}` : "Загрузить себестоимость"}
            >
              {isCogsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : cogsFileName ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span className="hidden xl:inline">Себестоимость</span>
            </button>
            <input
              id="csv-file-upload-active"
              type="file"
              className="hidden"
              accept=".csv,.xlsx"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleCogsFile(e.target.files[0]);
                }
              }}
            />

            <button
              onClick={() => setIsForecastMode(!isForecastMode)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all",
                isForecastMode 
                  ? "bg-blue-50 text-blue-600 border border-blue-200" 
                  : "bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Моделирование</span>
            </button>
          </div>
        )}
      </Header>

      <div className="flex-1 flex flex-col px-4 sm:px-6 lg:px-8 py-8 w-full max-w-[1600px] mx-auto">
        <div className="w-full space-y-8 transition-all duration-500 ease-out">
          
          {!result && (
            <div className="mt-16 max-w-2xl mx-auto w-full">
              <div className="text-center space-y-4 mb-10">
                <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  Анализ начислений <span className="text-blue-600">Ozon</span>
                </h2>
                <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                  Загрузите отчет о начислениях, чтобы увидеть детальную расшифровку всех операций, комиссий и логистики.
                </p>
              </div>

              <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 p-2 overflow-hidden">
                <div className="p-6 sm:p-10 space-y-8 bg-slate-50/50 rounded-[1.25rem]">
                  {/* Excel Report File Dropzone */}
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
                        {isProcessing ? "Обработка отчета..." : "Загрузите отчет Excel (.xlsx)"}
                      </p>
                      <p className="text-sm text-slate-500">
                        Перетащите файл сюда или нажмите для выбора
                      </p>
                    </div>
                  </div>

                  {/* CSV Cogs File Status */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 transition-all hover:border-slate-300">
                    <div className="flex items-center gap-3.5 w-full sm:w-auto">
                      <div className={cn(
                        "p-3 rounded-xl transition-colors",
                        cogsFileName ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400",
                        isCogsLoading && "animate-pulse"
                      )}>
                        {isCogsLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : cogsFileName ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Coins className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">База себестоимости</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {cogsFileName 
                            ? `${cogsFileName} (${Object.keys(skuCogs).length} арт.)`
                            : "Не загружена (себестоимость = 0)"}
                        </p>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto flex justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("csv-file-upload")?.click();
                        }}
                        className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        Обновить
                      </button>
                      <input
                        id="csv-file-upload"
                        type="file"
                        className="hidden"
                        accept=".csv,.xlsx"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleCogsFile(e.target.files[0]);
                          }
                        }}
                      />
                    </div>
                  </div>

                  {cogsError && (
                    <div className="p-4 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      {cogsError}
                    </div>
                  )}
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

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="space-y-8"
              >


                {/* Main Content Layout: side-by-side on xl screens */}
                <div className="flex flex-col xl:flex-row-reverse items-start gap-8 w-full">
                  
                  {/* RIGHT SIDE: Settings Sidebar */}
                  <AnimatePresence>
                    {isForecastMode && (
                      <motion.div
                        initial={{ opacity: 0, x: 20, width: 0 }}
                        animate={{ opacity: 1, x: 0, width: "auto" }}
                        exit={{ opacity: 0, x: 20, width: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                        className="w-full xl:w-[420px] shrink-0 xl:sticky xl:top-24 xl:z-20"
                      >
                        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-blue-100/80 p-6 sm:p-8 space-y-8 relative w-full xl:w-[420px] xl:max-h-[calc(100vh-8rem)] overflow-y-auto overflow-x-hidden
                          [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">

                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            Настройка параметров
                          </h3>
                        </div>

                        <div className="space-y-6">
                          {/* Commission Slider */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-bold text-slate-700">Комиссия Ozon</label>
                              <div className="flex items-center gap-1.5">
                                {commissionRate !== null && Math.abs(commissionRate - actualCommissionRate) > 0.05 && (
                                  <span className={cn(
                                    "text-xs font-bold px-1.5 py-0.5 rounded-md",
                                    commissionRate > actualCommissionRate ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                                  )}>
                                    {commissionRate > actualCommissionRate ? "+" : ""}{(commissionRate - actualCommissionRate).toFixed(1)}%
                                  </span>
                                )}
                                <span className="text-sm font-extrabold text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                                  {(commissionRate ?? actualCommissionRate).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={Math.max(0, Math.floor(actualCommissionRate - 15))}
                              max={Math.ceil(actualCommissionRate + 20)}
                              step="0.1"
                              value={commissionRate ?? actualCommissionRate}
                              onChange={(e) => setCommissionRate(parseFloat(e.target.value))}
                              className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                            />
                            <div className="flex justify-between text-xs font-semibold text-slate-400">
                              <span>{Math.max(0, Math.floor(actualCommissionRate - 15))}%</span>
                              <span>Факт: {actualCommissionRate.toFixed(1)}%</span>
                              <span>{Math.ceil(actualCommissionRate + 20)}%</span>
                            </div>
                          </div>

                          {/* Logistics Slider */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-bold text-slate-700">Логистика</label>
                              <div className="flex items-center gap-1.5">
                                {logisticsRate !== null && Math.abs(logisticsRate - actualLogisticsRate) > 0.05 && (
                                  <span className={cn(
                                    "text-xs font-bold px-1.5 py-0.5 rounded-md",
                                    logisticsRate > actualLogisticsRate ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                                  )}>
                                    {logisticsRate > actualLogisticsRate ? "+" : ""}{(logisticsRate - actualLogisticsRate).toFixed(1)}%
                                  </span>
                                )}
                                <span className="text-sm font-extrabold text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                                  {(logisticsRate ?? actualLogisticsRate).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={Math.max(0, Math.floor(actualLogisticsRate - 15))}
                              max={Math.ceil(actualLogisticsRate + 20)}
                              step="0.1"
                              value={logisticsRate ?? actualLogisticsRate}
                              onChange={(e) => setLogisticsRate(parseFloat(e.target.value))}
                              className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                            />
                            <div className="flex justify-between text-xs font-semibold text-slate-400">
                              <span>{Math.max(0, Math.floor(actualLogisticsRate - 15))}%</span>
                              <span>Факт: {actualLogisticsRate.toFixed(1)}%</span>
                              <span>{Math.ceil(actualLogisticsRate + 20)}%</span>
                            </div>
                          </div>

                          {/* COGS Slider */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="text-sm font-bold text-slate-700">Себестоимость</label>
                              <div className="flex items-center gap-1.5">
                                {cogsRate !== null && Math.abs(cogsRate - actualCogsRate) > 0.05 && (
                                  <span className={cn(
                                    "text-xs font-bold px-1.5 py-0.5 rounded-md",
                                    cogsRate > actualCogsRate ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                                  )}>
                                    {cogsRate > actualCogsRate ? "+" : ""}{(cogsRate - actualCogsRate).toFixed(1)}%
                                  </span>
                                )}
                                <span className="text-sm font-extrabold text-slate-900 bg-slate-100 px-2 py-1 rounded-lg">
                                  {(cogsRate ?? actualCogsRate).toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min={actualCogsRate > 0 ? Math.max(0, Math.floor(actualCogsRate - 15)) : 0}
                              max={actualCogsRate > 0 ? Math.ceil(actualCogsRate + 20) : 50}
                              step="0.1"
                              value={cogsRate ?? actualCogsRate}
                              onChange={(e) => setCogsRate(parseFloat(e.target.value))}
                              className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                            />
                            <div className="flex justify-between text-xs font-semibold text-slate-400">
                              <span>{actualCogsRate > 0 ? Math.max(0, Math.floor(actualCogsRate - 15)) : 0}%</span>
                              <span>Факт: {actualCogsRate.toFixed(1)}%</span>
                              <span>{actualCogsRate > 0 ? Math.ceil(actualCogsRate + 20) : 50}%</span>
                            </div>
                          </div>
                        </div>

                        {/* Categories Growth */}
                        {activeCategories.length > 0 && (
                          <div className="pt-8 mt-6 border-t border-blue-100/50">
                            <h4 className="text-sm font-bold text-slate-900 mb-6">Рост продаж по категориям</h4>
                            <div className="space-y-4">
                              {activeCategories.map(cat => {
                                const currentGrowth = categoryGrowth[cat.name] ?? 1;
                                const pctChange = Math.round((currentGrowth - 1) * 100);
                                return (
                                  <div key={cat.name} className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <label className="text-sm font-bold text-slate-700">{cat.name}</label>
                                        <span className="text-xs font-semibold text-slate-400">
                                          ({Math.round(cat.net * currentGrowth)} шт.)
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className={cn(
                                          "text-xs font-bold px-1.5 py-0.5 rounded-md",
                                          pctChange > 0 ? "bg-emerald-50 text-emerald-600" : pctChange < 0 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"
                                        )}>
                                          {pctChange > 0 ? "+" : ""}{pctChange}%
                                        </span>
                                      </div>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max="4"
                                      step="0.05"
                                      value={currentGrowth}
                                      onChange={(e) => setCategoryGrowth(prev => ({ ...prev, [cat.name]: parseFloat(e.target.value) }))}
                                      className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                                    />
                                    <div className="flex justify-between text-xs font-semibold text-slate-400">
                                      <span>-100%</span>
                                      <span>Факт</span>
                                      <span>+300%</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Reset Settings */}
                        <div className="pt-6 border-t border-slate-100 mt-auto">
                          <button
                            onClick={() => {
                              setCommissionRate(actualCommissionRate);
                              setLogisticsRate(actualLogisticsRate);
                              setCogsRate(actualCogsRate);
                              setCategoryGrowth({});
                            }}
                            className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl transition-colors flex justify-center items-center gap-2"
                          >
                            Сбросить все настройки
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* LEFT SIDE: Metrics and Tables */}
                <div className="flex-1 w-full space-y-8 min-w-0">

                  {/* Missing SKU Warnings */}
                {Object.keys(missingCogsSkus).length > 0 && (
                  <div className="p-6 bg-amber-50/50 border border-amber-200/60 rounded-3xl space-y-4 shadow-sm">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl shrink-0">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-base font-bold text-amber-900">
                          Внимание: найдены артикулы без себестоимости ({Object.keys(missingCogsSkus).length} шт.)
                        </h4>
                        <p className="text-sm text-amber-800/80 leading-relaxed max-w-3xl">
                          В отчете есть продажи для товаров, которых нет в вашей базе себестоимости. Для расчетов их себестоимость принята за 0. Рекомендуется обновить CSV/Excel базу.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(missingCogsSkus).slice(0, 10).map(([sku, data]) => (
                        <span key={sku} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-200/60 rounded-lg text-sm font-medium text-slate-700">
                          <span className="font-mono text-slate-600">{sku}</span>
                          <span className="text-amber-600 font-bold bg-amber-50 px-1.5 rounded">{data.qty} шт.</span>
                        </span>
                      ))}
                      {Object.keys(missingCogsSkus).length > 10 && (
                        <span className="inline-flex items-center px-3 py-1.5 bg-transparent text-sm font-medium text-amber-700">
                          + еще {Object.keys(missingCogsSkus).length - 10} артикулов
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Summary Metrics Section - Row 1 (Ozon Cash Flow) */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">Финансовый поток Ozon</h3>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    <SummaryCard
                      title="Поступило денег"
                      value={adjustedTotalInflow}
                      originalValue={actualTotalInflow}
                      isForecastActive={isForecastMode}
                      icon={<TrendingUp className="w-6 h-6 text-emerald-500" />}
                    />
                    <SummaryCard
                      title="Списано (Услуги)"
                      value={adjustedTotalOutflow}
                      originalValue={actualTotalOutflow}
                      isForecastActive={isForecastMode}
                      icon={<TrendingDown className="w-6 h-6 text-rose-500" />}
                      subText={adjustedTotalInflow ? `${(Math.abs(adjustedTotalOutflow) / adjustedTotalInflow * 100).toFixed(1)}% от прихода` : undefined}
                    />
                    <SummaryCard
                      title="К выплате"
                      value={adjustedNetResultFromFlows}
                      originalValue={actualNetResult}
                      isForecastActive={isForecastMode}
                      icon={<Coins className="w-6 h-6 text-blue-500" />}
                      highlight
                    />
                    <SummaryCard
                      title="Маржинальность"
                      value={adjustedTotalInflow ? (adjustedNetResultFromFlows / adjustedTotalInflow) * 100 : 0}
                      originalValue={actualOzonMargin}
                      isForecastActive={isForecastMode}
                      icon={<Percent className="w-6 h-6 text-indigo-500" />}
                      isPercent
                    />
                  </div>
                </div>

                {/* Summary Metrics Section - Row 2 (Real Economy) */}
                <div className="space-y-6 pt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">Реальная экономика</h3>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    <SummaryCard
                      title="Себестоимость"
                      value={totalProductionCogs}
                      originalValue={actualProductionCogs}
                      isForecastActive={isForecastMode}
                      inverseDifference
                      icon={<ReceiptText className="w-6 h-6 text-amber-500" />}
                      subText={adjustedTotalInflow ? `${(totalProductionCogs / adjustedTotalInflow * 100).toFixed(1)}% от прихода` : undefined}
                    />
                    <SummaryCard
                      title="Налог (ОСНО 25%)"
                      value={taxAmount}
                      originalValue={actualTaxAmount}
                      isForecastActive={isForecastMode}
                      inverseDifference
                      icon={<FileDown className="w-6 h-6 text-orange-500" />}
                      subText={taxableProfit > 0 ? `${(taxAmount / adjustedTotalInflow * 100).toFixed(1)}% от прихода` : "Нет прибыли"}
                    />
                    <SummaryCard
                      title="Чистая прибыль"
                      value={adjustedNetResult}
                      originalValue={actualRealNetResult}
                      isForecastActive={isForecastMode}
                      icon={<Coins className="w-6 h-6 text-violet-500" />}
                      highlight
                    />
                    <SummaryCard
                      title="Итоговая маржа"
                      value={adjustedMargin}
                      originalValue={actualRealMargin}
                      isForecastActive={isForecastMode}
                      icon={<Percent className="w-6 h-6 text-fuchsia-500" />}
                      isPercent
                    />
                  </div>
                </div>

                {/* Product Categories Breakdown */}
                {activeCategories.length > 0 && (
                  <div className="space-y-6 pt-4">
                    <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">Продажи по категориям</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                      {activeCategories.map((cat) => {
                        const currentGrowth = isForecastMode ? (categoryGrowth[cat.name] ?? 1) : 1;
                        const displayNet = Math.round(cat.net * currentGrowth);
                        const displaySold = Math.round(cat.sold * currentGrowth);
                        const displayReturned = Math.round(cat.returned * currentGrowth);
                        const displayRevenue = cat.revenue * currentGrowth;
                        
                        const adjustedTotalNetItems = isForecastMode 
                          ? activeCategories.reduce((acc, c) => acc + c.net * (categoryGrowth[c.name] ?? 1), 0) 
                          : totalNetItems;
                        const pctOfTotal = adjustedTotalNetItems > 0 ? (displayNet / adjustedTotalNetItems) * 100 : 0;

                        return (
                          <div key={cat.name} className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 p-6 flex flex-col justify-between space-y-5 hover:-translate-y-1 transition-all duration-300">
                            <div>
                              <span className="text-sm font-bold text-slate-500">{cat.name}</span>
                              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2 tracking-tight truncate" title={`${displayNet} шт.`}>
                                {displayNet} <span className="text-base font-bold text-slate-400">шт.</span>
                              </div>
                            </div>
                            
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">Продано:</span>
                                <span className="font-bold text-slate-900">{displaySold}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-slate-500">Возвраты:</span>
                                <span className="font-bold text-rose-500">{displayReturned}</span>
                              </div>
                              <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                                <span className="text-slate-500">Выручка:</span>
                                <span className="font-bold text-emerald-600" title={formatCurrency(displayRevenue)}>
                                  {formatCurrency(displayRevenue, true)}
                                </span>
                              </div>
                            </div>

                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${Math.min(100, Math.max(0, pctOfTotal))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Main breakdown section */}
                <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/60 overflow-hidden mt-8">
                  <div className="p-6 sm:p-8 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        Детализация операций
                      </h3>
                      <p className="text-sm text-slate-500 max-w-xl">
                        Подробная расшифровка всех поступлений и списаний. Переключайтесь между режимами просмотра для удобства.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      {/* Grouping toggles */}
                      <div className="flex items-center p-1 rounded-xl bg-slate-100/80">
                        <button
                          onClick={() => setGroupingMode("narrow")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            groupingMode === "narrow"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          )}
                        >
                          Группы
                        </button>
                        <button
                          onClick={() => setGroupingMode("hierarchical")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            groupingMode === "hierarchical"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          )}
                        >
                          Иерархия
                        </button>
                        <button
                          onClick={() => setGroupingMode("extended")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            groupingMode === "extended"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          )}
                        >
                          Все операции
                        </button>
                      </div>

                      {/* Filter controls */}
                      <div className="flex items-center p-1 rounded-xl bg-slate-100/80">
                        <button
                          onClick={() => setActiveFilter("all")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            activeFilter === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                          )}
                        >
                          Все
                        </button>
                        <button
                          onClick={() => setActiveFilter("inflow")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            activeFilter === "inflow" ? "bg-emerald-500 text-white shadow-sm" : "text-slate-500 hover:text-emerald-600"
                          )}
                        >
                          Приходы
                        </button>
                        <button
                          onClick={() => setActiveFilter("outflow")}
                          className={cn(
                            "px-4 py-2 text-sm font-bold rounded-lg transition-all",
                            activeFilter === "outflow" ? "bg-rose-500 text-white shadow-sm" : "text-slate-500 hover:text-rose-600"
                          )}
                        >
                          Списания
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-slate-50/50 text-slate-500 font-bold text-sm border-b border-slate-100">
                          <th className="px-8 py-5 w-2/5">Операция</th>
                          <th className="px-8 py-5 text-right w-1/5">Сумма</th>
                          <th className="px-8 py-5 w-2/5">Структура потока</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {groupingMode === "hierarchical" ? (
                          filteredHierarchical.length > 0 ? (
                            filteredHierarchical.map((groupItem) => (
                              <HierarchicalGroupSection
                                key={groupItem.group}
                                groupItem={groupItem}
                                totalInflow={result.totalInflow}
                                totalOutflow={result.totalOutflow}
                              />
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="px-8 py-16 text-center text-slate-400 text-base font-medium">
                                Нет данных для отображения
                              </td>
                            </tr>
                          )
                        ) : filteredBreakdown.length > 0 ? (
                          filteredBreakdown.map((item) => (
                            <BreakdownRow
                              key={`${item.group}::${item.type}`}
                              item={item}
                              totalInflow={result.totalInflow}
                              totalOutflow={result.totalOutflow}
                              groupingMode={groupingMode === "narrow" ? "narrow" : "extended"}
                            />
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="px-8 py-16 text-center text-slate-400 text-base font-medium">
                              Нет данных для отображения
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
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

function SummaryCard({
  title,
  value,
  icon,
  highlight = false,
  isPercent = false,
  subText,
  originalValue,
  isForecastActive = false,
  inverseDifference = false
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
  isPercent?: boolean;
  subText?: string;
  originalValue?: number;
  isForecastActive?: boolean;
  inverseDifference?: boolean;
}) {
  let diffElement = null;
  if (isForecastActive && originalValue !== undefined && Math.abs(originalValue - value) > 0.01) {
    const diff = value - originalValue;
    
    const isWorse = inverseDifference ? diff > 0 : diff < 0;
    const isBetter = inverseDifference ? diff < 0 : diff > 0;
    
    const diffColor = isWorse 
      ? "text-rose-600 bg-rose-50" 
      : isBetter 
        ? "text-emerald-600 bg-emerald-50" 
        : "text-slate-600 bg-slate-100";

    const formattedDiff = isPercent 
      ? `${diff > 0 ? "+" : ""}${diff.toFixed(2)}%`
      : `${diff > 0 ? "+" : ""}${formatCurrency(diff, true)}`;

    diffElement = (
      <span className={cn("text-xs font-bold px-2 py-1 rounded-lg truncate max-w-[120px]", diffColor)} title={isPercent ? formattedDiff : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`}>
        {formattedDiff}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "relative p-6 sm:p-8 rounded-3xl border bg-white flex flex-col justify-between min-h-[200px] transition-all duration-300 hover:-translate-y-1 hover:shadow-lg",
        highlight ? "border-blue-200/80 shadow-[0_8px_30px_rgb(59,130,246,0.1)] ring-1 ring-blue-500/10" : "border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
      )}
    >
      <div className="flex items-start justify-between">
        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider">{title}</h4>
        <div className="p-3 bg-slate-50 rounded-2xl shrink-0">
          {icon}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 min-w-0">
        <div 
          className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight truncate"
          title={isPercent ? `${value.toFixed(2)}%` : formatCurrency(value)}
        >
          {isPercent ? `${value.toFixed(2)}%` : formatCurrency(value, true)}
        </div>
        
        <div className="flex flex-col gap-1.5 min-h-[28px] justify-center">
          {diffElement && (
            <div className="flex items-center flex-wrap gap-2">
              {diffElement}
              {isForecastActive && (
                <span className="text-xs font-semibold text-slate-400 line-through truncate" title={isPercent ? `${originalValue?.toFixed(2)}%` : formatCurrency(originalValue || 0)}>
                  {isPercent ? `${originalValue?.toFixed(2)}%` : formatCurrency(originalValue || 0, true)}
                </span>
              )}
            </div>
          )}
          {subText && (
            <span className="text-sm font-semibold text-slate-400 truncate" title={subText}>
              {subText}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function HierarchicalGroupSection({
  groupItem,
  totalInflow,
  totalOutflow
}: {
  groupItem: any;
  totalInflow: number;
  totalOutflow: number;
}) {
  const isGroupInflow = groupItem.amount > 0;
  
  return (
    <>
      {/* Parent Group Row */}
      <tr className="bg-slate-50/30 font-bold border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td className="px-8 py-5">
          <div className="text-base font-extrabold text-slate-900 tracking-tight">
            {groupItem.group}
          </div>
        </td>
        <td className="px-8 py-5 text-right">
          <span className={cn("text-base font-extrabold tracking-tight", isGroupInflow ? "text-emerald-600" : "text-rose-600")}>
            {isGroupInflow ? "+" : ""}
            {formatCurrency(groupItem.amount)}
          </span>
        </td>
        <td className="px-8 py-5">
          <div className="flex flex-col gap-2 w-full justify-center">
            {isGroupInflow ? (
              <>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                  <span>{groupItem.pctOfInflow.toFixed(1)}% от прихода</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                     className="h-full bg-emerald-500 rounded-full"
                     style={{ width: `${Math.min(100, groupItem.pctOfInflow)}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                  <span>{groupItem.pctOfOutflow.toFixed(1)}% от списаний</span>
                  <span className="text-rose-500">{groupItem.pctOfTotalInflowForOutflow.toFixed(1)}% от выручки</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-rose-500 rounded-full"
                    style={{ width: `${Math.min(100, groupItem.pctOfOutflow)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Child Operations Rows */}
      {groupItem.children.map((child: any) => {
        const isChildInflow = child.amount > 0;
        return (
          <tr key={child.type} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100/50">
            <td className="px-8 py-4 pl-14 relative">
              <div className="absolute left-9 top-0 bottom-0 w-px bg-slate-200" />
              <div className="absolute left-9 top-1/2 w-4 h-px bg-slate-200" />
              <span className="text-sm font-semibold text-slate-600">
                {child.type}
              </span>
            </td>
            <td className="px-8 py-4 text-right">
              <span className={cn("text-sm font-bold", isChildInflow ? "text-emerald-600" : "text-rose-600")}>
                {isChildInflow ? "+" : ""}
                {formatCurrency(child.amount)}
              </span>
            </td>
            <td className="px-8 py-4">
              <div className="flex flex-col gap-1.5 w-full justify-center">
                {isChildInflow ? (
                  <>
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                      <span>{child.pctOfInflow.toFixed(1)}% от прихода</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded-full"
                        style={{ width: `${Math.min(100, child.pctOfInflow)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
                      <span>{child.pctOfOutflow.toFixed(1)}% от списаний</span>
                      <span className="text-rose-400">{child.pctOfTotalInflowForOutflow.toFixed(1)}% от выручки</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-400 rounded-full"
                        style={{ width: `${Math.min(100, child.pctOfOutflow)}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function BreakdownRow({
  item,
  totalInflow,
  totalOutflow,
  groupingMode
}: {
  item: AccrualsBreakdownItem;
  totalInflow: number;
  totalOutflow: number;
  groupingMode: "narrow" | "extended";
}) {
  const isInflow = item.amount > 0;
  
  return (
    <tr className="hover:bg-slate-50/50 transition-colors group">
      <td className="px-8 py-5">
        <div className="space-y-1">
          {groupingMode === "extended" ? (
            <>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {item.group}
              </span>
              <div className="text-base font-bold text-slate-900">
                {item.type}
              </div>
            </>
          ) : (
            <div className="text-base font-bold text-slate-900 tracking-tight">
              {item.group}
            </div>
          )}
        </div>
      </td>
      <td className="px-8 py-5 text-right">
        <span
          className={cn(
            "text-base font-extrabold tracking-tight",
            isInflow ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {isInflow ? "+" : ""}
          {formatCurrency(item.amount)}
        </span>
      </td>
      <td className="px-8 py-5">
        <div className="flex flex-col gap-2 w-full justify-center">
          {isInflow ? (
            <>
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>{item.pctOfInflow.toFixed(1)}% от прихода</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, item.pctOfInflow)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span>{item.pctOfOutflow.toFixed(1)}% от списаний</span>
                <span className="text-rose-500">{item.pctOfTotalInflowForOutflow.toFixed(1)}% от выручки</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, item.pctOfOutflow)}%` }}
                />
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

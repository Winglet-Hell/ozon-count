"use client";

import { useState, useCallback, useEffect } from "react";
import { Upload, Loader2, Coins, TrendingUp, TrendingDown, ReceiptText, ArrowRightLeft, FileSpreadsheet, Info, Percent, AlertTriangle, Check, FileDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { parseAccrualsReport, parseCogsCsv, parseCogsXlsx, type AccrualsSummary, type AccrualsBreakdownItem } from "@/lib/parseAccruals";
import { cn } from "@/lib/utils";

const formatCurrency = (val: number): string => {
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

export default function AccrualsPage() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<AccrualsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "inflow" | "outflow">("all");
  const [groupingMode, setGroupingMode] = useState<"narrow" | "extended" | "hierarchical">("extended");

  // Cost Database States
  const [skuCogs, setSkuCogs] = useState<Record<string, number>>({});
  const [cogsFileName, setCogsFileName] = useState<string | null>(null);
  const [isCogsLoading, setIsCogsLoading] = useState(false);
  const [cogsError, setCogsError] = useState<string | null>(null);

  // Auto-load default себестоимость file on mount (prefers XLSX template if available)
  useEffect(() => {
    const fetchDefaultCogs = async () => {
      try {
        // Try XLSX template first
        const xlsxRes = await fetch("/Шаблон для обновления цен_17.06.26 (1).xlsx");
        if (xlsxRes.ok) {
          const blob = await xlsxRes.blob();
          const file = new File([blob], "Шаблон для обновления цен_17.06.26 (1).xlsx");
          const parsed = await parseCogsXlsx(file);
          setSkuCogs(parsed);
          setCogsFileName("Шаблон для обновления цен_17.06.26 (1).xlsx (авто)");
          return;
        }

        // Fallback to CSV database
        const csvRes = await fetch("/Товары что мы продаем.csv");
        if (csvRes.ok) {
          const text = await csvRes.text();
          const parsed = parseCogsCsv(text);
          setSkuCogs(parsed);
          setCogsFileName("Товары что мы продаем.csv (авто)");
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
      setSkuCogs(parsed);
      setCogsFileName(file.name);
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

  // Get aggregated breakdown based on groupingMode
  const getAggregatedBreakdown = useCallback(() => {
    if (!result) return [];
    if (groupingMode === "extended") return result.breakdown;

    const map: Record<string, { group: string; type: string; amount: number }> = {};
    result.breakdown.forEach((item) => {
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
    const totalInflow = result.totalInflow;
    const totalOutflow = result.totalOutflow;

    return list.map((item) => {
      const pctOfInflow = item.amount > 0 ? (item.amount / totalInflow) * 100 : 0;
      const pctOfOutflow = item.amount < 0 ? (Math.abs(item.amount) / Math.abs(totalOutflow)) * 100 : 0;
      const pctOfTotalInflowForOutflow = item.amount < 0 ? (Math.abs(item.amount) / totalInflow) * 100 : 0;

      return {
        group: item.group,
        type: item.type,
        amount: item.amount,
        pctOfInflow,
        pctOfOutflow,
        pctOfTotalInflowForOutflow
      };
    });
  }, [result, groupingMode]);

  // Get hierarchical breakdown
  const getHierarchicalBreakdown = useCallback(() => {
    if (!result) return [];

    const map: Record<string, {
      group: string;
      amount: number;
      children: { type: string; amount: number }[];
    }> = {};

    result.breakdown.forEach((item) => {
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

    const totalInflow = result.totalInflow;
    const totalOutflow = result.totalOutflow;

    const list = Object.values(map);

    const resolvedList = list.map((item) => {
      const pctOfInflow = item.amount > 0 ? (item.amount / totalInflow) * 100 : 0;
      const pctOfOutflow = item.amount < 0 ? (Math.abs(item.amount) / Math.abs(totalOutflow)) * 100 : 0;
      const pctOfTotalInflowForOutflow = item.amount < 0 ? (Math.abs(item.amount) / totalInflow) * 100 : 0;

      const children = item.children
        .map((child) => {
          const cPctOfInflow = child.amount > 0 ? (child.amount / totalInflow) * 100 : 0;
          const cPctOfOutflow = child.amount < 0 ? (Math.abs(child.amount) / Math.abs(totalOutflow)) * 100 : 0;
          const cPctOfTotalInflowForOutflow = child.amount < 0 ? (Math.abs(child.amount) / totalInflow) * 100 : 0;

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
  }, [result]);

  // Filter hierarchical items based on activeFilter
  const filteredHierarchical = useCallback(() => {
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
  }, [getHierarchicalBreakdown, activeFilter])();

  // Filter flat breakdown items
  const filteredBreakdown = getAggregatedBreakdown().filter((item) => {
    if (activeFilter === "inflow") return item.amount > 0;
    if (activeFilter === "outflow") return item.amount < 0;
    return true;
  });

  // Calculate COGS and real economy metrics
  let totalProductionCogs = 0;
  const missingCogsSkus: Record<string, { qty: number }> = {};

  if (result && result.skuTransactions) {
    result.skuTransactions.forEach((tx) => {
      const isSale = tx.group === "Продажи" && tx.type === "Выручка";
      const isReturn = tx.group === "Возвраты" && tx.type === "Возврат выручки";

      if (isSale || isReturn) {
        const cogsRate = skuCogs[tx.sku] || 0;
        const qty = tx.quantity;

        if (cogsRate === 0) {
          if (!missingCogsSkus[tx.sku]) {
            missingCogsSkus[tx.sku] = { qty: 0 };
          }
          missingCogsSkus[tx.sku].qty += qty;
        }

        const rowCogs = qty * cogsRate;
        if (isSale) {
          totalProductionCogs += rowCogs;
        } else if (isReturn) {
          totalProductionCogs -= rowCogs;
        }
      }
    });
  }

  const taxableProfit = result ? result.netResult - totalProductionCogs : 0;
  const taxRate = 0.25; // Ставка налога на прибыль ОСНО на 2026 год составляет 25%
  const taxAmount = Math.max(0, taxableProfit * taxRate);
  const adjustedNetResult = taxableProfit - taxAmount;
  const adjustedMargin = result && result.totalInflow ? (adjustedNetResult / result.totalInflow) * 100 : 0;

  // Category breakdown calculations
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
        const category = getCategoryFromArticle(tx.sku);
        const qty = tx.quantity;
        const amt = tx.amount;

        if (isSale) {
          categoryData[category].sold += qty;
          categoryData[category].revenue += amt;
        } else if (isReturn) {
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

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!result}
        period={result?.period || undefined}
      />

      <div className="flex-1 flex flex-col p-6 w-full">
        <div className="w-full space-y-8 transition-all duration-300">
          
          {!result && (
            <div className="mt-20 max-w-xl mx-auto w-full">
              <div className="text-center space-y-4 mb-8">
                <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  Анализ начислений Ozon
                </h2>
                <p className="text-slate-600 max-w-md mx-auto">
                  Загрузите Excel-файл отчета начислений (например, <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">Отчет по начислениям_*.xlsx</code>), чтобы детально проанализировать все приходы и списания по операциям.
                </p>
              </div>

              <div className="bg-white rounded-2xl shadow-xl border border-slate-200/60 overflow-hidden p-6 space-y-6">
                {/* Excel Report File Dropzone */}
                <div
                  className={cn(
                    "p-8 border-2 border-dashed rounded-xl transition-all duration-300 ease-in-out cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[180px]",
                    isDragActive
                      ? "border-blue-500 bg-blue-50/50 scale-[0.99]"
                      : "border-slate-300 hover:border-slate-400 hover:bg-slate-50",
                    isProcessing && "opacity-50 pointer-events-none"
                  )}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => document.getElementById("xlsx-file-upload")?.click()}
                >
                  <input
                    id="xlsx-file-upload"
                    type="file"
                    className="hidden"
                    accept=".xlsx"
                    onChange={onFileInputChange}
                  />

                  <div className="p-3 bg-blue-50 rounded-full text-blue-600 ring-4 ring-blue-500/10">
                    {isProcessing ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-6 h-6" />
                    )}
                  </div>

                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {isProcessing ? "Обработка и расшифровка Excel..." : "Загрузите отчет по начислениям (.xlsx)"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Перетащите файл или нажмите для выбора
                    </p>
                  </div>
                </div>

                {/* CSV Cogs File Status Bar / Input */}
                <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className={cn(
                      "p-2.5 rounded-lg",
                      cogsFileName ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
                      isCogsLoading && "animate-pulse"
                    )}>
                      {isCogsLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : cogsFileName ? (
                        <Check className="w-5 h-5" />
                      ) : (
                        <Info className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">База себестоимости</h4>
                      <p className="text-xs text-slate-500 font-medium">
                        {cogsFileName 
                          ? `${cogsFileName} (${Object.keys(skuCogs).length} артикулов)`
                          : "Не загружена (себестоимость будет равна 0)"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button
                      onClick={() => document.getElementById("csv-file-upload")?.click()}
                      className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg shadow-sm hover:border-slate-300 transition-all flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Загрузить CSV / Excel
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
                  <div className="p-3 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl text-xs text-center">
                    {cogsError}
                  </div>
                )}
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-rose-50 text-rose-700 rounded-xl border border-rose-200/60 text-sm text-center flex items-center justify-center gap-2 max-w-xl mx-auto"
              >
                <span className="font-semibold">Ошибка:</span> {error}
              </motion.div>
            )}

            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* Active Cost Database Status Bar inside Results Dashboard */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2.5 rounded-xl",
                      cogsFileName ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
                      isCogsLoading && "animate-pulse"
                    )}>
                      {isCogsLoading ? (
                        <Loader2 className="w-5.5 h-5.5 animate-spin" />
                      ) : cogsFileName ? (
                        <Check className="w-5.5 h-5.5" />
                      ) : (
                        <Info className="w-5.5 h-5.5" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-800">
                        {cogsFileName ? "Активная база себестоимости" : "База себестоимости не загружена"}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {cogsFileName 
                          ? `Загружен файл: ${cogsFileName} (всего ${Object.keys(skuCogs).length} товаров)` 
                          : "Загрузите CSV или Excel файл для расчета реальной маржи с учетом себестоимости."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => document.getElementById("csv-file-upload-active")?.click()}
                      className="px-4 py-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                    >
                      <Upload className="w-4 h-4" />
                      Загрузить себестоимость (.csv, .xlsx)
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
                  </div>
                </div>

                {/* Missing SKU Warnings alert */}
                {Object.keys(missingCogsSkus).length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-5 bg-amber-50 border border-amber-200/80 rounded-2xl space-y-3 shadow-xs"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-extrabold text-amber-950">
                          Обнаружены артикулы с отсутствующей себестоимостью
                        </h4>
                        <p className="text-xs text-amber-800/85 font-medium">
                          В отчете Ozon найдены продажи/возвраты для {Object.keys(missingCogsSkus).length} артикулов, которые отсутствуют в базе себестоимости. Для расчетов их себестоимость принята равной 0. Добавьте их в ваш CSV-файл себестоимости.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/80 border border-amber-200/50 rounded-xl p-3.5 max-h-[160px] overflow-y-auto divide-y divide-slate-100/80 scrollbar-thin scrollbar-thumb-amber-200">
                      {Object.entries(missingCogsSkus).map(([sku, data]) => (
                        <div key={sku} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                            Артикул: {sku}
                          </span>
                          <span className="font-medium text-slate-500">
                            Количество в операциях: <strong className="text-slate-800">{data.qty} шт.</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Period Banner for small screens if not in header */}
                {result.period && (
                  <div className="lg:hidden p-3 bg-blue-50/50 rounded-xl border border-blue-100/60 text-center text-xs font-semibold text-blue-700">
                    {result.period}
                  </div>
                )}

                {/* Summary Metrics Section - Row 1 (Ozon Cash Flow) */}
                <div className="space-y-4">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest pl-1">
                    Финансовый поток Ozon
                  </h3>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <SummaryCard
                      title="Поступило денег (Приход)"
                      value={result.totalInflow}
                      description="Все зачисления по операциям продаж, скидок и программ партнёров"
                      icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
                      bgClassName="bg-emerald-50/40"
                      borderClassName="border-emerald-100/80"
                      textClassName="text-emerald-900"
                    />
                    <SummaryCard
                      title="Списано (Расход / Услуги)"
                      value={result.totalOutflow}
                      description="Комиссии Ozon, логистика, реклама, возвраты и штрафы"
                      icon={<TrendingDown className="w-6 h-6 text-rose-600" />}
                      bgClassName="bg-rose-50/40"
                      borderClassName="border-rose-100/80"
                      textClassName="text-rose-900"
                      subCaption={
                        <span className="text-rose-700/80 text-[10px] font-extrabold bg-rose-100/40 px-2 py-0.5 rounded-md">
                          {result.totalInflow ? (Math.abs(result.totalOutflow) / result.totalInflow * 100).toFixed(2) : "0.00"}% от прихода
                        </span>
                      }
                    />
                    <SummaryCard
                      title="Итоговый баланс (На выплату)"
                      value={result.netResult}
                      description="Чистая сумма к выплате за период после всех удержаний"
                      icon={<Coins className="w-6 h-6 text-blue-600" />}
                      bgClassName="bg-blue-50/40"
                      borderClassName="border-blue-100/80"
                      textClassName="text-blue-900"
                      highlight
                    />
                    <SummaryCard
                      title="Маржинальность Ozon"
                      value={result.totalInflow ? (result.netResult / result.totalInflow) * 100 : 0}
                      description="Доля чистой выплаты от общей суммы прихода"
                      icon={<Percent className="w-6 h-6 text-indigo-600" />}
                      bgClassName="bg-indigo-50/40"
                      borderClassName="border-indigo-100/80"
                      textClassName="text-indigo-900"
                      isPercent
                    />
                  </div>
                </div>

                {/* Summary Metrics Section - Row 2 (Real Economy) */}
                <div className="space-y-4">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest pl-1">
                    Реальная экономика (с себестоимостью и налогом)
                  </h3>
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <SummaryCard
                      title="Себестоимость производства"
                      value={totalProductionCogs}
                      description="Расчет по проданным товарам (Выручка) минус возвращенные (Возвраты)"
                      icon={<ReceiptText className="w-6 h-6 text-amber-600" />}
                      bgClassName="bg-amber-50/40"
                      borderClassName="border-amber-100/80"
                      textClassName="text-amber-900"
                      subCaption={
                        result?.totalInflow ? (
                          <span className="text-amber-700/80 text-[10px] font-extrabold bg-amber-100/40 px-2 py-0.5 rounded-md">
                            {(totalProductionCogs / result.totalInflow * 100).toFixed(2)}% от прихода
                          </span>
                        ) : undefined
                      }
                    />
                    <SummaryCard
                      title="Налог на прибыль (ОСНО 25%)"
                      value={taxAmount}
                      description="Рассчитан по ставке 25% на прибыль от продаж за вычетом себестоимости"
                      icon={<FileDown className="w-6 h-6 text-rose-600" />}
                      bgClassName="bg-rose-50/40"
                      borderClassName="border-rose-100/80"
                      textClassName="text-rose-900"
                      subCaption={
                        result && taxableProfit > 0 ? (
                          <span className="text-rose-700/80 text-[10px] font-extrabold bg-rose-100/40 px-2 py-0.5 rounded-md">
                            {(taxAmount / result.totalInflow * 100).toFixed(2)}% от прихода
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px] font-semibold bg-slate-100/80 px-2 py-0.5 rounded-md">
                            Нет прибыли для налога
                          </span>
                        )
                      }
                    />
                    <SummaryCard
                      title="Реальная чистая прибыль"
                      value={adjustedNetResult}
                      description="Итоговый чистый результат после вычета себестоимости, всех комиссий и налога 25%"
                      icon={<Coins className="w-6 h-6 text-violet-600" />}
                      bgClassName="bg-violet-50/40"
                      borderClassName="border-violet-100/80"
                      textClassName="text-violet-900"
                      highlight
                    />
                    <SummaryCard
                      title="Итоговая маржинальность"
                      value={adjustedMargin}
                      description="Отношение реальной чистой прибыли (после налогов) к общему приходу"
                      icon={<Percent className="w-6 h-6 text-fuchsia-600" />}
                      bgClassName="bg-fuchsia-50/40"
                      borderClassName="border-fuchsia-100/80"
                      textClassName="text-fuchsia-900"
                      isPercent
                    />
                  </div>
                </div>

                {/* Product Categories Breakdown */}
                {activeCategories.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 space-y-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <ReceiptText className="w-5 h-5 text-slate-600" />
                        Анализ продаж по категориям товаров
                      </h3>
                      <p className="text-xs text-slate-500">
                        Объемы продаж, возвратов и чистой реализации в штуках по типам товаров
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      {activeCategories.map((cat) => {
                        const pctOfTotal = totalNetItems > 0 ? (cat.net / totalNetItems) * 100 : 0;
                        return (
                          <div key={cat.name} className="border border-slate-100 rounded-xl p-4 bg-slate-50/30 flex flex-col justify-between space-y-3">
                            <div>
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                                {cat.name}
                              </span>
                              <div className="text-2xl font-extrabold text-slate-800 mt-1">
                                {cat.net} шт.
                              </div>
                            </div>
                            
                            <div className="space-y-1.5 text-xs text-slate-600 font-medium">
                              <div className="flex justify-between text-[11px]">
                                <span>Продано:</span>
                                <span className="font-semibold text-slate-800">{cat.sold} шт.</span>
                              </div>
                              <div className="flex justify-between text-[11px]">
                                <span>Возвраты:</span>
                                <span className="font-semibold text-rose-600">{cat.returned} шт.</span>
                              </div>
                              <div className="flex justify-between text-[11px] border-t border-slate-100 pt-1">
                                <span>Выручка:</span>
                                <span className="font-semibold text-emerald-700">{formatCurrency(cat.revenue)}</span>
                              </div>
                            </div>

                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
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
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <ArrowRightLeft className="w-5 h-5 text-slate-600" />
                        Детализация по операциям
                      </h3>
                      <p className="text-xs text-slate-500">
                        {groupingMode === "extended" 
                          ? "Группировка по услугам Ozon и типам начислений" 
                          : "Суженная группировка по основным категориям услуг"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {/* Grouping toggles */}
                      <div className="flex items-center p-0.5 rounded-full bg-slate-100/85 border border-slate-200/50 self-start">
                        <button
                          onClick={() => setGroupingMode("narrow")}
                          className={cn(
                            "px-3 py-1.5 text-[11px] font-bold rounded-full transition-all",
                            groupingMode === "narrow"
                              ? "bg-white text-blue-600 shadow-sm"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                          title="Агрегировать суммы только по категориям"
                        >
                          По группам
                        </button>
                        <button
                          onClick={() => setGroupingMode("hierarchical")}
                          className={cn(
                            "px-3 py-1.5 text-[11px] font-bold rounded-full transition-all",
                            groupingMode === "hierarchical"
                              ? "bg-white text-blue-600 shadow-sm"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                          title="Древовидная структура с вложенными под-операциями"
                        >
                          Иерархия
                        </button>
                        <button
                          onClick={() => setGroupingMode("extended")}
                          className={cn(
                            "px-3 py-1.5 text-[11px] font-bold rounded-full transition-all",
                            groupingMode === "extended"
                              ? "bg-white text-blue-600 shadow-sm"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                          title="Плоский список всех операций по убыванию сумм"
                        >
                          Детально
                        </button>
                      </div>

                      {/* Filter controls */}
                      <div className="flex items-center p-0.5 rounded-full bg-slate-100/85 border border-slate-200/50 self-start">
                        <button
                          onClick={() => setActiveFilter("all")}
                          className={cn(
                            "px-4 py-1.5 text-xs font-semibold rounded-full transition-all",
                            activeFilter === "all"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-600 hover:text-slate-900"
                          )}
                        >
                          Все операции
                        </button>
                        <button
                          onClick={() => setActiveFilter("inflow")}
                          className={cn(
                            "px-4 py-1.5 text-xs font-semibold rounded-full transition-all",
                            activeFilter === "inflow"
                              ? "bg-white text-emerald-700 shadow-sm"
                              : "text-slate-600 hover:text-emerald-600"
                          )}
                        >
                          Приходы
                        </button>
                        <button
                          onClick={() => setActiveFilter("outflow")}
                          className={cn(
                            "px-4 py-1.5 text-xs font-semibold rounded-full transition-all",
                            activeFilter === "outflow"
                              ? "bg-white text-rose-700 shadow-sm"
                              : "text-slate-600 hover:text-rose-600"
                          )}
                        >
                          Списания
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[650px]">
                      <thead>
                        <tr className="bg-slate-50/70 text-slate-500 font-semibold text-xs border-b border-slate-100">
                          <th className="px-6 py-3.5 w-1/3">Операция / Группа</th>
                          <th className="px-6 py-3.5 text-right w-[150px]">Сумма</th>
                          <th className="px-6 py-3.5 w-[300px]">Доля во входящем/исходящем потоке</th>
                        </tr>
                      </thead>
                      <tbody>
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
                              <td colSpan={3} className="px-6 py-12 text-center text-slate-400 text-sm">
                                Нет подходящих операций для отображения
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
                            <td colSpan={3} className="px-6 py-12 text-center text-slate-400 text-sm">
                              Нет подходящих операций для отображения
                            </td>
                          </tr>
                        )}
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

function SummaryCard({
  title,
  value,
  description,
  icon,
  bgClassName,
  borderClassName,
  textClassName,
  highlight = false,
  isPercent = false,
  subCaption
}: {
  title: string;
  value: number;
  description: string;
  icon: React.ReactNode;
  bgClassName: string;
  borderClassName: string;
  textClassName: string;
  highlight?: boolean;
  isPercent?: boolean;
  subCaption?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative p-6 rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col justify-between min-h-[160px] group transition-all duration-300 hover:shadow-md",
        borderClassName,
        highlight && "ring-2 ring-blue-500/10 ring-offset-1"
      )}
    >
      <div className={cn("absolute inset-0 opacity-40 transition-opacity group-hover:opacity-60", bgClassName)} />
      
      <div className="relative z-10 flex items-start justify-between">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </span>
          <p className="text-xs text-slate-500 font-medium max-w-[200px]">
            {description}
          </p>
        </div>
        <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-100">
          {icon}
        </div>
      </div>

      <div className="relative z-10 mt-4 flex flex-col justify-end">
        <span className={cn("text-2xl md:text-3xl font-extrabold tracking-tight block leading-none", textClassName)}>
          {isPercent ? `${value.toFixed(2)}%` : formatCurrency(value)}
        </span>
        <div className="h-5 mt-2 flex items-center">
          {subCaption ? (
            subCaption
          ) : (
            <span className="text-xs text-transparent select-none">-</span>
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
      <tr className="bg-slate-50/50 font-bold border-b border-slate-100 hover:bg-slate-100/40 transition-colors">
        <td className="px-6 py-4">
          <div className="text-sm font-extrabold text-slate-900 uppercase tracking-wider">
            {groupItem.group}
          </div>
        </td>
        <td className="px-6 py-4 text-right">
          <span className={cn("text-sm font-extrabold tracking-tight", isGroupInflow ? "text-emerald-700" : "text-rose-700")}>
            {isGroupInflow ? "+" : ""}
            {formatCurrency(groupItem.amount)}
          </span>
        </td>
        <td className="px-6 py-4">
          <div className="flex flex-col gap-1.5 w-full justify-center">
            {isGroupInflow ? (
              <>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                  <span>{groupItem.pctOfInflow.toFixed(2)}% от прихода</span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                     className="h-full bg-emerald-600 rounded-full"
                     style={{ width: `${Math.min(100, groupItem.pctOfInflow)}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-700 leading-none">
                  <span>{groupItem.pctOfOutflow.toFixed(2)}% от списаний</span>
                  <span className="text-rose-600">{groupItem.pctOfTotalInflowForOutflow.toFixed(2)}% от выручки</span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
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
          <tr key={child.type} className="hover:bg-slate-50/20 transition-colors border-b border-slate-100/50">
            <td className="px-6 py-3 pl-12 relative">
              <div className="absolute left-7 top-0 bottom-0 w-px bg-slate-200" />
              <div className="absolute left-7 top-1/2 w-3.5 h-px bg-slate-200" />
              <span className="text-xs font-semibold text-slate-600 pl-2">
                {child.type}
              </span>
            </td>
            <td className="px-6 py-3 text-right">
              <span className={cn("text-xs font-bold", isChildInflow ? "text-emerald-600" : "text-rose-600")}>
                {isChildInflow ? "+" : ""}
                {formatCurrency(child.amount)}
              </span>
            </td>
            <td className="px-6 py-3">
              <div className="flex flex-col gap-1 w-full justify-center">
                {isChildInflow ? (
                  <>
                    <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
                      <span>{child.pctOfInflow.toFixed(2)}% от прихода</span>
                    </div>
                    <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-400 rounded-full"
                        style={{ width: `${Math.min(100, child.pctOfInflow)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[9px] font-medium text-slate-500 leading-none">
                      <span>{child.pctOfOutflow.toFixed(2)}% от списаний</span>
                      <span className="text-rose-500/80">{child.pctOfTotalInflowForOutflow.toFixed(2)}% от выручки</span>
                    </div>
                    <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
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
      <td className="px-6 py-4">
        <div className="space-y-0.5">
          {groupingMode === "extended" ? (
            <>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {item.group}
              </span>
              <div className="text-sm font-semibold text-slate-800 group-hover:text-slate-900 transition-colors">
                {item.type}
              </div>
            </>
          ) : (
            <div className="text-sm font-bold text-slate-800 group-hover:text-slate-900 transition-colors uppercase tracking-wider">
              {item.group}
            </div>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-right">
        <span
          className={cn(
            "text-sm font-bold tracking-tight",
            isInflow ? "text-emerald-600" : "text-rose-600"
          )}
        >
          {isInflow ? "+" : ""}
          {formatCurrency(item.amount)}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-col gap-1.5 w-full justify-center">
          {isInflow ? (
            <>
              {/* Progress bar for inflow */}
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>{item.pctOfInflow.toFixed(2)}% от прихода</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, item.pctOfInflow)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              {/* Progress metrics and dual bar for outflow */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600 leading-none">
                  <span>{item.pctOfOutflow.toFixed(2)}% от списаний</span>
                  <span className="text-rose-600">{item.pctOfTotalInflowForOutflow.toFixed(2)}% от выручки</span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                  {/* Total outflow percentage bar */}
                  <div
                    className="h-full bg-rose-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, item.pctOfOutflow)}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}


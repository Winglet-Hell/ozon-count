"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, FileSpreadsheet, Calculator, Loader2, Coins, Info, ShoppingCart, Truck, RotateCcw, CreditCard, Trash2, Megaphone, Package, Percent, TrendingUp, Pencil, Check, X, RotateCcw as ResetIcon, LayoutGrid, Table as TableIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { parseReport, type AnalysisResult } from "@/lib/parse";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatCompactCurrency, formatCompactNumber } from "@/lib/utils";
import { ArticlesTable } from "@/components/ArticlesTable";
import { Header } from "@/components/Header";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency
const formatCurrency = formatCompactCurrency;

// Format number
const formatNumber = formatCompactNumber;

export default function Home() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"dashboard" | "articles">("dashboard");

  const updateOverride = (key: string, value: number | undefined) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const getValue = (key: string, baseValue: number) => {
    return overrides[key] !== undefined ? overrides[key] : baseValue;
  };

  const handleFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      if (!file.name.endsWith(".csv")) {
        throw new Error("Please upload a CSV file with the Ozon report.");
      }

      const data = await parseReport(file);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An error occurred while processing the file");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    const loadDefaultReport = async () => {
      try {
        const response = await fetch("/default_report.csv");
        if (!response.ok) {
          console.warn("Default report not found");
          return;
        }
        const blob = await response.blob();
        const file = new File([blob], "default_report.csv", { type: "text/csv" });
        await handleFile(file);
      } catch (error) {
        console.error("Failed to load default report:", error);
      }
    };

    loadDefaultReport();
  }, [handleFile]);

  const handleReset = () => {
    setResult(null);
    setOverrides({});
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

  const baseRevenue = result?.revenue ?? 0;
  const revenue = getValue("revenue", baseRevenue);

  const baseDiscountPoints = result?.discountPoints ?? 0;
  const discountPoints = getValue("discountPoints", baseDiscountPoints);

  const basePartnerPrograms = result?.partnerPrograms ?? 0;
  const partnerPrograms = getValue("partnerPrograms", basePartnerPrograms);

  const calcTotalSalesRevenue = revenue + discountPoints + partnerPrograms;
  const totalSalesRevenue = getValue("totalSalesRevenue", calcTotalSalesRevenue);


  const calcCrossDockingCost = -(totalSalesRevenue * 0.015);
  const crossDockingCost = getValue("crossDockingCost", calcCrossDockingCost);

  const baseMarketplaceCommission = result?.marketplaceCommission ?? 0;
  const marketplaceCommission = getValue("marketplaceCommission", baseMarketplaceCommission);

  const baseLogisticsCost = result?.logisticsCost ?? 0;
  const logisticsCost = getValue("logisticsCost", baseLogisticsCost);

  const baseAcquiringCost = result?.acquiringCost ?? 0;
  const acquiringCost = getValue("acquiringCost", baseAcquiringCost);

  const baseReturnsCost = result?.returnsCost ?? 0;
  const returnsCost = getValue("returnsCost", baseReturnsCost);

  const basePromotionCost = result?.promotionCost ?? 0;
  // Add Subscription Cost (24990) to Promotion Cost
  const calcPromotionCost = basePromotionCost - 24990;
  const promotionCost = getValue("promotionCost", calcPromotionCost);

  const baseAdditionalServicesCost = result?.additionalServicesCost ?? 0;
  const additionalServicesCost = getValue("additionalServicesCost", baseAdditionalServicesCost);

  const baseTotalCogs = result?.totalCogs ?? 0;
  const totalCogs = getValue("totalCogs", baseTotalCogs);



  const calcPreTaxCosts =
    marketplaceCommission +
    logisticsCost +
    acquiringCost +
    returnsCost +
    promotionCost +
    additionalServicesCost +
    crossDockingCost +
    totalCogs;

  const preTaxCosts = getValue("preTaxCosts", calcPreTaxCosts);

  // Profit before tax
  const preTaxProfit = totalSalesRevenue + preTaxCosts;

  // Income Tax (25% of positive profit)
  const calcIncomeTax = preTaxProfit > 0 ? -(preTaxProfit * 0.25) : 0;
  const incomeTax = getValue("incomeTax", calcIncomeTax);

  const calcTotalCosts = preTaxCosts + incomeTax;
  const totalCosts = getValue("totalCosts", calcTotalCosts);

  // New metric: Total Costs excluding COGS (Operating Expenses)
  // Since both totalCosts and totalCogs are negative, we subtract cogs from total to get the difference
  // Example: Total (-1000) - COGS (-200) = Output (-800)
  const operatingExpenses = totalCosts - totalCogs;

  // Statistics
  const baseOrderedItems = result?.orderedItems ?? 0;
  const orderedItems = getValue("orderedItems", baseOrderedItems);

  const baseDeliveredItems = result?.deliveredItems ?? 0;
  const deliveredItems = getValue("deliveredItems", baseDeliveredItems);

  const baseReturnedItems = result?.returnedItems ?? 0;
  const returnedItems = getValue("returnedItems", baseReturnedItems);

  const profit = totalSalesRevenue + totalCosts;

  const calcRealMargin = totalSalesRevenue ? (profit / totalSalesRevenue) * 100 : 0;
  const realMargin = getValue("realMargin", calcRealMargin);

  const calcPayoutToFactory = totalSalesRevenue + (preTaxCosts - totalCogs);
  const payoutToFactory = getValue("payoutToFactory", calcPayoutToFactory);

  // Calculate max values for intensity scaling - REMOVED per user request for unique colors
  // const incomeItems = [revenue, discountPoints, partnerPrograms];
  // const maxIncome = Math.max(...incomeItems);

  // const costItems = [ ... ];
  // const maxCost = Math.max(...costItems);

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!result}
        period={result?.period}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 flex flex-col items-center p-4">
        <div className={cn(
          "w-full space-y-8 transition-all duration-300",
          activeTab === "articles" ? "max-w-[95vw]" : "max-w-5xl"
        )}>
          {!result && (
            <div className="mt-20 max-w-xl mx-auto w-full">
              <div className="text-center space-y-4 mb-8">
                <h2 className="text-2xl font-bold text-slate-900">
                  Upload Report
                </h2>
                <p className="text-slate-600">
                  Drag and drop your Ozon unit economics CSV report here to start analyzing
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div
                  className={cn(
                    "p-12 border-2 border-dashed rounded-xl m-4 transition-colors duration-200 ease-in-out cursor-pointer flex flex-col items-center justify-center gap-4",
                    isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50",
                    isProcessing && "opacity-50 pointer-events-none"
                  )}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onClick={() => document.getElementById("file-upload")?.click()}
                >
                  <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    accept=".csv"
                    onChange={onFileInputChange}
                  />

                  <div className="p-4 bg-blue-100 rounded-full text-blue-600">
                    {isProcessing ? (
                      <Loader2 className="w-8 h-8 animate-spin" />
                    ) : (
                      <Upload className="w-8 h-8" />
                    )}
                  </div>

                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-slate-900">
                      {isProcessing ? "Processing..." : "Click to upload or drag and drop file"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Supported formats: CSV
                    </p>
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
                className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200 text-sm text-center"
              >
                {error}
              </motion.div>
            )}

            {result && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Tabs moved to Header */}

                {activeTab === "dashboard" ? (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Statistics Section */}
                    <div className="space-y-4">
                      <h2 className="text-xl font-semibold text-slate-800">Statistics</h2>
                      <div className="grid gap-4 md:grid-cols-3">
                        <StatsCard
                          title="Ordered Items"
                          value={orderedItems}
                          description="Sum of 'Ordered Items' column from report"
                          bgClassName="bg-sky-50"
                          titleClassName="text-sky-900"
                          className="border-sky-100"
                          icon={<ShoppingCart className="w-4 h-4 text-sky-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("orderedItems", val)}
                          isOverridden={overrides["orderedItems"] !== undefined}
                        />
                        <StatsCard
                          title="Delivered Items"
                          value={deliveredItems}
                          description="Sum of 'Delivered Items' column from report"
                          bgClassName="bg-violet-50"
                          titleClassName="text-violet-900"
                          className="border-violet-100"
                          icon={<Truck className="w-4 h-4 text-violet-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("deliveredItems", val)}
                          isOverridden={overrides["deliveredItems"] !== undefined}
                        />
                        <StatsCard
                          title="Returned Items"
                          value={returnedItems}
                          description="Sum of 'Returned Items' column from report"
                          bgClassName="bg-rose-50"
                          titleClassName="text-rose-900"
                          className="border-rose-100"
                          icon={<RotateCcw className="w-4 h-4 text-rose-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("returnedItems", val)}
                          isOverridden={overrides["returnedItems"] !== undefined}
                        />
                      </div>
                    </div>

                    {/* Financial Result Section */}
                    <div className="space-y-4 pt-4 border-t border-slate-200">

                      <h2 className="text-xl font-semibold text-slate-800">Financial Result (₽)</h2>
                      <div className="grid gap-4 md:grid-cols-3">
                        <StatsCard
                          title="Profit"
                          value={profit}
                          description="Net Profit = Total Sales Revenue + Total Costs"
                          bgClassName="bg-emerald-100"
                          titleClassName="text-emerald-900"
                          className="border-emerald-200 shadow-sm hover:shadow-md transition-shadow"
                          icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
                          onOverride={(val) => updateOverride("profit", val)}
                          isOverridden={overrides["profit"] !== undefined}
                        />
                        <StatsCard
                          title="Real Margin"
                          value={realMargin}
                          description="Real Margin = (Profit / Total Sales Revenue) * 100"
                          bgClassName="bg-indigo-100"
                          titleClassName="text-indigo-900"
                          className="border-indigo-200 shadow-sm hover:shadow-md transition-shadow"
                          icon={<Percent className="w-6 h-6 text-indigo-600" />}
                          formatter={(val) => `${val.toFixed(2)}%`}
                          onOverride={(val) => updateOverride("realMargin", val)}
                          isOverridden={overrides["realMargin"] !== undefined}
                        />
                        <StatsCard
                          title="Transfer to Factory"
                          value={payoutToFactory}
                          description="Total Sales Revenue + (Pre-Tax Costs - Cost of Goods Sold)"
                          bgClassName="bg-slate-100"
                          titleClassName="text-slate-900"
                          className="border-slate-200 shadow-sm hover:shadow-md transition-shadow"
                          icon={<Coins className="w-6 h-6 text-slate-600" />}
                          onOverride={(val) => updateOverride("payoutToFactory", val)}
                          isOverridden={overrides["payoutToFactory"] !== undefined}
                        />
                      </div>
                    </div>

                    {/* Main Financials Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Left Column: Income (Plus) */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 pb-2 border-b border-emerald-200">
                          <div className="p-2 bg-emerald-100 rounded-lg">
                            <TrendingUp className="w-5 h-5 text-emerald-700" />
                          </div>
                          <div>
                            <h2 className="text-xl font-bold text-slate-800">Income</h2>
                            <p className="text-sm text-slate-500">Money coming in (Plus)</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {/* Total Sales Revenue (Main Metric) */}
                          <div className="p-1 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 shadow-sm">
                            <StatsCard
                              title="Total Sales Revenue"
                              value={totalSalesRevenue}
                              description="Sum of redeemed goods, discount points and partner programs"
                              bgClassName="bg-emerald-50"
                              titleClassName="text-emerald-900"
                              className="border-emerald-200"
                              icon={<Coins className="w-6 h-6 text-emerald-600" />}
                              onOverride={(val) => updateOverride("totalSalesRevenue", val)}
                              isOverridden={overrides["totalSalesRevenue"] !== undefined}
                            />
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <StatsCard
                              title="Revenue"
                              value={revenue}
                              percentage={totalSalesRevenue ? (revenue / totalSalesRevenue) * 100 : 0}
                              description="Direct revenue from sales"
                              bgClassName="bg-emerald-100"
                              titleClassName="text-emerald-900"
                              className="border-emerald-200"
                              icon={<Calculator className="w-4 h-4 text-emerald-600" />}
                              onOverride={(val) => updateOverride("revenue", val)}
                              isOverridden={overrides["revenue"] !== undefined}
                            />
                            <StatsCard
                              title="Discount Points"
                              value={discountPoints}
                              percentage={totalSalesRevenue ? (discountPoints / totalSalesRevenue) * 100 : 0}
                              description="Ozon points compensation"
                              bgClassName="bg-teal-100"
                              titleClassName="text-teal-900"
                              className="border-teal-200"
                              icon={<FileSpreadsheet className="w-4 h-4 text-teal-600" />}
                              onOverride={(val) => updateOverride("discountPoints", val)}
                              isOverridden={overrides["discountPoints"] !== undefined}
                            />
                            <StatsCard
                              title="Partner Programs"
                              value={partnerPrograms}
                              percentage={totalSalesRevenue ? (partnerPrograms / totalSalesRevenue) * 100 : 0}
                              description="Revenue from partner programs"
                              bgClassName="bg-cyan-100"
                              titleClassName="text-cyan-900"
                              className="border-cyan-200 sm:col-span-2"
                              icon={<Calculator className="w-4 h-4 text-cyan-600" />}
                              onOverride={(val) => updateOverride("partnerPrograms", val)}
                              isOverridden={overrides["partnerPrograms"] !== undefined}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Costs (Minus) */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 pb-2 border-b border-rose-200">
                          <div className="p-2 bg-rose-100 rounded-lg">
                            <TrendingUp className="w-5 h-5 text-rose-700 rotate-180" />
                          </div>
                          <div>
                            <h2 className="text-xl font-bold text-slate-800">Costs</h2>
                            <p className="text-sm text-slate-500">Money going out (Minus)</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {/* Total Costs (Main Metric) */}
                          <div className="p-1 rounded-2xl bg-gradient-to-br from-rose-50 to-orange-50 border border-rose-100 shadow-sm">
                            <StatsCard
                              title="Total Costs"
                              value={totalCosts}
                              description="Sum of all expenses including taxes"
                              bgClassName="bg-rose-50"
                              titleClassName="text-rose-900"
                              className="border-rose-200"
                              icon={<CreditCard className="w-6 h-6 text-rose-600" />}
                              subCaption={
                                <span className="text-rose-600/70 text-sm font-medium">
                                  Excl. COGS: {formatCurrency(operatingExpenses)}
                                </span>
                              }
                              onOverride={(val) => updateOverride("totalCosts", val)}
                              isOverridden={overrides["totalCosts"] !== undefined}
                              isExpense
                            />
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <StatsCard
                              title="COGS"
                              value={totalCogs}
                              percentage={totalCosts ? (totalCogs / totalCosts) * 100 : 0}
                              description="Cost of Goods Sold"
                              bgClassName="bg-blue-100"
                              titleClassName="text-blue-900"
                              className="border-blue-200"
                              icon={<Package className="w-4 h-4 text-blue-600" />}
                              onOverride={(val) => updateOverride("totalCogs", val)}
                              isOverridden={overrides["totalCogs"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Commission"
                              value={marketplaceCommission}
                              percentage={totalCosts ? (marketplaceCommission / totalCosts) * 100 : 0}
                              description="Marketplace Commission"
                              bgClassName="bg-rose-100"
                              titleClassName="text-rose-900"
                              className="border-rose-200"
                              icon={<Coins className="w-4 h-4 text-rose-600" />}
                              onOverride={(val) => updateOverride("marketplaceCommission", val)}
                              isOverridden={overrides["marketplaceCommission"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Logistics"
                              value={logisticsCost}
                              percentage={totalCosts ? (logisticsCost / totalCosts) * 100 : 0}
                              description="Logistics & Delivery"
                              bgClassName="bg-violet-100"
                              titleClassName="text-violet-900"
                              className="border-violet-200"
                              icon={<Truck className="w-4 h-4 text-violet-600" />}
                              onOverride={(val) => updateOverride("logisticsCost", val)}
                              isOverridden={overrides["logisticsCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Acquiring"
                              value={acquiringCost}
                              percentage={totalCosts ? (acquiringCost / totalCosts) * 100 : 0}
                              description="Payment Processing"
                              bgClassName="bg-amber-100"
                              titleClassName="text-amber-900"
                              className="border-amber-200"
                              icon={<CreditCard className="w-4 h-4 text-amber-600" />}
                              onOverride={(val) => updateOverride("acquiringCost", val)}
                              isOverridden={overrides["acquiringCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Returns"
                              value={returnsCost}
                              percentage={totalCosts ? (returnsCost / totalCosts) * 100 : 0}
                              description="Return Processing & Logistics"
                              bgClassName="bg-fuchsia-100"
                              titleClassName="text-fuchsia-900"
                              className="border-fuchsia-200"
                              icon={<RotateCcw className="w-4 h-4 text-fuchsia-600" />}
                              onOverride={(val) => updateOverride("returnsCost", val)}
                              isOverridden={overrides["returnsCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Services"
                              value={additionalServicesCost}
                              percentage={totalCosts ? (additionalServicesCost / totalCosts) * 100 : 0}
                              description="Additional Marketplace Services"
                              bgClassName="bg-slate-100"
                              titleClassName="text-slate-900"
                              className="border-slate-200"
                              icon={<Trash2 className="w-4 h-4 text-slate-600" />}
                              onOverride={(val) => updateOverride("additionalServicesCost", val)}
                              isOverridden={overrides["additionalServicesCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Cross Docking"
                              value={crossDockingCost}
                              percentage={totalCosts ? (crossDockingCost / totalCosts) * 100 : 0}
                              description="1.5% of Total Sales"
                              bgClassName="bg-lime-100"
                              titleClassName="text-lime-900"
                              className="border-lime-200"
                              icon={<Package className="w-4 h-4 text-lime-600" />}
                              onOverride={(val) => updateOverride("crossDockingCost", val)}
                              isOverridden={overrides["crossDockingCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Ads"
                              value={promotionCost}
                              percentage={totalCosts ? (promotionCost / totalCosts) * 100 : 0}
                              description="Promotion & Marketing"
                              bgClassName="bg-indigo-100"
                              titleClassName="text-indigo-900"
                              className="border-indigo-200"
                              icon={<Megaphone className="w-4 h-4 text-indigo-600" />}
                              onOverride={(val) => updateOverride("promotionCost", val)}
                              isOverridden={overrides["promotionCost"] !== undefined}
                              isExpense
                            />
                            <StatsCard
                              title="Tax"
                              value={incomeTax}
                              percentage={totalCosts ? (incomeTax / totalCosts) * 100 : 0}
                              description="Income Tax (25%)"
                              bgClassName="bg-red-100"
                              titleClassName="text-red-900"
                              className="border-red-200 sm:col-span-2"
                              icon={<Coins className="w-4 h-4 text-red-600" />}
                              onOverride={(val) => updateOverride("incomeTax", val)}
                              isOverridden={overrides["incomeTax"] !== undefined}
                              isExpense
                            />
                          </div>
                        </div>
                      </div>
                    </div>




                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <ArticlesTable articles={result?.articles || []} />
                  </div>
                )}
              </motion.div>
            )
            }
          </AnimatePresence >



        </div>
      </div>
    </main >
  );
}

function StatsCard({
  id,
  title,
  value,
  percentage,
  description,
  className,
  bgClassName,
  titleClassName,
  icon,
  formatter = formatCurrency,
  subCaption,
  onOverride,
  isOverridden,
  isExpense = false,
  intensity,
}: {
  id?: string;
  title: string;
  value: number;
  percentage?: number;
  description: string;
  className?: string;
  bgClassName?: string;
  titleClassName?: string;
  icon?: React.ReactNode;
  isDestructive?: boolean;
  formatter?: (val: number) => string;
  subCaption?: React.ReactNode;
  onOverride?: (val: number | undefined) => void;
  isOverridden?: boolean;
  isExpense?: boolean;
  intensity?: number;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const handleEditClick = () => {
    setEditValue(Math.abs(value).toFixed(2));
    setIsEditing(true);
  };

  const handleSave = () => {
    const num = parseFloat(editValue);
    if (!isNaN(num) && onOverride) {
      const finalValue = isExpense ? -Math.abs(num) : Math.abs(num);
      onOverride(finalValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleReset = () => {
    if (onOverride) {
      onOverride(undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <div className={cn("relative p-6 rounded-xl border shadow-sm group overflow-hidden bg-white h-full", className, isOverridden && "ring-2 ring-yellow-400 ring-offset-2")}>
      {/* Dynamic Background Layer */}
      <div
        className={cn("absolute inset-0 transition-opacity duration-500 z-0", bgClassName)}
        style={{ opacity: intensity !== undefined ? 0.3 + (intensity * 0.7) : 1 }}
      />

      {/* Content Container */}
      <div className="relative z-10 flex flex-col gap-2 h-full justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 relative">
              <h3 className={cn("text-sm font-medium opacity-80", titleClassName)}>{title}</h3>
              <button
                onClick={() => setShowInfo(!showInfo)}
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-all shrink-0 cursor-pointer",
                  showInfo ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                aria-label="Show info"
              >
                <Info className={cn("w-3.5 h-3.5 opacity-60", titleClassName)} />
              </button>

              {onOverride && !isEditing && (
                <div className="absolute left-full ml-1 flex items-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                  <button
                    onClick={handleEditClick}
                    className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-colors cursor-pointer"
                    title="Edit value"
                  >
                    <Pencil className={cn("w-3.5 h-3.5 opacity-60", titleClassName)} />
                  </button>
                  {isOverridden && (
                    <button
                      onClick={handleReset}
                      className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-colors ml-1 cursor-pointer"
                      title="Reset to calculated value"
                    >
                      <ResetIcon className={cn("w-3.5 h-3.5 opacity-60", titleClassName)} />
                    </button>
                  )}
                </div>
              )}

            </div>
            {icon}
          </div>

          <div className="flex items-baseline gap-2">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-md font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                  autoFocus
                />
                <button onClick={handleSave} className="p-1 hover:bg-green-100 text-green-600 rounded">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={handleCancel} className="p-1 hover:bg-red-100 text-red-600 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className={cn("text-xl md:text-2xl font-bold break-words", titleClassName)}>
                {formatter(value)}
              </div>
            )}

            {percentage !== undefined && !isEditing && (
              <div className={cn("text-xs font-medium opacity-60", titleClassName)}>
                {percentage.toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        {subCaption && (
          <div className="mt-1">
            {subCaption}
          </div>
        )}

        {isOverridden && !isEditing && (
          <div className="text-[10px] text-yellow-600 font-medium uppercase tracking-wider mt-auto pt-2">
            Manually Set
          </div>
        )}
      </div>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute left-0 right-0 top-full mt-2 mx-4 p-3 rounded-lg bg-slate-800 text-white text-xs shadow-xl z-50 pointer-events-none"
          >
            <div className="absolute -top-1 left-8 w-2 h-2 bg-slate-800 rotate-45 transform" />
            {description}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

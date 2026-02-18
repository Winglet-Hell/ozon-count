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

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <Header
        onUploadClick={handleReset}
        showUploadButton={!!result}
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
                {/* Tabs */}
                <div className="flex space-x-1 rounded-xl bg-slate-200/50 p-1 mb-6 max-w-sm mx-auto">
                  <button
                    onClick={() => setActiveTab("dashboard")}
                    className={cn(
                      "w-full rounded-lg py-2.5 text-sm font-medium leading-5 ring-white/60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2",
                      activeTab === "dashboard"
                        ? "bg-white text-blue-700 shadow"
                        : "text-slate-600 hover:bg-white/[0.12] hover:text-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <LayoutGrid className="w-4 h-4" />
                      Dashboard
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveTab("articles")}
                    className={cn(
                      "w-full rounded-lg py-2.5 text-sm font-medium leading-5 ring-white/60 ring-offset-2 ring-offset-blue-400 focus:outline-none focus:ring-2",
                      activeTab === "articles"
                        ? "bg-white text-blue-700 shadow"
                        : "text-slate-600 hover:bg-white/[0.12] hover:text-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <TableIcon className="w-4 h-4" />
                      Articles
                    </div>
                  </button>
                </div>

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
                          className="bg-sky-50 border-sky-100 text-sky-900"
                          icon={<ShoppingCart className="w-4 h-4 text-sky-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("orderedItems", val)}
                          isOverridden={overrides["orderedItems"] !== undefined}
                        />
                        <StatsCard
                          title="Delivered Items"
                          value={deliveredItems}
                          description="Sum of 'Delivered Items' column from report"
                          className="bg-violet-50 border-violet-100 text-violet-900"
                          icon={<Truck className="w-4 h-4 text-violet-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("deliveredItems", val)}
                          isOverridden={overrides["deliveredItems"] !== undefined}
                        />
                        <StatsCard
                          title="Returned Items"
                          value={returnedItems}
                          description="Sum of 'Returned Items' column from report"
                          className="bg-rose-50 border-rose-100 text-rose-900"
                          icon={<RotateCcw className="w-4 h-4 text-rose-600" />}
                          formatter={formatNumber}
                          onOverride={(val) => updateOverride("returnedItems", val)}
                          isOverridden={overrides["returnedItems"] !== undefined}
                        />
                      </div>
                    </div>

                    {/* Revenue Section */}
                    <div className="space-y-4">
                      <h2 className="text-xl font-semibold text-slate-800">Income (₽)</h2>
                      <div className="w-full">
                        <StatsCard
                          title="Total Sales Revenue"
                          value={totalSalesRevenue}
                          description="Sum of redeemed goods, discount points and partner programs (Revenue + Discount Points + Partner Programs)"
                          className="bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200 hover:shadow-xl transition-shadow"
                          icon={<Coins className="w-6 h-6 text-blue-100" />}
                          onOverride={(val) => updateOverride("totalSalesRevenue", val)}
                          isOverridden={overrides["totalSalesRevenue"] !== undefined}
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <StatsCard
                          title="Revenue"
                          value={revenue}
                          percentage={totalSalesRevenue ? (revenue / totalSalesRevenue) * 100 : 0}
                          description="Sum of 'Revenue' column from report"
                          className="bg-emerald-50 border-emerald-100 text-emerald-900"
                          icon={<Calculator className="w-4 h-4 text-emerald-600" />}
                          onOverride={(val) => updateOverride("revenue", val)}
                          isOverridden={overrides["revenue"] !== undefined}
                        />
                        <StatsCard
                          title="Discount Points"
                          value={discountPoints}
                          percentage={totalSalesRevenue ? (discountPoints / totalSalesRevenue) * 100 : 0}
                          description="Sum of 'Discount Points' column from report"
                          className="bg-indigo-50 border-indigo-100 text-indigo-900"
                          icon={<FileSpreadsheet className="w-4 h-4 text-indigo-600" />}
                          onOverride={(val) => updateOverride("discountPoints", val)}
                          isOverridden={overrides["discountPoints"] !== undefined}
                        />
                        <StatsCard
                          title="Partner Programs"
                          value={partnerPrograms}
                          percentage={totalSalesRevenue ? (partnerPrograms / totalSalesRevenue) * 100 : 0}
                          description="Sum of 'Partner Programs' column from report"
                          className="bg-amber-50 border-amber-100 text-amber-900"
                          icon={<Calculator className="w-4 h-4 text-amber-600" />}
                          isDestructive={false}
                          onOverride={(val) => updateOverride("partnerPrograms", val)}
                          isOverridden={overrides["partnerPrograms"] !== undefined}
                        />
                      </div>
                    </div>

                    {/* Costs Section */}
                    <div className="space-y-4">
                      <h2 className="text-xl font-semibold text-slate-800">Costs (₽)</h2>

                      <div className="w-full">
                        <StatsCard
                          title="Total Costs"
                          value={totalCosts}
                          description="Sum of all costs: COGS + Commission + Logistics + Acquiring + Returns + Promotion + Additional Services + Cross Docking"
                          className="bg-red-600 border-red-600 text-white shadow-lg shadow-red-200 hover:shadow-xl transition-shadow"
                          icon={<CreditCard className="w-6 h-6 text-red-100" />}
                          subCaption={
                            <span className="text-red-100 text-sm">
                              Excl. COGS: {formatCurrency(operatingExpenses)}
                            </span>
                          }
                          onOverride={(val) => updateOverride("totalCosts", val)}
                          isOverridden={overrides["totalCosts"] !== undefined}
                          isExpense
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <StatsCard
                          title="Cost of Goods Sold"
                          value={totalCogs}
                          percentage={totalCosts ? (totalCogs / totalCosts) * 100 : 0}
                          description="Sum of cost of goods sold (Unit Cost * Delivered)"
                          className="bg-slate-50 border-slate-100 text-slate-900"
                          icon={<Package className="w-4 h-4 text-slate-600" />}
                          onOverride={(val) => updateOverride("totalCogs", val)}
                          isOverridden={overrides["totalCogs"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Marketplace Commission"
                          value={marketplaceCommission}
                          percentage={totalCosts ? (marketplaceCommission / totalCosts) * 100 : 0}
                          description="Sum of 'Ozon Commission' column from report"
                          className="bg-orange-50 border-orange-100 text-orange-900"
                          icon={<Coins className="w-4 h-4 text-orange-600" />}
                          onOverride={(val) => updateOverride("marketplaceCommission", val)}
                          isOverridden={overrides["marketplaceCommission"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Logistics Cost"
                          value={logisticsCost}
                          percentage={totalCosts ? (logisticsCost / totalCosts) * 100 : 0}
                          description="Sum of columns: Shipment Processing + Logistics + Delivery to Pick-up Point + Placement Cost"
                          className="bg-red-50 border-red-100 text-red-900"
                          icon={<Truck className="w-4 h-4 text-red-600" />}
                          onOverride={(val) => updateOverride("logisticsCost", val)}
                          isOverridden={overrides["logisticsCost"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Acquiring"
                          value={acquiringCost}
                          percentage={totalCosts ? (acquiringCost / totalCosts) * 100 : 0}
                          description="Sum of 'Acquiring' column from report"
                          className="bg-teal-50 border-teal-100 text-teal-900"
                          icon={<CreditCard className="w-4 h-4 text-teal-600" />}
                          onOverride={(val) => updateOverride("acquiringCost", val)}
                          isOverridden={overrides["acquiringCost"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Returns Cost"
                          value={returnsCost}
                          percentage={totalCosts ? (returnsCost / totalCosts) * 100 : 0}
                          description="Sum of columns: Return Processing + Return Logistics"
                          className="bg-pink-50 border-pink-100 text-pink-900"
                          icon={<RotateCcw className="w-4 h-4 text-pink-600" />}
                          onOverride={(val) => updateOverride("returnsCost", val)}
                          isOverridden={overrides["returnsCost"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Promotion Costs"
                          value={promotionCost}
                          percentage={totalCosts ? (promotionCost / totalCosts) * 100 : 0}
                          description="Sum of columns: Click Payment + Order Payment + Starred Items + Paid Brand + Subscription (24,990)"
                          className="bg-purple-50 border-purple-100 text-purple-900"
                          icon={<Megaphone className="w-4 h-4 text-purple-600" />}
                          onOverride={(val) => updateOverride("promotionCost", val)}
                          isOverridden={overrides["promotionCost"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Additional Services"
                          value={additionalServicesCost}
                          percentage={totalCosts ? (additionalServicesCost / totalCosts) * 100 : 0}
                          description="Sum of columns: Disposal + Seller Error Processing"
                          className="bg-gray-50 border-gray-100 text-gray-900"
                          icon={<Trash2 className="w-4 h-4 text-gray-600" />}
                          onOverride={(val) => updateOverride("additionalServicesCost", val)}
                          isOverridden={overrides["additionalServicesCost"] !== undefined}
                          isExpense
                        />
                        <StatsCard
                          title="Cross Docking"
                          value={crossDockingCost}
                          percentage={totalCosts ? (crossDockingCost / totalCosts) * 100 : 0}
                          description="1.5% of Total Sales Revenue"
                          className="bg-blue-50 border-blue-100 text-blue-900"
                          icon={<Package className="w-4 h-4 text-blue-600" />}
                          onOverride={(val) => updateOverride("crossDockingCost", val)}
                          isOverridden={overrides["crossDockingCost"] !== undefined}
                          isExpense
                        />

                        <StatsCard
                          title="Income Tax"
                          value={incomeTax}
                          percentage={totalCosts ? (incomeTax / totalCosts) * 100 : 0}
                          description="25% of Profit (Revenue + Costs before tax)"
                          className="bg-stone-50 border-stone-100 text-stone-900"
                          icon={<Coins className="w-4 h-4 text-stone-600" />}
                          onOverride={(val) => updateOverride("incomeTax", val)}
                          isOverridden={overrides["incomeTax"] !== undefined}
                          isExpense
                        />
                      </div>
                    </div>

                    {/* Financial Result Section */}
                    <div className="space-y-4">
                      <h2 className="text-xl font-semibold text-slate-800">Financial Result (₽)</h2>
                      <div className="grid gap-4 md:grid-cols-3">
                        <StatsCard
                          title="Profit"
                          value={profit}
                          description="Net Profit = Total Sales Revenue + Total Costs"
                          className="bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-200 hover:shadow-xl transition-shadow"
                          icon={<TrendingUp className="w-6 h-6 text-emerald-100" />}
                          onOverride={(val) => updateOverride("profit", val)}
                          isOverridden={overrides["profit"] !== undefined}
                        />
                        <StatsCard
                          title="Real Margin"
                          value={realMargin}
                          description="Real Margin = (Profit / Total Sales Revenue) * 100"
                          className="bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200 hover:shadow-xl transition-shadow"
                          icon={<Percent className="w-6 h-6 text-indigo-100" />}
                          formatter={(val) => `${val.toFixed(2)}%`}
                          onOverride={(val) => updateOverride("realMargin", val)}
                          isOverridden={overrides["realMargin"] !== undefined}
                        />
                        <StatsCard
                          title="Transfer to Factory"
                          value={payoutToFactory}
                          description="Total Sales Revenue + (Pre-Tax Costs - Cost of Goods Sold)"
                          className="bg-slate-700 border-slate-700 text-white shadow-lg shadow-slate-200 hover:shadow-xl transition-shadow"
                          icon={<Coins className="w-6 h-6 text-slate-100" />}
                          onOverride={(val) => updateOverride("payoutToFactory", val)}
                          isOverridden={overrides["payoutToFactory"] !== undefined}
                        />
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
    </main>
  );
}

function StatsCard({
  id,
  title,
  value,
  percentage,
  description,
  className,
  icon,
  formatter = formatCurrency,
  subCaption,
  onOverride,
  isOverridden,
  isExpense = false,
}: {
  id?: string;
  title: string;
  value: number;
  percentage?: number;
  description: string;
  className?: string;
  icon?: React.ReactNode;
  isDestructive?: boolean;
  formatter?: (val: number) => string;
  subCaption?: React.ReactNode;
  onOverride?: (val: number | undefined) => void;
  isOverridden?: boolean;
  isExpense?: boolean;
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
    <div className={cn("bg-white p-6 rounded-xl border shadow-sm space-y-2 relative group", className, isOverridden && "ring-2 ring-yellow-400 ring-offset-2")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 relative">
          <h3 className="text-sm font-medium opacity-80">{title}</h3>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-all shrink-0",
              showInfo ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            aria-label="Show info"
          >
            <Info className="w-3.5 h-3.5 opacity-60" />
          </button>

          {onOverride && !isEditing && (
            <div className="absolute left-full ml-1 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleEditClick}
                className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-colors"
                title="Edit value"
              >
                <Pencil className="w-3.5 h-3.5 opacity-60" />
              </button>
              {isOverridden && (
                <button
                  onClick={handleReset}
                  className="flex items-center justify-center w-6 h-6 rounded-full hover:bg-black/10 transition-colors ml-1"
                  title="Reset to calculated value"
                >
                  <ResetIcon className="w-3.5 h-3.5 opacity-60" />
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
          <div className="text-xl md:text-2xl font-bold break-words">
            {formatter(value)}
          </div>
        )}

        {percentage !== undefined && !isEditing && (
          <div className="text-xs font-medium opacity-60">
            {percentage.toFixed(1)}%
          </div>
        )}
      </div>

      {subCaption && (
        <div className="mt-1">
          {subCaption}
        </div>
      )}

      {isOverridden && !isEditing && (
        <div className="text-[10px] text-yellow-600 font-medium uppercase tracking-wider">
          Manually Set
        </div>
      )}

      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute left-0 right-0 top-full mt-2 mx-4 p-3 rounded-lg bg-slate-800 text-white text-xs shadow-xl z-50"
          >
            <div className="absolute -top-1 left-8 w-2 h-2 bg-slate-800 rotate-45 transform" />
            {description}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, Calculator, Loader2, Coins, Info, ShoppingCart, Truck, RotateCcw, CreditCard, Trash2, Megaphone, Package, Percent, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { parseReport, type AnalysisResult } from "@/lib/parse";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatCompactCurrency, formatCompactNumber } from "@/lib/utils";

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

  const handleFile = async (file: File) => {
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

  const totalSalesRevenue = result
    ? result.revenue + result.discountPoints + result.partnerPrograms
    : 0;

  const crossDockingCost = -(totalSalesRevenue * 0.025);


  const totalCosts = result
    ? result.marketplaceCommission +
    result.logisticsCost +
    result.acquiringCost +
    result.returnsCost +
    result.promotionCost +
    result.additionalServicesCost +
    crossDockingCost +
    result.totalCogs
    : 0;

  const payoutToFactory = result
    ? totalSalesRevenue + (totalCosts - result.totalCogs)
    : 0;

  const profit = totalSalesRevenue + totalCosts;
  const realMargin = totalSalesRevenue ? (profit / totalSalesRevenue) * 100 : 0;

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-5xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Ozon Report Analyzer
          </h1>
          <p className="text-slate-600">
            Upload unit economics report to calculate totals
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div
            className={cn(
              "p-10 border-2 border-dashed rounded-xl m-4 transition-colors duration-200 ease-in-out cursor-pointer flex flex-col items-center justify-center gap-4",
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
              className="space-y-8"
            >
              {/* Statistics Section */}
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-800">Statistics</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  <StatsCard
                    title="Ordered Items"
                    value={result.orderedItems}
                    description="Sum of 'Ordered Items' column from report"
                    className="bg-sky-50 border-sky-100 text-sky-900"
                    icon={<ShoppingCart className="w-4 h-4 text-sky-600" />}
                    formatter={formatNumber}
                  />
                  <StatsCard
                    title="Delivered Items"
                    value={result.deliveredItems}
                    description="Sum of 'Delivered Items' column from report"
                    className="bg-violet-50 border-violet-100 text-violet-900"
                    icon={<Truck className="w-4 h-4 text-violet-600" />}
                    formatter={formatNumber}
                  />
                  <StatsCard
                    title="Returned Items"
                    value={result.returnedItems}
                    description="Sum of 'Returned Items' column from report"
                    className="bg-rose-50 border-rose-100 text-rose-900"
                    icon={<RotateCcw className="w-4 h-4 text-rose-600" />}
                    formatter={formatNumber}
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
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <StatsCard
                    title="Revenue"
                    value={result.revenue}
                    percentage={totalSalesRevenue ? (result.revenue / totalSalesRevenue) * 100 : 0}
                    description="Sum of 'Revenue' column from report"
                    className="bg-emerald-50 border-emerald-100 text-emerald-900"
                    icon={<Calculator className="w-4 h-4 text-emerald-600" />}
                  />
                  <StatsCard
                    title="Discount Points"
                    value={result.discountPoints}
                    percentage={totalSalesRevenue ? (result.discountPoints / totalSalesRevenue) * 100 : 0}
                    description="Sum of 'Discount Points' column from report"
                    className="bg-indigo-50 border-indigo-100 text-indigo-900"
                    icon={<FileSpreadsheet className="w-4 h-4 text-indigo-600" />}
                  />
                  <StatsCard
                    title="Partner Programs"
                    value={result.partnerPrograms}
                    percentage={totalSalesRevenue ? (result.partnerPrograms / totalSalesRevenue) * 100 : 0}
                    description="Sum of 'Partner Programs' column from report"
                    className="bg-amber-50 border-amber-100 text-amber-900"
                    icon={<Calculator className="w-4 h-4 text-amber-600" />}
                    isDestructive={false}
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
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <StatsCard
                    title="Cost of Goods Sold"
                    value={result.totalCogs}
                    percentage={totalCosts ? (result.totalCogs / totalCosts) * 100 : 0}
                    description="Sum of cost of goods sold (Unit Cost * Delivered)"
                    className="bg-slate-50 border-slate-100 text-slate-900"
                    icon={<Package className="w-4 h-4 text-slate-600" />}
                  />
                  <StatsCard
                    title="Marketplace Commission"
                    value={result.marketplaceCommission}
                    percentage={totalCosts ? (result.marketplaceCommission / totalCosts) * 100 : 0}
                    description="Sum of 'Ozon Commission' column from report"
                    className="bg-orange-50 border-orange-100 text-orange-900"
                    icon={<Coins className="w-4 h-4 text-orange-600" />}
                  />
                  <StatsCard
                    title="Logistics Cost"
                    value={result.logisticsCost}
                    percentage={totalCosts ? (result.logisticsCost / totalCosts) * 100 : 0}
                    description="Sum of columns: Shipment Processing + Logistics + Delivery to Pick-up Point + Placement Cost"
                    className="bg-red-50 border-red-100 text-red-900"
                    icon={<Truck className="w-4 h-4 text-red-600" />}
                  />
                  <StatsCard
                    title="Acquiring"
                    value={result.acquiringCost}
                    percentage={totalCosts ? (result.acquiringCost / totalCosts) * 100 : 0}
                    description="Sum of 'Acquiring' column from report"
                    className="bg-teal-50 border-teal-100 text-teal-900"
                    icon={<CreditCard className="w-4 h-4 text-teal-600" />}
                  />
                  <StatsCard
                    title="Returns Cost"
                    value={result.returnsCost}
                    percentage={totalCosts ? (result.returnsCost / totalCosts) * 100 : 0}
                    description="Sum of columns: Return Processing + Return Logistics"
                    className="bg-pink-50 border-pink-100 text-pink-900"
                    icon={<RotateCcw className="w-4 h-4 text-pink-600" />}
                  />
                  <StatsCard
                    title="Promotion Costs"
                    value={result.promotionCost}
                    percentage={totalCosts ? (result.promotionCost / totalCosts) * 100 : 0}
                    description="Sum of columns: Click Payment + Order Payment + Starred Items + Paid Brand"
                    className="bg-purple-50 border-purple-100 text-purple-900"
                    icon={<Megaphone className="w-4 h-4 text-purple-600" />}
                  />
                  <StatsCard
                    title="Additional Services"
                    value={result.additionalServicesCost}
                    percentage={totalCosts ? (result.additionalServicesCost / totalCosts) * 100 : 0}
                    description="Sum of columns: Disposal + Seller Error Processing"
                    className="bg-gray-50 border-gray-100 text-gray-900"
                    icon={<Trash2 className="w-4 h-4 text-gray-600" />}
                  />
                  <StatsCard
                    title="Cross Docking"
                    value={crossDockingCost}
                    percentage={totalCosts ? (crossDockingCost / totalCosts) * 100 : 0}
                    description="2.5% of Total Sales Revenue"
                    className="bg-blue-50 border-blue-100 text-blue-900"
                    icon={<Package className="w-4 h-4 text-blue-600" />}
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
                  />
                  <StatsCard
                    title="Real Margin"
                    value={realMargin}
                    description="Real Margin = (Profit / Total Sales Revenue) * 100"
                    className="bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200 hover:shadow-xl transition-shadow"
                    icon={<Percent className="w-6 h-6 text-indigo-100" />}
                    formatter={(val) => `${val.toFixed(2)}%`}
                  />
                  <StatsCard
                    title="Transfer to Factory"
                    value={payoutToFactory}
                    description="Total Sales Revenue - (Total Costs - Cost of Goods Sold)"
                    className="bg-slate-700 border-slate-700 text-white shadow-lg shadow-slate-200 hover:shadow-xl transition-shadow"
                    icon={<Coins className="w-6 h-6 text-slate-100" />}
                  />
                </div>

              </div>
            </motion.div>
          )
          }
        </AnimatePresence >
      </div >
    </main >
  );
}

function StatsCard({
  title,
  value,
  percentage,
  description,
  className,
  icon,
  formatter = formatCurrency,
}: {
  title: string;
  value: number;
  percentage?: number;
  description: string;
  className?: string;
  icon?: React.ReactNode;
  isDestructive?: boolean;
  formatter?: (val: number) => string;
}) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className={cn("bg-white p-6 rounded-xl border shadow-sm space-y-2 relative", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium opacity-80">{title}</h3>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="hover:opacity-70 transition-opacity p-0.5 rounded-full hover:bg-black/5"
            aria-label="Show info"
          >
            <Info className="w-3.5 h-3.5 opacity-60" />
          </button>
        </div>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-xl md:text-2xl font-bold break-words">
          {formatter(value)}
        </div>
        {percentage !== undefined && (
          <div className="text-xs font-medium opacity-60">
            {percentage.toFixed(1)}%
          </div>
        )}
      </div>

      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute left-0 right-0 top-full mt-2 mx-4 p-3 rounded-lg bg-slate-800 text-white text-xs shadow-xl z-10"
          >
            <div className="absolute -top-1 left-8 w-2 h-2 bg-slate-800 rotate-45 transform" />
            {description}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useState } from "react";
import { ArticleRow } from "@/lib/parse";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { formatCompactCurrency, formatCompactNumber } from "@/lib/utils";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface ArticlesTableProps {
    articles: ArticleRow[];
}

type SortField = keyof ArticleRow | "totalCosts" | "profit" | "margin" | "crossDocking" | "incomeTax" | "finalPromotionCost" | "totalCostsWithTax" | "totalSalesRevenue" | "avgPrice";
type SortDirection = "asc" | "desc";

export function ArticlesTable({ articles }: ArticlesTableProps) {
    const [sortField, setSortField] = useState<SortField>("revenue");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [distributeAds, setDistributeAds] = useState(false);

    // Constants
    const SUBSCRIPTION_COST = 24990;
    const CROSS_DOCKING_RATE = 0.015;
    const INCOME_TAX_RATE = 0.25;

    // Calculate totals for distribution
    const totalPromotionCost = articles.reduce((sum, a) => sum + a.promotionCost, 0);
    const totalRevenue = articles.reduce((sum, a) => sum + (a.revenue + a.discountPoints + a.partnerPrograms), 0);
    const totalDelivered = articles.reduce((sum, a) => sum + a.deliveredItems, 0);
    const totalArticlesCount = articles.length;

    // Helper to calculate full article metrics
    const getEnrichedArticle = (article: ArticleRow) => {
        const totalSalesRevenue = article.revenue + article.discountPoints + article.partnerPrograms;

        // 1. Cross Docking
        const crossDocking = -(totalSalesRevenue * CROSS_DOCKING_RATE);

        // 2. Subscription (Proportional by Revenue)
        const revenueShare = totalRevenue > 0 ? totalSalesRevenue / totalRevenue : 0;
        const subscription = -(SUBSCRIPTION_COST * revenueShare);

        // 3. Promotion (Ads) - Either direct or distributed PROPORTIONALLY by Revenue
        // NOW INCLUDES SUBSCRIPTION
        let finalPromotionCost = article.promotionCost;
        if (distributeAds) {
            const revenueShare = totalRevenue > 0 ? totalSalesRevenue / totalRevenue : 0;
            finalPromotionCost = -(Math.abs(totalPromotionCost) * revenueShare);
        }

        // Add subscription to final promotion cost
        finalPromotionCost += subscription;

        // 4. Total Costs (Direct + Distributed)
        const totalCosts =
            article.marketplaceCommission +
            article.logisticsCost +
            article.acquiringCost +
            article.returnsCost +
            article.additionalServicesCost +
            article.totalCogs +
            finalPromotionCost +
            crossDocking;

        // 5. Profit (Pre-tax)
        const profitPreTax = totalSalesRevenue + totalCosts;

        // 6. Income Tax
        const incomeTax = profitPreTax > 0 ? -(profitPreTax * INCOME_TAX_RATE) : 0;

        // 7. Net Profit
        const profit = profitPreTax + incomeTax;

        // 8. Margin
        const margin = totalSalesRevenue ? (profit / totalSalesRevenue) * 100 : 0;

        // 9. Avg Price
        const avgPrice = article.deliveredItems > 0 ? totalSalesRevenue / article.deliveredItems : 0;

        return {
            ...article,
            totalSalesRevenue,
            crossDocking,
            subscription,
            finalPromotionCost,
            totalCosts,
            totalCostsWithTax: totalCosts + incomeTax,
            profit,
            margin,
            incomeTax,
            avgPrice
        };
    };

    const enrichedArticles = articles.map(getEnrichedArticle);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const sortedArticles = [...enrichedArticles].sort((a, b) => {
        const aValue = (a as any)[sortField];
        const bValue = (b as any)[sortField];

        if (typeof aValue === "string" && typeof bValue === "string") {
            return sortDirection === "asc"
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        }

        if (typeof aValue === "number" && typeof bValue === "number") {
            return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
        }

        return 0;
    });

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="w-4 h-4 opacity-30" />;
        return sortDirection === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
    };

    const formatCurrency = (val: number) => formatCompactCurrency(val);
    const formatNumber = (val: number) => formatCompactNumber(val);

    const renderWithPercent = (val: number, total: number) => (
        <div className="flex flex-col items-end">
            <span>{formatCurrency(val)}</span>
            <span className="text-[10px] opacity-0 group-hover:opacity-70 transition-opacity duration-200">
                {total > 0 ? ((Math.abs(val) / total) * 100).toFixed(1) : "0.0"}%
            </span>
        </div>
    );


    // Calculate totals for summary metrics
    // We need to calculate Total Profit using the same logic as the Dashboard:
    // 1. Sum up all Pre-Tax Costs
    // 2. Sum up Total Revenue
    // 3. Calculate Global Tax on the (Revenue + Costs)
    // 4. Net Profit = (Revenue + Costs) - Tax

    const totalPreTaxCosts = enrichedArticles.reduce((sum, a) =>
        sum +
        a.marketplaceCommission +
        a.logisticsCost +
        a.acquiringCost +
        a.returnsCost +
        a.additionalServicesCost +
        a.totalCogs +
        a.finalPromotionCost +
        a.crossDocking
        , 0);

    const totalPreTaxProfit = totalRevenue + totalPreTaxCosts;
    const globalIncomeTax = totalPreTaxProfit > 0 ? -(totalPreTaxProfit * INCOME_TAX_RATE) : 0;
    const totalProfit = totalPreTaxProfit + globalIncomeTax;

    const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between space-x-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-6 text-sm">
                    <div className="flex flex-col">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">SKUs</span>
                        <span className="font-bold text-slate-800 text-lg leading-tight">{formatNumber(enrichedArticles.length)}</span>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="flex flex-col">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Total Revenue</span>
                        <span className="font-bold text-slate-800 text-lg leading-tight">{formatCurrency(totalRevenue)}</span>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="flex flex-col">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Total Profit</span>
                        <span className={cn("font-bold text-lg leading-tight", totalProfit > 0 ? "text-emerald-600" : "text-red-600")}>
                            {formatCurrency(totalProfit)}
                        </span>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="flex flex-col">
                        <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Avg. Margin</span>
                        <span className={cn("font-bold text-lg leading-tight", totalMargin > 0 ? "text-emerald-600" : "text-red-600")}>
                            {totalMargin.toFixed(1)}%
                        </span>
                    </div>
                </div>

                <div className="flex items-center space-x-2 border-l border-slate-200 pl-4">
                    <div className="flex items-center space-x-2">
                        <label htmlFor="distribute-ads" className="text-sm font-medium text-slate-700 cursor-pointer select-none">
                            Spread Ads Proportionally (by Revenue)
                        </label>
                        <button
                            id="distribute-ads"
                            onClick={() => setDistributeAds(!distributeAds)}
                            className={cn(
                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                                distributeAds ? "bg-blue-600" : "bg-slate-200"
                            )}
                        >
                            <span
                                className={cn(
                                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                    distributeAds ? "translate-x-6" : "translate-x-1"
                                )}
                            />
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[calc(100vh-240px)] overflow-y-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap border-separate border-spacing-0">
                        <thead className="bg-slate-50 text-slate-700 font-medium [&_th]:border-b [&_th]:border-slate-200">
                            {/* Super Headers */}
                            <tr className="text-xs uppercase tracking-wider font-bold">
                                <th colSpan={3} className="p-2 border-r border-slate-200 bg-slate-50 text-center text-slate-400 sticky left-0 top-0 z-50 h-[40px]">
                                    Statistics
                                </th>

                                <th colSpan={4} className="p-2 border-r border-emerald-200 bg-emerald-100 text-center text-emerald-700 sticky top-0 z-40 h-[40px]">
                                    Income
                                </th>
                                <th colSpan={10} className="p-2 border-r border-rose-200 bg-rose-100 text-center text-rose-700 sticky top-0 z-40 h-[40px]">
                                    Costs
                                </th>
                                <th colSpan={2} className="p-2 bg-slate-50 text-center text-slate-600 sticky top-0 z-40 h-[40px]">
                                    Result
                                </th>
                            </tr>
                            <tr>
                                <th className="p-4 cursor-pointer hover:bg-slate-100 transition-colors sticky left-0 bg-slate-50 z-50 border-r border-slate-200 min-w-[400px] w-[400px] max-w-[400px] top-[40px]" onClick={() => handleSort("sku")}>
                                    <div className="flex items-center gap-2">
                                        SKU <SortIcon field="sku" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors sticky left-[400px] bg-slate-50 z-50 border-r border-slate-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)] w-[120px] min-w-[120px] max-w-[120px] top-[40px]" onClick={() => handleSort("deliveredItems")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Delivered <SortIcon field="deliveredItems" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors sticky left-[520px] bg-slate-50 z-50 border-r border-slate-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)] w-[120px] min-w-[120px] max-w-[120px] top-[40px]" onClick={() => handleSort("avgPrice")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Avg. Price <SortIcon field="avgPrice" />
                                    </div>
                                </th>

                                <th className="p-4 text-right cursor-pointer hover:bg-emerald-50 transition-colors bg-emerald-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("revenue")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Revenue</span> <SortIcon field="revenue" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-emerald-50 transition-colors bg-emerald-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("discountPoints")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Points</span> <SortIcon field="discountPoints" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-emerald-50 transition-colors bg-emerald-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("partnerPrograms")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Partners</span> <SortIcon field="partnerPrograms" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-emerald-50 transition-colors border-r border-emerald-100 bg-emerald-50 w-[140px] min-w-[140px] max-w-[140px] sticky top-[40px] z-40" onClick={() => handleSort("totalSalesRevenue")}>
                                    <div className="flex items-center justify-end gap-2 text-emerald-700">
                                        <span className="overflow-hidden whitespace-nowrap">Total Sales</span> <SortIcon field="totalSalesRevenue" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("totalCogs")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">COGS</span> <SortIcon field="totalCogs" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("marketplaceCommission")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Comm.</span> <SortIcon field="marketplaceCommission" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("logisticsCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Logistics</span> <SortIcon field="logisticsCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("acquiringCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Acquiring</span> <SortIcon field="acquiringCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("returnsCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Returns</span> <SortIcon field="returnsCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("additionalServicesCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Services</span> <SortIcon field="additionalServicesCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("crossDocking")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Cross Docking</span> <SortIcon field="crossDocking" />
                                    </div>
                                </th>

                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("finalPromotionCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Ads</span> <SortIcon field="finalPromotionCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors bg-rose-50 w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("incomeTax")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Tax</span> <SortIcon field="incomeTax" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-rose-50 transition-colors border-r border-rose-100 bg-rose-50 w-[140px] min-w-[140px] max-w-[140px] sticky top-[40px] z-40" onClick={() => handleSort("totalCostsWithTax")}>
                                    <div className="flex items-center justify-end gap-2 text-rose-700">
                                        <span className="overflow-hidden whitespace-nowrap">Total Costs</span> <SortIcon field="totalCostsWithTax" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("profit")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Profit</span> <SortIcon field="profit" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors w-[110px] min-w-[110px] max-w-[110px] sticky top-[40px] z-40" onClick={() => handleSort("margin")}>
                                    <div className="flex items-center justify-end gap-2">
                                        <span className="overflow-hidden whitespace-nowrap">Margin</span> <SortIcon field="margin" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="[&_td]:border-b [&_td]:border-slate-100">
                            {sortedArticles.map((article) => (
                                <tr key={article.sku} className="hover:bg-slate-50 transition-colors group">
                                    <td className="p-4 font-mono text-xs sticky left-0 bg-white z-10 border-r border-slate-200 min-w-[400px] w-[400px] max-w-[400px]" title={article.name}>
                                        <div className="flex flex-col truncate">
                                            <span className="truncate">{article.sku}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right sticky left-[400px] bg-white z-10 border-r border-slate-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)] w-[120px] min-w-[120px] max-w-[120px]">
                                        <div className="flex flex-col items-end">
                                            <span className="font-medium">{formatNumber(article.deliveredItems)}</span>
                                            <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                {totalDelivered > 0 ? ((article.deliveredItems / totalDelivered) * 100).toFixed(1) : "0.0"}%
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right font-medium text-slate-700 sticky left-[520px] bg-white z-10 border-r border-slate-200 w-[120px] min-w-[120px] max-w-[120px] shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)]">{formatCurrency((article as any).avgPrice)}</td>

                                    <td className="p-4 text-right font-medium w-[110px] min-w-[110px] max-w-[110px]">{formatCurrency(article.revenue)}</td>
                                    <td className="p-4 text-right text-slate-500 w-[110px] min-w-[110px] max-w-[110px]">{formatCurrency(article.discountPoints)}</td>
                                    <td className="p-4 text-right text-slate-500 w-[110px] min-w-[110px] max-w-[110px]">{formatCurrency(article.partnerPrograms)}</td>
                                    <td className="p-4 text-right font-bold text-emerald-700 border-r border-emerald-100 bg-emerald-50 w-[140px] min-w-[140px] max-w-[140px]">{formatCurrency(article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.totalCogs, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.marketplaceCommission, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.logisticsCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.acquiringCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.returnsCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.additionalServicesCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.crossDocking, article.totalSalesRevenue)}</td>

                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.finalPromotionCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70 w-[110px] min-w-[110px] max-w-[110px]">{renderWithPercent(article.incomeTax, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-rose-700 font-medium border-r border-rose-100 bg-rose-50 w-[140px] min-w-[140px] max-w-[140px]">{renderWithPercent(article.totalCostsWithTax, article.totalSalesRevenue)}</td>
                                    <td className={cn("p-4 text-right font-bold w-[110px] min-w-[110px] max-w-[110px]", article.profit > 0 ? "text-emerald-600" : "text-red-600")}>
                                        {formatCurrency(article.profit)}
                                    </td>
                                    <td className={cn("p-4 text-right w-[110px] min-w-[110px] max-w-[110px]", article.margin > 0 ? "text-emerald-600" : "text-red-600")}>
                                        {article.margin.toFixed(1)}%
                                    </td>
                                </tr>
                            ))}
                            {sortedArticles.length === 0 && (
                                <tr>
                                    <td colSpan={20} className="p-8 text-center text-slate-500">
                                        No articles found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}



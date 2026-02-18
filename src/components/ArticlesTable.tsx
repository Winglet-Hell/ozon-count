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
            <span className="text-[10px] opacity-70">
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
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap border-separate border-spacing-0">
                        <thead className="bg-slate-50 text-slate-700 font-medium [&_th]:border-b [&_th]:border-slate-200">
                            <tr>
                                <th className="p-4 cursor-pointer hover:bg-slate-100 transition-colors sticky left-0 bg-slate-50 z-20 border-r border-slate-200 min-w-[400px] w-[400px] max-w-[400px]" onClick={() => handleSort("sku")}>
                                    <div className="flex items-center gap-2">
                                        SKU <SortIcon field="sku" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors sticky left-[400px] bg-slate-50 z-20 border-r border-slate-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)] min-w-[120px]" onClick={() => handleSort("deliveredItems")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Delivered <SortIcon field="deliveredItems" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("orderedItems")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Ordered <SortIcon field="orderedItems" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("revenue")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Revenue <SortIcon field="revenue" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("discountPoints")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Points <SortIcon field="discountPoints" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("partnerPrograms")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Partners <SortIcon field="partnerPrograms" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("totalSalesRevenue")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Total Sales <SortIcon field="totalSalesRevenue" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("avgPrice")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Avg. Price <SortIcon field="avgPrice" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("totalCogs")}>
                                    <div className="flex items-center justify-end gap-2">
                                        COGS <SortIcon field="totalCogs" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("marketplaceCommission")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Comm. <SortIcon field="marketplaceCommission" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("logisticsCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Logistics <SortIcon field="logisticsCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("acquiringCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Acquiring <SortIcon field="acquiringCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("returnsCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Returns <SortIcon field="returnsCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("additionalServicesCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Services <SortIcon field="additionalServicesCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("crossDocking")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Cross Docking <SortIcon field="crossDocking" />
                                    </div>
                                </th>

                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("finalPromotionCost")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Ads <SortIcon field="finalPromotionCost" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("incomeTax")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Tax <SortIcon field="incomeTax" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("totalCostsWithTax")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Total Costs <SortIcon field="totalCostsWithTax" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("profit")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Profit <SortIcon field="profit" />
                                    </div>
                                </th>
                                <th className="p-4 text-right cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("margin")}>
                                    <div className="flex items-center justify-end gap-2">
                                        Margin <SortIcon field="margin" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="[&_td]:border-b [&_td]:border-slate-100">
                            {sortedArticles.map((article) => (
                                <tr key={article.sku} className="hover:bg-slate-50 transition-colors">
                                    <td className="p-4 font-mono text-xs sticky left-0 bg-white z-10 border-r border-slate-200 min-w-[400px] w-[400px] max-w-[400px]" title={article.name}>
                                        <div className="flex flex-col truncate">
                                            <span className="truncate">{article.sku}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right sticky left-[400px] bg-white z-10 border-r border-slate-200 shadow-[4px_0_4px_-2px_rgba(0,0,0,0.05)] min-w-[120px]">
                                        <div className="flex flex-col items-end">
                                            <span className="font-medium">{formatNumber(article.deliveredItems)}</span>
                                            <span className="text-[10px] text-slate-400">
                                                {totalDelivered > 0 ? ((article.deliveredItems / totalDelivered) * 100).toFixed(1) : "0.0"}%
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">{formatNumber(article.orderedItems)}</td>
                                    <td className="p-4 text-right font-medium">{formatCurrency(article.revenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{formatCurrency(article.discountPoints)}</td>
                                    <td className="p-4 text-right text-slate-500">{formatCurrency(article.partnerPrograms)}</td>
                                    <td className="p-4 text-right font-bold text-blue-600">{formatCurrency(article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right font-medium text-slate-700">{formatCurrency((article as any).avgPrice)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.totalCogs, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.marketplaceCommission, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.logisticsCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.acquiringCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.returnsCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-slate-500">{renderWithPercent(article.additionalServicesCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70">{renderWithPercent(article.crossDocking, article.totalSalesRevenue)}</td>

                                    <td className="p-4 text-right text-red-600/70">{renderWithPercent(article.finalPromotionCost, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600/70">{renderWithPercent(article.incomeTax, article.totalSalesRevenue)}</td>
                                    <td className="p-4 text-right text-red-600 font-medium">{renderWithPercent(article.totalCostsWithTax, article.totalSalesRevenue)}</td>
                                    <td className={cn("p-4 text-right font-bold", article.profit > 0 ? "text-emerald-600" : "text-red-600")}>
                                        {formatCurrency(article.profit)}
                                    </td>
                                    <td className={cn("p-4 text-right", article.margin > 0 ? "text-emerald-600" : "text-red-600")}>
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



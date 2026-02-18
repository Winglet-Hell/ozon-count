import Papa from "papaparse";

export interface ReportRow {
    "Выручка": string;
    "Баллы за скидки": string;
    "Программы партнёров": string;
    "Вознаграждение Ozon": string;
    "Эквайринг": string;
    [key: string]: string;
}

export interface ArticleRow {
    sku: string;
    name: string;
    revenue: number;
    discountPoints: number;
    partnerPrograms: number;
    marketplaceCommission: number;
    orderedItems: number;
    deliveredItems: number;
    returnedItems: number;
    logisticsCost: number;
    acquiringCost: number;
    returnsCost: number;
    additionalServicesCost: number;
    promotionCost: number;
    totalCogs: number;
}

export interface AnalysisResult {
    revenue: number;
    discountPoints: number;
    partnerPrograms: number;
    marketplaceCommission: number;
    orderedItems: number;
    deliveredItems: number;
    returnedItems: number;
    logisticsCost: number;
    acquiringCost: number;
    returnsCost: number;
    additionalServicesCost: number;
    promotionCost: number;
    totalCogs: number;
    articles: ArticleRow[];
}

export const parseCurrency = (value: string): number => {
    if (!value) return 0;
    // Remove all non-numeric characters except minus, comma, and dot
    // Also remove spaces which are often used as thousand separators
    const cleanValue = value.replace(/[^\d,\.-]/g, "").replace(",", ".");
    const number = parseFloat(cleanValue);
    return isNaN(number) ? 0 : number;
};

export const parseReport = (file: File): Promise<AnalysisResult> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            if (!text) {
                reject(new Error("Empty file"));
                return;
            }

            // Split lines to find the header row
            // We expect headers to start with "SKU" or similar, or just check line 4
            const lines = text.split(/\r?\n/);

            let headerLineIndex = -1;

            // Look for the header line which must contain "Выручка" and "Баллы за скидки"
            for (let i = 0; i < Math.min(lines.length, 20); i++) {
                if (lines[i].includes("Выручка") && lines[i].includes("Баллы за скидки")) {
                    headerLineIndex = i;
                    break;
                }
            }

            if (headerLineIndex === -1) {
                // Fallback: try line 3 (index 3, line 4)
                if (lines.length > 3) headerLineIndex = 3;
                else headerLineIndex = 0;
            }

            // Extract content starting from header line
            const csvContent = lines.slice(headerLineIndex).join("\n");

            Papa.parse<ReportRow>(csvContent, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    let revenue = 0;
                    let discountPoints = 0;
                    let partnerPrograms = 0;
                    let marketplaceCommission = 0;
                    let orderedItems = 0;
                    let deliveredItems = 0;
                    let returnedItems = 0;
                    let logisticsCost = 0;
                    let acquiringCost = 0;
                    let returnsCost = 0;
                    let additionalServicesCost = 0;
                    let promotionCost = 0;
                    let totalCogs = 0;

                    const articlesMap = new Map<string, ArticleRow>();

                    results.data.forEach((row) => {
                        // Safe parsing helper - handles undefined/null gracefully
                        const getVal = (key: string) => row[key] ? parseCurrency(row[key]) : 0;

                        // Global accumulations
                        revenue += getVal("Выручка");
                        discountPoints += getVal("Баллы за скидки");
                        partnerPrograms += getVal("Программы партнёров");
                        marketplaceCommission += getVal("Вознаграждение Ozon");
                        orderedItems += getVal("Заказано товаров, шт");
                        const delivered = getVal("Доставлено товаров, шт");
                        deliveredItems += delivered;
                        returnedItems += getVal("Возвращено товаров, шт");

                        // Logistics calculation
                        let rowLogistics = 0;
                        rowLogistics += getVal("Обработка отправления");
                        rowLogistics += getVal("Логистика");
                        rowLogistics += getVal("Доставка до места выдачи");
                        rowLogistics += getVal("Стоимость размещения");
                        logisticsCost += rowLogistics;

                        // Acquiring calculation
                        const rowAcquiring = getVal("Эквайринг");
                        acquiringCost += rowAcquiring;

                        // Returns Cost calculation
                        let rowReturns = 0;
                        rowReturns += getVal("Обработка возврата");
                        rowReturns += getVal("Обратная логистика");
                        returnsCost += rowReturns;

                        // Additional Services calculation
                        let rowAdditional = 0;
                        rowAdditional += getVal("Утилизация");
                        rowAdditional += getVal("Обработка ошибок продавца");
                        additionalServicesCost += rowAdditional;

                        // Promotion Cost calculation
                        let rowPromotion = 0;
                        rowPromotion += getVal("Оплата за клик");
                        rowPromotion += getVal("Оплата за заказ");
                        rowPromotion += getVal("Звёздные товары");
                        rowPromotion += getVal("Платный бренд");
                        promotionCost += rowPromotion;

                        // COGS calculation
                        const unitCost = getVal("Себестоимость");
                        const returned = getVal("Возвращено товаров, шт");
                        const rowCogs = -(unitCost * (delivered - returned));
                        totalCogs += rowCogs;


                        // Article aggregation
                        const sku = row["Артикул"] || "Unknown";
                        const name = row["Наименование товара"] || "Unknown";

                        if (!articlesMap.has(sku)) {
                            articlesMap.set(sku, {
                                sku,
                                name,
                                revenue: 0,
                                discountPoints: 0,
                                partnerPrograms: 0,
                                marketplaceCommission: 0,
                                orderedItems: 0,
                                deliveredItems: 0,
                                returnedItems: 0,
                                logisticsCost: 0,
                                acquiringCost: 0,
                                returnsCost: 0,
                                additionalServicesCost: 0,
                                promotionCost: 0,
                                totalCogs: 0
                            });
                        }

                        const article = articlesMap.get(sku)!;
                        article.revenue += getVal("Выручка");
                        article.discountPoints += getVal("Баллы за скидки");
                        article.partnerPrograms += getVal("Программы партнёров");
                        article.marketplaceCommission += getVal("Вознаграждение Ozon");
                        article.orderedItems += getVal("Заказано товаров, шт");
                        article.deliveredItems += delivered;
                        article.returnedItems += getVal("Возвращено товаров, шт");
                        article.logisticsCost += rowLogistics;
                        article.acquiringCost += rowAcquiring;
                        article.returnsCost += rowReturns;
                        article.additionalServicesCost += rowAdditional;
                        article.promotionCost += rowPromotion;
                        article.totalCogs += rowCogs;
                    });

                    // Finalize article calculations
                    const articles = Array.from(articlesMap.values());

                    resolve({
                        revenue,
                        discountPoints,
                        partnerPrograms,
                        marketplaceCommission,
                        orderedItems,
                        deliveredItems,
                        returnedItems,
                        logisticsCost,
                        acquiringCost,
                        returnsCost,
                        additionalServicesCost,
                        promotionCost,
                        totalCogs,
                        articles
                    });
                },
                error: (error: Error) => {
                    reject(error);
                }
            });
        };

        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
};

import Papa from "papaparse";

export interface ReportRow {
    "Выручка": string;
    "Баллы за скидки": string;
    "Программы партнёров": string;
    "Вознаграждение Ozon": string;
    "Эквайринг": string;
    [key: string]: string;
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

            // Use Papa Parse directly on the string content
            // We need to allow for proper parsing of quoted fields which Papa Parse handles well
            // However, we should ensure we're passing the string correctly

            // Re-import Papa to ensure types are correct in this scope if needed, 
            // but relying on the outer import is standard.

            Papa.parse<ReportRow>(csvContent, {
                header: true,
                skipEmptyLines: true,
                // Add quoting support if needed, but defaults usually work for standard CSVs
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

                    results.data.forEach((row) => {
                        // Safe parsing helper - handles undefined/null gracefully
                        const getVal = (key: string) => row[key] ? parseCurrency(row[key]) : 0;

                        revenue += getVal("Выручка");
                        discountPoints += getVal("Баллы за скидки");
                        partnerPrograms += getVal("Программы партнёров");
                        marketplaceCommission += getVal("Вознаграждение Ozon");
                        orderedItems += getVal("Заказано товаров, шт");
                        deliveredItems += getVal("Доставлено товаров, шт");
                        returnedItems += getVal("Возвращено товаров, шт");

                        // Logistics calculation
                        logisticsCost += getVal("Обработка отправления");
                        logisticsCost += getVal("Логистика");
                        logisticsCost += getVal("Доставка до места выдачи");
                        logisticsCost += getVal("Стоимость размещения");

                        // Acquiring calculation
                        acquiringCost += getVal("Эквайринг");

                        // Returns Cost calculation
                        returnsCost += getVal("Обработка возврата");
                        returnsCost += getVal("Обратная логистика");

                        // Additional Services calculation
                        additionalServicesCost += getVal("Утилизация");
                        additionalServicesCost += getVal("Обработка ошибок продавца");

                        // Promotion Cost calculation
                        promotionCost += getVal("Оплата за клик");
                        promotionCost += getVal("Оплата за заказ");
                        promotionCost += getVal("Звёздные товары");
                        promotionCost += getVal("Платный бренд");
                    });

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
                        promotionCost
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

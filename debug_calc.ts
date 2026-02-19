
import fs from 'fs';
import Papa from 'papaparse';

const fileContent = fs.readFileSync('/Users/roma/Developer/ozon-count/Юнит-экономика_01.01.2026-31.01.2026 (3).csv', 'utf8');

// Find header
const lines = fileContent.split(/\r?\n/);
let headerIndex = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Выручка') && lines[i].includes('Баллы за скидки')) {
        headerIndex = i;
        break;
    }
}

const csvContent = lines.slice(headerIndex).join('\n');

const parseCurrency = (value: string): number => {
    if (!value) return 0;
    const cleanValue = value.replace(/[^\d,\.-]/g, "").replace(",", ".");
    const number = parseFloat(cleanValue);
    return isNaN(number) ? 0 : number;
};

Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
        const rows = results.data.slice(0, 5); // Check first 5 rows
        console.log('--- Comparison ---\n');

        rows.forEach((row: any, index) => {
            const getVal = (key: string) => row[key] ? parseCurrency(row[key]) : 0;

            const revenue = getVal("Выручка");
            const discountPoints = getVal("Баллы за скидки");
            const partnerPrograms = getVal("Программы партнёров");
            const income = revenue + discountPoints + partnerPrograms;

            // Costs from my Logic
            const commission = getVal("Вознаграждение Ozon"); // usually negative
            const acquiring = getVal("Эквайринг");

            // Logistics
            let logistics = 0;
            logistics += getVal("Обработка отправления");
            logistics += getVal("Логистика");
            logistics += getVal("Доставка до места выдачи");
            logistics += getVal("Стоимость размещения");

            // Returns
            let returnsCost = 0;
            returnsCost += getVal("Обработка возврата");
            returnsCost += getVal("Обратная логистика");

            // Additional
            let additional = 0;
            additional += getVal("Утилизация");
            additional += getVal("Обработка ошибок продавца");

            // Promo
            let promo = 0;
            promo += getVal("Оплата за клик");
            promo += getVal("Оплата за заказ");
            promo += getVal("Звёздные товары");
            promo += getVal("Платный бренд");

            // COGS
            const delivered = getVal("Доставлено товаров, шт");
            const returned = getVal("Возвращено товаров, шт");
            const unitCost = getVal("Себестоимость");
            const totalCogs = -(unitCost * delivered);
            const totalCogsNet = -(unitCost * (delivered - returned));

            const myTotalCosts = commission + acquiring + logistics + returnsCost + additional + promo + totalCogs;

            const myProfit = income + myTotalCosts; // costs are negative

            const csvProfit = getVal("Прибыль за период");

            console.log(`Row ${index + 1}: ${row['Артикул'] || 'Unknown'}`);
            console.log(`  Delivered: ${delivered}, Returned: ${returned}`);
            console.log(`  Income: ${income.toFixed(2)}`);
            console.log(`  Costs (Msg): ${myTotalCosts.toFixed(2)}`);
            console.log(`  My Profit (Gross COGS): ${myProfit.toFixed(2)}`);

            // Hypothesis: Maybe COGS should use Net Sales?
            const myProfitNet = income + (myTotalCosts - totalCogs + totalCogsNet);
            console.log(`  My Profit (Net COGS):   ${myProfitNet.toFixed(2)}`);

            console.log(`  CSV Profit:             ${csvProfit.toFixed(2)}`);
            console.log(`  Diff (Gross):           ${(myProfit - csvProfit).toFixed(2)}`);
            console.log('\n');
        });
    }
});

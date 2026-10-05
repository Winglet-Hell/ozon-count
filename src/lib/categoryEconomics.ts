import type { AccrualsSummary } from "./parseAccruals";
import { computeVat, splitFlowForVat } from "./vat";

/** Вид товара по артикулу: «6-835-4/1-38-39. Чуни темно-бежевые» → «Чуни» */
export const getCategoryFromArticle = (article: string): string => {
  const artLower = article.toLowerCase();
  if (artLower.includes("тапоч") || artLower.includes("тапок")) return "Тапочки";
  if (artLower.includes("жилет")) return "Жилеты";
  if (artLower.includes("рубашк")) return "Рубашки";
  if (artLower.includes("носк")) return "Носки";
  // Новые виды товара — по первому слову после артикула
  const kind = article.match(/\.\s+([А-Яа-яЁёA-Za-z]+)/)?.[1];
  return kind ? kind[0].toUpperCase() + kind.slice(1).toLowerCase() : "Прочее";
};

export interface CategoryEconomics {
  name: string;
  sold: number;
  returned: number;
  /** Продажи с НДС — выручка, баллы и программы партнеров до возвратов, как база всей страницы */
  sales: number;
  cogs: number;
  vatPayable: number;
  profit: number;
  /** Чистая прибыль к продажам с НДС */
  margin: number | null;
}

/**
 * Прибыль по категориям — та же модель, что «Реальная экономика», разложенная по видам товара.
 * Категория получает начисления своих артикулов, а начисления без артикула (оплата за клик,
 * кросс-докинг, страхование) — пропорционально проданным штукам. НДС считается теми же правилами,
 * налог на прибыль — линейно, поэтому в сумме категории дают ровно итог периода.
 */
export function buildCategoryEconomics(
  report: AccrualsSummary,
  skuCogs: Record<string, number>,
  settings: { vatRate: number; cogsVatShare: number; incomeTaxRate: number }
): CategoryEconomics[] {
  interface Acc { sold: number; returned: number; sales: number; cogs: number; items: Map<string, { group: string; type: string; amount: number }> }
  const categories = new Map<string, Acc>();
  const withoutArticle = new Map<string, { group: string; type: string; amount: number }>();
  report.breakdown.forEach(({ group, type, amount }) => withoutArticle.set(`${group}::${type}`, { group, type, amount }));

  const addItem = (acc: Acc, group: string, type: string, amount: number) => {
    const key = `${group}::${type}`;
    const item = acc.items.get(key);
    if (item) item.amount += amount;
    else acc.items.set(key, { group, type, amount });
  };

  for (const tx of report.skuTransactions) {
    const name = getCategoryFromArticle(tx.sku);
    let acc = categories.get(name);
    if (!acc) categories.set(name, (acc = { sold: 0, returned: 0, sales: 0, cogs: 0, items: new Map() }));

    addItem(acc, tx.group, tx.type, tx.amount);
    const rest = withoutArticle.get(`${tx.group}::${tx.type}`);
    if (rest) rest.amount -= tx.amount;

    if (tx.group.toLowerCase().includes("продажи")) acc.sales += tx.amount;
    const unitCogs = skuCogs[tx.sku] || 0;
    if (tx.group === "Продажи" && tx.type === "Выручка") {
      // Строка выручки с минусом — сторно продажи: единицу она забирает
      const units = tx.amount < 0 ? -tx.quantity : tx.quantity;
      acc.sold += units;
      acc.cogs += units * unitCogs;
    } else if (tx.group === "Возвраты" && tx.type === "Возврат выручки") {
      acc.returned += tx.quantity;
      acc.cogs -= tx.quantity * unitCogs;
    }
  }

  const totalSold = Array.from(categories.values()).reduce((sum, acc) => sum + acc.sold, 0);
  const taxRate = settings.incomeTaxRate / 100;

  return Array.from(categories.entries()).map(([name, acc]) => {
    const share = totalSold > 0 ? acc.sold / totalSold : 0;
    withoutArticle.forEach(({ group, type, amount }) => {
      if (Math.abs(amount) > 0.005) addItem(acc, group, type, amount * share);
    });
    const items = Array.from(acc.items.values());
    const payout = items.reduce((sum, item) => sum + item.amount, 0);
    const vat = computeVat(splitFlowForVat(items), acc.cogs, settings.vatRate, settings.cogsVatShare);
    const pretax = payout - acc.cogs - vat.vatPayable;
    const profit = pretax * (1 - taxRate);
    return {
      name,
      sold: acc.sold,
      returned: acc.returned,
      sales: acc.sales,
      cogs: acc.cogs,
      vatPayable: vat.vatPayable,
      profit,
      margin: acc.sales > 0 ? profit / acc.sales : null
    };
  });
}

import type { AccrualsSummary } from "./parseAccruals";
import { isVatFree, vatFraction } from "./vat";

/**
 * Юнит-экономика артикула по отчету начислений — та же модель, что «Реальная экономика»
 * на странице начислений, только в расчете на одну проданную единицу:
 *   • процент от цены — комиссия, эквайринг, продвижение в поиске и возвраты
 *     (сторно выручки, баллов и программ партнеров; возвращенная комиссия их уменьшает);
 *   • фиксированные на единицу — логистика, доставка, обратная логистика, упаковка, хранение и прочее;
 *   • без входящего НДС (услуги партнеров, страхование, компенсации, штрафы) — отдельно: по ним нет вычета;
 *   • себестоимость — только за единицы, которые не вернулись на склад.
 * Расходы без артикула (оплата за клик, кросс-докинг, страхование) и расходы артикулов без продаж
 * в периоде (логистика невыкупов, хвосты прошлых продаж) распределяются на все проданные единицы.
 */
export interface SkuMetrics {
  /** Расходы «процент от цены» как доля того, что получает продавец */
  pct: number;
  /** Часть pct без входящего НДС — эквайринг */
  pctVatFree: number;
  /** На проданную единицу: услуги Ozon с НДС */
  fixedVatable: number;
  /** На проданную единицу: услуги партнеров, страхование, компенсации и штрафы без НДС */
  fixedVatFree: number;
  /** Доля проданных единиц, вернувшихся на склад: их себестоимость не списывается */
  returnShare: number;
  /** Продано единиц за период */
  quantity: number;
}

export interface SkuEconomicsModel {
  bySku: Record<string, SkuMetrics>;
  /** Средние по магазину — для артикулов без продаж в отчете */
  average: SkuMetrics;
  /** Расходы без артикула на проданную единицу — добавляются каждому артикулу */
  globalFixed: { vatable: number; vatFree: number };
}

export interface UnitEconomics {
  pct: number;
  pctVatFree: number;
  fixedVatable: number;
  fixedVatFree: number;
  /** Себестоимость на проданную единицу за вычетом возвратов на склад */
  cogs: number;
  quantity: number;
}

export interface TaxSettings {
  vatRate: number;
  cogsVatShare: number;
  incomeTaxRate: number;
}

const isPercentOfPrice = (group: string, type: string) => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  return (
    g.includes("возвраты") ||
    g.includes("вознаграждение") || t.includes("вознаграждение") || g.includes("комисси") || t.includes("комисси") ||
    g.includes("эквайринг") || t.includes("эквайринг") ||
    g.includes("продвижение в поиске") || t.includes("продвижение в поиске") ||
    t.includes("возврат выручки") || t.includes("баллы за скидки") || g.includes("баллы за скидки")
  );
};

// Продажи — с любым знаком: строка с минусом там — сторно продажи, она уменьшает выручку
const isRevenue = (group: string, type: string, amount: number) => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  return g === "продажи" || (amount > 0 && (t.includes("выручка") || t.includes("баллы за скидки") || g.includes("баллы за скидки")));
};

/**
 * Сколько «средних» единиц подмешиваем к истории артикула. У артикула с одной-двумя продажами метрики
 * случайны: одна продажа, вернувшаяся назад, дает 100% возвратов и безубыточность в квинтиллионы рублей.
 * Поэтому метрики артикула тянутся к средним магазина тем сильнее, чем меньше у него продаж:
 * при 1 продаже своя история весит 1/6, при 50 — 91%, при 300 — 98%.
 */
const PRIOR_UNITS = 5;

interface SkuTotals {
  revenue: number;
  pctCost: number;
  pctVatFree: number;
  fixedVatable: number;
  fixedVatFree: number;
  quantity: number;
  returned: number;
}

const emptyTotals = (): SkuTotals => ({
  revenue: 0, pctCost: 0, pctVatFree: 0, fixedVatable: 0, fixedVatFree: 0, quantity: 0, returned: 0
});

export function buildSkuEconomics(accruals: AccrualsSummary): SkuEconomicsModel {
  const perSku: Record<string, SkuTotals> = {};
  // Остаток каждой группы::типа после вычета строк с артикулом — начисления без артикула
  const withoutArticle: Record<string, { group: string; type: string; amount: number }> = {};
  accruals.breakdown.forEach((b) => {
    withoutArticle[`${b.group}::${b.type}`] = { group: b.group, type: b.type, amount: b.amount };
  });

  accruals.skuTransactions.forEach((tx) => {
    const key = `${tx.group}::${tx.type}`;
    if (withoutArticle[key]) withoutArticle[key].amount -= tx.amount;

    const sku = perSku[tx.sku] || (perSku[tx.sku] = emptyTotals());
    const lowerType = tx.type.toLowerCase();

    if (isRevenue(tx.group, tx.type, tx.amount)) {
      sku.revenue += tx.amount;
    } else if (isPercentOfPrice(tx.group, tx.type)) {
      sku.pctCost -= tx.amount; // refunds (positive) reduce the percent cost
      if (isVatFree(tx.group, tx.type)) sku.pctVatFree -= tx.amount;
    } else if (isVatFree(tx.group, tx.type)) {
      sku.fixedVatFree -= tx.amount;
    } else {
      sku.fixedVatable -= tx.amount;
    }

    // Units sold — only from revenue rows, so compensation rows aren't double counted.
    // A negative revenue row is a sale reversal: its quantity is positive, but it takes the unit back
    if (tx.group === "Продажи" && tx.quantity > 0 && (lowerType.includes("выручка") || lowerType.includes("доставлен покупателю"))) {
      sku.quantity += tx.amount < 0 ? -tx.quantity : tx.quantity;
    }
    if (tx.group === "Возвраты" && lowerType.includes("возврат выручки")) {
      sku.returned += tx.quantity;
    }
  });

  let globalVatable = 0;
  let globalVatFree = 0;
  Object.values(withoutArticle).forEach(({ group, type, amount }) => {
    if (isVatFree(group, type)) globalVatFree -= amount;
    else globalVatable -= amount;
  });

  const withSales: [string, SkuTotals][] = [];
  const totals = emptyTotals();
  for (const [article, d] of Object.entries(perSku)) {
    if (d.quantity <= 0 || d.revenue <= 0) {
      // Без продаж долю от цены не посчитать: такой артикул берет средние магазина, а его расходы
      // уходят в общий котел. Чистый итог идет как услуга с НДС: выручка увеличивает НДС к уплате
      // ровно так, как услуга с НДС его уменьшает
      globalVatable += d.pctCost - d.pctVatFree + d.fixedVatable - d.revenue;
      globalVatFree += d.pctVatFree + d.fixedVatFree;
      continue;
    }
    withSales.push([article, d]);
    totals.revenue += d.revenue;
    totals.pctCost += d.pctCost;
    totals.pctVatFree += d.pctVatFree;
    totals.fixedVatable += d.fixedVatable;
    totals.fixedVatFree += d.fixedVatFree;
    totals.quantity += d.quantity;
    totals.returned += d.returned;
  }

  if (globalVatable + globalVatFree < 0) { globalVatable = 0; globalVatFree = 0; }
  const perUnit = (value: number) => (totals.quantity > 0 ? value / totals.quantity : 0);

  const average: SkuMetrics = {
    pct: totals.revenue > 0 ? totals.pctCost / totals.revenue : 0,
    pctVatFree: totals.revenue > 0 ? totals.pctVatFree / totals.revenue : 0,
    fixedVatable: perUnit(totals.fixedVatable),
    fixedVatFree: perUnit(totals.fixedVatFree),
    returnShare: totals.quantity > 0 ? Math.min(1, totals.returned / totals.quantity) : 0,
    quantity: 0
  };

  const bySku: Record<string, SkuMetrics> = {};
  for (const [article, d] of withSales) {
    const blend = (own: number, avg: number) => (own * d.quantity + avg * PRIOR_UNITS) / (d.quantity + PRIOR_UNITS);
    bySku[article] = {
      pct: blend(d.pctCost / d.revenue, average.pct),
      pctVatFree: blend(d.pctVatFree / d.revenue, average.pctVatFree),
      fixedVatable: blend(d.fixedVatable / d.quantity, average.fixedVatable),
      fixedVatFree: blend(d.fixedVatFree / d.quantity, average.fixedVatFree),
      returnShare: blend(Math.min(1, d.returned / d.quantity), average.returnShare),
      quantity: d.quantity
    };
  }

  return {
    bySku,
    average,
    globalFixed: { vatable: perUnit(globalVatable), vatFree: perUnit(globalVatFree) }
  };
}

/**
 * Все, что нужно для цены одной единицы. Артикулы без продаж берут средние магазина.
 * Null без себестоимости: прогноз без нее ввел бы в заблуждение.
 */
export function skuUnitEconomics(model: SkuEconomicsModel, article: string, cogs: number): UnitEconomics | null {
  if (cogs <= 0) return null;
  const metrics = model.bySku[article] ?? model.average;
  if (metrics.pct >= 1) return null;
  return {
    pct: metrics.pct,
    pctVatFree: metrics.pctVatFree,
    fixedVatable: metrics.fixedVatable + model.globalFixed.vatable,
    fixedVatFree: metrics.fixedVatFree + model.globalFixed.vatFree,
    cogs: cogs * (1 - metrics.returnShare),
    quantity: metrics.quantity
  };
}

/**
 * Прибыль до налога на прибыль с единицы: цена − расходы Ozon − себестоимость − НДС к уплате.
 * НДС к уплате = НДС с цены за вычетом возвратов − вычеты по услугам Ozon с НДС и по доле себестоимости с НДС.
 */
export function pretaxProfitAt(econ: UnitEconomics, price: number, tax: TaxSettings): number {
  const r = vatFraction(tax.vatRate);
  const pctCost = price * econ.pct;
  const vatPayable =
    r * (price - price * (econ.pct - econ.pctVatFree) - econ.fixedVatable) -
    r * econ.cogs * (tax.cogsVatShare / 100);
  return price - pctCost - econ.fixedVatable - econ.fixedVatFree - econ.cogs - vatPayable;
}

/**
 * Чистая прибыль с единицы. Налог на прибыль — линейно, убыток его уменьшает: в прибыльном магазине
 * убыточный артикул снижает общий налог, поэтому сумма по артикулам сходится с итогом периода.
 */
export function profitAt(econ: UnitEconomics, price: number, tax: TaxSettings): number {
  return pretaxProfitAt(econ, price, tax) * (1 - tax.incomeTaxRate / 100);
}

/** Безубыточность (маржа 0%): цена, при которой прибыль до налога равна нулю, — решение pretaxProfitAt */
export function breakEvenOf(econ: UnitEconomics, tax: TaxSettings): number | null {
  const r = vatFraction(tax.vatRate);
  const cogsVat = tax.cogsVatShare / 100;
  const numerator = econ.fixedVatable * (1 - r) + econ.fixedVatFree + econ.cogs * (1 - r * cogsVat);
  // Доля цены, что остается после процентных расходов и НДС. Меньше процента — цены безубыточности нет
  const denominator = (1 - r) * (1 - econ.pct) - r * econ.pctVatFree;
  return denominator > 0.01 ? numerator / denominator : null;
}

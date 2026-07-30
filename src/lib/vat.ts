/**
 * НДС на ОСНО.
 *
 * Ozon перечисляет продавцу выручку и удерживает свои услуги брутто — с НДС.
 * Поэтому в «Финансовом потоке Ozon» НДС не участвует: он возникает только
 * в расчетах с бюджетом и считается в блоке «Реальная экономика».
 */

/** Общая ставка НДС с 01.01.2026 */
export const DEFAULT_VAT_RATE = 22;

/**
 * Общая ставка налога на прибыль с 01.01.2025. Держим настройкой, а не константой:
 * регион может понижать свою часть (17 из 25 п.п.) для отдельных категорий плательщиков.
 */
export const DEFAULT_INCOME_TAX_RATE = 25;

/**
 * Доля себестоимости, по которой есть входящий НДС: покупные материалы, сырье,
 * энергия, услуги подрядчиков. Зарплата, страховые взносы и амортизация НДС
 * не облагаются, поэтому у собственного производства доля заметно ниже 100%.
 */
export const DEFAULT_COGS_VAT_SHARE = 70;

/** Расчетная ставка: 22% -> доля 22/122 в сумме, которая уже включает НДС */
export const vatFraction = (rate: number): number => rate / (100 + rate);

/** Группы отчета, формирующие налоговую базу: продажи и возвраты. */
const isRevenueGroup = (group: string): boolean => {
  const g = group.toLowerCase();
  return g.includes("продажи") || g.includes("возвраты");
};

/**
 * Начисления вне НДС: компенсации ущерба, декомпенсации, штрафы и пени.
 *
 * Проверяем по типу начисления, а не по группе: в группе «Другие услуги и штрафы»
 * вместе со штрафами лежат обычные услуги Ozon с НДС — упаковка, утилизация.
 */
const VAT_FREE_KEYWORDS = [
  "компенсац",
  "штраф",
  "пени",
  "неустойк",
  "превышение индекса",
  "нерекомендованный слот"
];

export const isVatFree = (type: string): boolean => {
  const t = type.toLowerCase();
  return VAT_FREE_KEYWORDS.some((k) => t.includes(k));
};

export interface VatFlowSplit {
  /** Реализация с НДС: продажи за вычетом возвратов */
  revenueGross: number;
  /** Услуги Ozon с НДС, положительное число */
  servicesVatableGross: number;
  /** Компенсации и штрафы вне НДС, положительное число */
  servicesVatFreeGross: number;
}

/**
 * Раскладывает начисления отчета на базу НДС, услуги с вычетом и операции вне НДС.
 * Работает и с фактическим, и со смоделированным списком операций.
 */
export const splitFlowForVat = (
  items: { group: string; type: string; amount: number }[]
): VatFlowSplit => {
  let revenueGross = 0;
  let servicesVatableGross = 0;
  let servicesVatFreeGross = 0;

  items.forEach(({ group, type, amount }) => {
    if (isRevenueGroup(group)) {
      revenueGross += amount;
    } else if (isVatFree(type)) {
      servicesVatFreeGross -= amount;
    } else {
      servicesVatableGross -= amount;
    }
  });

  return { revenueGross, servicesVatableGross, servicesVatFreeGross };
};

export interface VatResult extends VatFlowSplit {
  rate: number;
  cogsVatShare: number;
  vatOutput: number;
  vatInputServices: number;
  vatInputCogs: number;
  vatInputTotal: number;
  /** Отрицательное значение — НДС к возмещению из бюджета */
  vatPayable: number;
  revenueNet: number;
  servicesNet: number;
  cogsNet: number;
}

/**
 * Себестоимость приходит с НДС — так она заведена в базе, по цене оплаты поставщикам.
 * Поэтому вычет считается по расчетной ставке (22/122), а в базу налога на прибыль
 * идет себестоимость за вычетом принятого к вычету НДС.
 */
export const computeVat = (
  flow: VatFlowSplit,
  cogsGross: number,
  rate: number,
  cogsVatShare: number
): VatResult => {
  const r = vatFraction(rate);

  const vatOutput = flow.revenueGross * r;
  const vatInputServices = flow.servicesVatableGross * r;
  const vatInputCogs = cogsGross * (cogsVatShare / 100) * r;
  const vatInputTotal = vatInputServices + vatInputCogs;

  return {
    ...flow,
    rate,
    cogsVatShare,
    vatOutput,
    vatInputServices,
    vatInputCogs,
    vatInputTotal,
    vatPayable: vatOutput - vatInputTotal,
    revenueNet: flow.revenueGross - vatOutput,
    servicesNet: flow.servicesVatableGross - vatInputServices + flow.servicesVatFreeGross,
    cogsNet: cogsGross - vatInputCogs
  };
};

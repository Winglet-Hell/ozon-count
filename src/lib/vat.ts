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
 * Начисления без входящего НДС — по ним нет вычета. Сверено с документами Ozon за сентябрь 2026:
 *
 * • Группа «Услуги партнёров» — доставка до места выдачи, эквайринг, упаковка и обработка
 *   невыкупов партнёрами, drop-off, временное размещение. Ozon перевыставляет их как агент,
 *   а исполнители в основном работают без НДС: по «Отчёту о перевыставлении услуг» НДС в них
 *   0,6% от суммы, а не 22/122.
 * • Страхование товара — не облагается (пп. 7 п. 3 ст. 149 НК РФ, «Акт о страховой премии»).
 * • Компенсации, декомпенсации, штрафы и пени — в УПД их нет.
 *
 * Собственные услуги Ozon — вознаграждение, логистика FBO/FBS, кросс-докинг, реклама, упаковочные
 * материалы, утилизация — приходят в УПД по ставке 22%. Поэтому кроме групп проверяем тип начисления:
 * в группе «Другие услуги и штрафы» штрафы лежат вместе с такими услугами.
 */
const VAT_FREE_GROUPS = ["услуги партн"];

const VAT_FREE_KEYWORDS = [
  "компенсац",
  "штраф",
  "пени",
  "неустойк",
  "превышение индекса",
  "нерекомендованный слот",
  "жалоб",
  "страхован"
];

export const isVatFree = (group: string, type: string): boolean => {
  const g = group.toLowerCase();
  const t = type.toLowerCase();
  return VAT_FREE_GROUPS.some((k) => g.includes(k)) || VAT_FREE_KEYWORDS.some((k) => t.includes(k));
};

export interface VatFlowSplit {
  /** Реализация с НДС: продажи за вычетом возвратов */
  revenueGross: number;
  /** Услуги Ozon с НДС, положительное число */
  servicesVatableGross: number;
  /** Услуги партнёров, страхование, компенсации и штрафы без входящего НДС, положительное число */
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
    } else if (isVatFree(group, type)) {
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

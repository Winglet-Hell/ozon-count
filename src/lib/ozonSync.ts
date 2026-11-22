import type { AutoPromoSwitches, OzonChange } from "./repricer";
import type { OzonLivePrice, OzonPriceUpdate } from "./ozonApi";

/**
 * Отправка изменений шаблона в Ozon через API. Здесь только расчеты, без сети: что отправить, что изменилось
 * в Ozon после скачивания шаблона и применились ли отправленные значения.
 */

/** Цена в Ozon уже не та, что в шаблоне: ее поменяли после скачивания, и новая цена считалась от старой */
export interface StaleItem {
  article: string;
  templatePrice: number;
  ozonPrice: number;
}

export interface SendPlan {
  /** Товары, которые есть в Ozon, — им можно отправлять */
  ready: OzonChange[];
  stale: StaleItem[];
  /** Артикулы, которых нет в Ozon или которые в архиве: отправлять некуда */
  missing: string[];
  live: Map<string, OzonLivePrice>;
  checkedAt: Date;
}

/** Деньги сравниваем с точностью до копейки: Excel и Ozon могут хранить 1290 и 1290.00 */
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function planSend(changes: OzonChange[], templatePrices: Map<string, number>, live: Map<string, OzonLivePrice>): SendPlan {
  const plan: SendPlan = { ready: [], stale: [], missing: [], live, checkedAt: new Date() };

  for (const change of changes) {
    const current = live.get(change.article);
    if (!current) {
      plan.missing.push(change.article);
      continue;
    }
    plan.ready.push(change);

    // Для одной себестоимости старая цена не важна: цену не трогаем
    const templatePrice = templatePrices.get(change.article);
    if (change.price !== null && templatePrice !== undefined && !sameMoney(templatePrice, current.price)) {
      plan.stale.push({ article: change.article, templatePrice, ozonPrice: current.price });
    }
  }
  return plan;
}

const money = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Строка запроса — те же значения, что попали бы в файл. Чего в файле не было бы, не передаем,
 * и Ozon оставляет это как есть
 */
export function toPriceUpdate(change: OzonChange, live: OzonLivePrice, switches: AutoPromoSwitches): OzonPriceUpdate {
  const update: OzonPriceUpdate = { offer_id: change.article };

  if (change.price !== null) {
    update.price = money(change.price);
    if (change.oldPrice !== null) update.old_price = money(change.oldPrice);
    if (change.minPrice !== null) update.min_price = money(change.minPrice);
    if (switches.autoActions) update.auto_action_enabled = "DISABLED";
    if (switches.autoAdd) update.auto_add_to_ozon_actions_list_enabled = "DISABLED";
    // НДС и валюта — текущие, из Ozon: метод просит передавать действующую ставку, так она точно не собьется
    if (live.vat !== null) update.vat = live.vat;
    if (live.currencyCode) update.currency_code = live.currencyCode;
  }
  if (change.netPrice !== null) update.net_price = money(change.netPrice);

  return update;
}

export type CheckedField = "price" | "old_price" | "min_price" | "net_price";

export const FIELD_LABELS: Record<CheckedField, string> = {
  price: "цена",
  old_price: "зачеркнутая цена",
  min_price: "ограничение для акций",
  net_price: "себестоимость"
};

export interface Mismatch {
  article: string;
  field: CheckedField;
  sent: number;
  /** null — в Ozon значения нет */
  ozon: number | null;
}

export interface Verification {
  checkedAt: Date;
  /** Все отправленные значения уже стоят в Ozon */
  confirmed: string[];
  mismatches: Mismatch[];
  /** Пропали из ответа Ozon */
  missing: string[];
}

const liveValue = (live: OzonLivePrice, field: CheckedField): number | null => {
  switch (field) {
    case "price": return live.price;
    case "old_price": return live.oldPrice;
    case "min_price": return live.minPrice;
    case "net_price": return live.netPrice;
  }
};

/** Совпадает ли то, что сейчас в Ozon, с отправленным */
export function verifyUpdates(updates: OzonPriceUpdate[], live: Map<string, OzonLivePrice>): Verification {
  const verification: Verification = { checkedAt: new Date(), confirmed: [], mismatches: [], missing: [] };

  for (const update of updates) {
    const current = live.get(update.offer_id);
    if (!current) {
      verification.missing.push(update.offer_id);
      continue;
    }
    let matches = true;
    for (const field of Object.keys(FIELD_LABELS) as CheckedField[]) {
      const sentText = update[field];
      if (sentText === undefined) continue;
      const sent = Number(sentText);
      const ozon = liveValue(current, field);
      if (ozon === null || !sameMoney(sent, ozon)) {
        matches = false;
        verification.mismatches.push({ article: update.offer_id, field, sent, ozon });
      }
    }
    if (matches) verification.confirmed.push(update.offer_id);
  }
  return verification;
}

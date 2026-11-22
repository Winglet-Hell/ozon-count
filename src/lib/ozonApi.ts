/**
 * Ozon Seller API прямо из браузера. Ozon разрешает такие запросы (CORS), поэтому своему сайту сервер не нужен:
 * ключ хранится только в этом браузере и уходит только на api-seller.ozon.ru.
 * Документация: https://docs.ozon.ru/api/seller/
 */

const API_URL = "https://api-seller.ozon.ru";

/** И чтение цен, и обновление берут до 1000 товаров за запрос */
export const OZON_BATCH = 1000;

/** Сколько раз повторить запрос, если Ozon просит подождать или сбоит у себя */
const RETRIES = 2;

export interface OzonCredentials {
  clientId: string;
  apiKey: string;
}

export class OzonApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OzonApiError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(status: number, ozonMessage: string | undefined): string {
  const detail = ozonMessage ? ` Ответ Ozon: «${ozonMessage}».` : "";
  if (status === 401) return `Ozon не принял ключ: проверьте Client ID и API-ключ — возможно, ключ истек или удален.${detail}`;
  if (status === 403) return `У ключа нет доступа к этому действию: нужна роль Product.${detail}`;
  if (status === 429) return "Ozon просит подождать: слишком много запросов. Попробуйте через минуту.";
  if (status >= 500) return `Ozon временно не отвечает (ошибка ${status}). Попробуйте позже.${detail}`;
  return `Ozon отклонил запрос (ошибка ${status}).${detail}`;
}

async function call<T>(credentials: OzonCredentials, path: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: {
          "Client-Id": credentials.clientId,
          "Api-Key": credentials.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw new OzonApiError("Нет связи с Ozon: проверьте интернет и попробуйте еще раз.", 0);
    }

    // Повтор безопасен и для обновления цен: он записывает те же значения
    if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
      await sleep(1500 * (attempt + 1));
      continue;
    }

    const data: unknown = await response.json().catch(() => null);
    if (response.ok) return data as T;

    const message = typeof data === "object" && data !== null && "message" in data ? String(data.message) : undefined;
    throw new OzonApiError(errorMessage(response.status, message), response.status);
  }
}

/** Методы, без которых отправить цены не получится */
export const REQUIRED_METHODS = ["/v5/product/info/prices", "/v1/product/import/prices"];

export interface OzonKeyInfo {
  /** Когда ключ перестанет работать, ISO; null — Ozon не сообщил */
  expiresAt: string | null;
  roles: string[];
  /** Методы из REQUIRED_METHODS, которых у ключа нет */
  missing: string[];
}

const normalizeMethod = (method: string) => method.slice(Math.max(0, method.indexOf("/"))).replace(/\/+$/, "");

/** Срок действия ключа и его роли — заодно проверка, что Ozon вообще принимает ключ */
export async function fetchKeyInfo(credentials: OzonCredentials): Promise<OzonKeyInfo> {
  const data = await call<{ expires_at?: string; roles?: { name?: string; methods?: string[] }[] }>(credentials, "/v1/roles", {});
  const roles = data?.roles ?? [];
  const methods = new Set(roles.flatMap((role) => (role.methods ?? []).map(normalizeMethod)));
  const names = roles.map((role) => role.name ?? "").filter(Boolean);
  // Пустой список методов или роль администратора — проверять нечего: не блокируем ключ из-за формата ответа
  const checkable = methods.size > 0 && !names.some((name) => /admin|админ/i.test(name));

  return {
    expiresAt: data?.expires_at || null,
    roles: names,
    missing: checkable ? REQUIRED_METHODS.filter((method) => !methods.has(method)) : []
  };
}

/** Что сейчас стоит в Ozon у товара */
export interface OzonLivePrice {
  article: string;
  /** «Предельная цена» */
  price: number;
  /** Зачеркнутая цена; 0 — нет */
  oldPrice: number;
  /** «Ограничение для акций и стратегий»; 0 — нет */
  minPrice: number;
  /** null — себестоимость в Ozon не задана */
  netPrice: number | null;
  /** Ставка НДС в виде, в котором ее принимает обновление цены («0.22»); null — неизвестна */
  vat: string | null;
  currencyCode: string | null;
}

interface PriceInfoItem {
  offer_id?: string;
  price?: {
    price?: number | string;
    old_price?: number | string;
    min_price?: number | string;
    net_price?: number | string;
    vat?: number | string;
    currency_code?: string;
  };
}

const toNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** Ставки, которые Ozon принимает при обновлении цены */
const VAT_RATES = [0, 0.05, 0.07, 0.1, 0.2, 0.22];

export function ozonVat(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const rate = Number(value);
  const known = VAT_RATES.find((candidate) => Math.abs(candidate - rate) < 1e-6);
  return known === undefined ? null : String(known);
}

/** Текущие цены по артикулам. Артикула, которого нет в Ozon или который в архиве, в ответе не будет */
export async function fetchLivePrices(credentials: OzonCredentials, articles: string[]): Promise<Map<string, OzonLivePrice>> {
  const prices = new Map<string, OzonLivePrice>();

  for (let start = 0; start < articles.length; start += OZON_BATCH) {
    const chunk = articles.slice(start, start + OZON_BATCH);
    let cursor = "";
    // Артикулов в запросе не больше, чем товаров на странице, но курсор все равно проходим — на случай, если Ozon разобьет ответ
    for (let page = 0; page < 20; page++) {
      const data = await call<{ items?: PriceInfoItem[]; cursor?: string }>(credentials, "/v5/product/info/prices", {
        cursor,
        filter: { offer_id: chunk, visibility: "ALL" },
        limit: OZON_BATCH
      });
      const items = data?.items ?? [];
      for (const item of items) {
        if (!item.offer_id) continue;
        const netPrice = toNumber(item.price?.net_price);
        prices.set(item.offer_id, {
          article: item.offer_id,
          price: toNumber(item.price?.price),
          oldPrice: toNumber(item.price?.old_price),
          minPrice: toNumber(item.price?.min_price),
          netPrice: netPrice > 0 ? netPrice : null,
          vat: ozonVat(item.price?.vat),
          currencyCode: item.price?.currency_code || null
        });
      }
      cursor = data?.cursor ?? "";
      if (!cursor || items.length < OZON_BATCH) break;
    }
  }
  return prices;
}

/** Строка запроса на обновление цены. Чего нет — Ozon оставляет как есть */
export interface OzonPriceUpdate {
  offer_id: string;
  price?: string;
  old_price?: string;
  min_price?: string;
  net_price?: string;
  auto_action_enabled?: "DISABLED";
  auto_add_to_ozon_actions_list_enabled?: "DISABLED";
  currency_code?: string;
  vat?: string;
}

export interface OzonUpdateResult {
  article: string;
  updated: boolean;
  errors: { code: string; message: string }[];
}

/** Запрос не дошел или Ozon ответил ошибкой на весь запрос: применилось ли что-то, покажет только проверка */
export const REQUEST_FAILED = "REQUEST_FAILED";

/**
 * Обновление цен. Ozon отвечает по каждому товару: принял или нет и почему.
 * Каждую цену можно менять не чаще 10 раз в час
 */
export async function importPrices(credentials: OzonCredentials, updates: OzonPriceUpdate[]): Promise<OzonUpdateResult[]> {
  const results: OzonUpdateResult[] = [];

  for (let start = 0; start < updates.length; start += OZON_BATCH) {
    const chunk = updates.slice(start, start + OZON_BATCH);
    try {
      const data = await call<{ result?: { offer_id?: string; updated?: boolean; errors?: { code?: string; message?: string }[] }[] }>(
        credentials,
        "/v1/product/import/prices",
        { prices: chunk }
      );
      const byArticle = new Map((data?.result ?? []).map((result) => [String(result.offer_id ?? ""), result]));
      for (const update of chunk) {
        const result = byArticle.get(update.offer_id);
        results.push(
          result
            ? {
                article: update.offer_id,
                updated: result.updated === true,
                errors: (result.errors ?? []).map((error) => ({ code: error.code ?? "", message: error.message ?? "" }))
              }
            : { article: update.offer_id, updated: false, errors: [{ code: "NO_RESULT", message: "Ozon не ответил по этому товару" }] }
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить запрос";
      for (const update of chunk) {
        results.push({ article: update.offer_id, updated: false, errors: [{ code: REQUEST_FAILED, message }] });
      }
    }
  }
  return results;
}

import * as XLSX from "xlsx";
import { resolveTemplateColumns, type ParsedTemplate, type RepricerItem } from "./repricer";
import { fetchAllPrices, fetchBarcodes, type OzonCredentials, type OzonLivePrice } from "./ozonApi";

/**
 * Репрайсер без шаблона: те же товары и поля, что в шаблоне обновления цен, но прямо из Ozon API.
 * Проверено на шаблоне и API за одну и ту же минуту: цены, зачеркнутая цена, ограничение для акций,
 * себестоимость, НДС и все три индекса совпали у всех товаров, поэтому «По индексу» считает те же цены.
 * Нет только цены для покупателя (без Premium Pro Ozon ее не отдает): колонка «Клиенту» берет скидку из отчета.
 */

/**
 * Колонки шаблона Ozon (как в шаблоне 22.11.2026), которые нужны Репрайсеру. Через них определяется,
 * что уходит в Ozon, — так отправка ведет себя точно как с файлом: новая цена, зачеркнутая, ограничение
 * для акций, себестоимость и выключенное автодобавление в акции
 */
const API_HEADERS = [
  "Артикул",
  "Зачёркнутая цена, руб.",
  "Предельная цена, руб.",
  "Цена реализации, руб.",
  "Ценовой индекс товара на рынке на мои товары",
  "Себестоимость",
  "Штрихкод",
  "Новая зачёркнутая цена, руб.",
  "Новая предельная цена, руб.",
  "Новая себестоимость",
  "Новое ограничение для акций и стратегий, руб.",
  "Автоматически добавлять товар в акции"
];

/** Тот же разбор, что у шаблона: товар без зачеркнутой цены выше текущей получает множитель 1,5 */
function toItem(price: OzonLivePrice, barcodes: string[]): RepricerItem {
  return {
    id: price.article,
    article: price.article,
    currentPrice: price.price,
    newPrice: null,
    multiplier: price.price > 0 && price.oldPrice > price.price ? price.oldPrice / price.price : 1.5,
    priceIndex: price.indexes.self,
    customerPrice: null,
    ozonDiscountPct: 0,
    rowIndex: -1,
    templateCogs: price.netPrice,
    barcodes
  };
}

export function buildApiTemplate(prices: OzonLivePrice[], barcodes: Map<string, string[]>, loadedAt: Date): ParsedTemplate {
  return {
    items: prices.map((price) => toItem(price, barcodes.get(price.article) ?? [])),
    workbook: XLSX.utils.book_new(),
    sheetName: "",
    headerRowIndex: -1,
    columns: resolveTemplateColumns(API_HEADERS),
    headers: API_HEADERS,
    source: "api",
    loadedAt: loadedAt.toISOString()
  };
}

/** Все товары, кроме архивных, с ценами, индексами, себестоимостью и штрихкодами */
export async function loadTemplateFromOzon(credentials: OzonCredentials): Promise<ParsedTemplate> {
  const prices = await fetchAllPrices(credentials);
  if (prices.length === 0) throw new Error("Ozon не вернул ни одного товара");
  const barcodes = await fetchBarcodes(credentials, prices.map((price) => price.article));
  return buildApiTemplate(prices, barcodes, new Date());
}

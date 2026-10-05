import type { AccrualsSummary } from "./parseAccruals";

/**
 * Данные, которые нужно помнить между перезагрузками страницы, — в хранилище браузера.
 * Подключаются через useSyncExternalStore: на сервере хранилища нет, и при гидрации React берет
 * пустой серверный снимок, а затем подставляет сохраненный.
 */
function createPersistentStore<T>(key: string, fallback: T, isValid: (value: unknown) => boolean) {
  let current: T | undefined;
  const listeners = new Set<() => void>();

  // Хранилище может быть недоступно (приватный режим, запрет сайта, переполнение) — тогда данные живут до перезагрузки
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const saved: unknown = JSON.parse(raw);
      return isValid(saved) ? (saved as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): T {
      if (current === undefined) current = read();
      return current;
    },

    getServerSnapshot(): T {
      return fallback;
    },

    set(value: T) {
      current = value;
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // see read()
      }
      listeners.forEach((listener) => listener());
    },

    update(change: (prev: T) => T) {
      store.set(change(store.getSnapshot()));
    }
  };
  return store;
}

type CogsRecord = Record<string, number>;

const EMPTY_COGS: CogsRecord = {};
const isRecord = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Введенная в приложении и взятая из учета себестоимость, которую Ozon еще не подтвердил */
export const cogsEditsStore = createPersistentStore<CogsRecord>("ozon-count:cogs-edits", EMPTY_COGS, isRecord);

/** Себестоимость из последних шаблонов Ozon: чтобы после перезагрузки не откатиться к старому файлу */
export const ozonCogsStore = createPersistentStore<CogsRecord>("ozon-count:ozon-cogs", EMPTY_COGS, isRecord);

/** Последний отчет о начислениях: свернутый по артикулам, он весит сотни килобайт, а грузится заново секунды */
export const accrualsReportStore = createPersistentStore<AccrualsSummary | null>(
  "ozon-count:accruals-report",
  null,
  (value) => isRecord(value) && Array.isArray((value as AccrualsSummary).breakdown) && Array.isArray((value as AccrualsSummary).skuTransactions)
);

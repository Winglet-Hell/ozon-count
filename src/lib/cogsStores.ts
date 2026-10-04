/**
 * Себестоимость, которую нужно помнить между перезагрузками страницы, — в хранилище браузера.
 * Подключается через useSyncExternalStore: на сервере хранилища нет, и при гидрации React берет
 * пустой серверный снимок, а затем подставляет сохраненный.
 */
type CogsRecord = Record<string, number>;

const SERVER_SNAPSHOT: CogsRecord = {};

function createCogsStore(key: string) {
  let current: CogsRecord | null = null;
  const listeners = new Set<() => void>();

  // Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда значения живут до перезагрузки
  const read = (): CogsRecord => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  };

  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): CogsRecord {
      if (current === null) current = read();
      return current;
    },

    getServerSnapshot(): CogsRecord {
      return SERVER_SNAPSHOT;
    },

    update(change: (prev: CogsRecord) => CogsRecord) {
      current = change(store.getSnapshot());
      try {
        localStorage.setItem(key, JSON.stringify(current));
      } catch {
        // see read()
      }
      listeners.forEach((listener) => listener());
    }
  };
  return store;
}

/** Введенная в приложении и взятая из учета себестоимость, которую Ozon еще не подтвердил */
export const cogsEditsStore = createCogsStore("ozon-count:cogs-edits");

/** Себестоимость из последних шаблонов Ozon: чтобы после перезагрузки не откатиться к старому файлу */
export const ozonCogsStore = createCogsStore("ozon-count:ozon-cogs");

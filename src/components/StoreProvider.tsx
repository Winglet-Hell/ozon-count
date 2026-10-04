"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { AccrualsSummary } from "@/lib/parseAccruals";
import { ParsedTemplate, RepricerItem } from "@/lib/repricer";
import { DEFAULT_VAT_RATE, DEFAULT_COGS_VAT_SHARE, DEFAULT_INCOME_TAX_RATE } from "@/lib/vat";
import { cogsEditsStore, ozonCogsStore } from "@/lib/cogsStores";

interface AppState {
  accrualsResult: AccrualsSummary | null;
  setAccrualsResult: React.Dispatch<React.SetStateAction<AccrualsSummary | null>>;

  repricerParsedData: ParsedTemplate | null;
  setRepricerParsedData: React.Dispatch<React.SetStateAction<ParsedTemplate | null>>;

  repricerItems: RepricerItem[];
  setRepricerItems: React.Dispatch<React.SetStateAction<RepricerItem[]>>;

  /** Себестоимость для расчетов: файлы, поверх — шаблон Ozon, поверх — введенная в приложении и взятая из учета */
  skuCogs: Record<string, number>;

  /** Себестоимость из загруженных файлов */
  fileCogs: Record<string, number>;
  setFileCogs: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  /** Себестоимость из последних шаблонов Ozon. Хранится в браузере */
  ozonCogs: Record<string, number>;

  /** Себестоимость, введенная в приложении или взятая из учета. Хранится в браузере, пока Ozon не вернет ее в шаблоне */
  cogsEdits: Record<string, number>;
  /** null — убрать правку и вернуться к значению из шаблона Ozon или файла */
  setCogsEdits: (edits: Record<string, number | null>) => void;
  /** Себестоимость из свежего шаблона Ozon; правки, которые Ozon уже сохранил, больше не нужны */
  mergeTemplateCogs: (templateCogs: Record<string, number>) => void;

  cogsFileName: string | null;
  setCogsFileName: React.Dispatch<React.SetStateAction<string | null>>;

  /** Ставка НДС, % */
  vatRate: number;
  setVatRate: React.Dispatch<React.SetStateAction<number>>;

  /** Доля себестоимости с входящим НДС, % */
  cogsVatShare: number;
  setCogsVatShare: React.Dispatch<React.SetStateAction<number>>;

  /** Ставка налога на прибыль, % */
  incomeTaxRate: number;
  setIncomeTaxRate: React.Dispatch<React.SetStateAction<number>>;
}

const AppStateContext = createContext<AppState | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [accrualsResult, setAccrualsResult] = useState<AccrualsSummary | null>(null);
  const [repricerParsedData, setRepricerParsedData] = useState<ParsedTemplate | null>(null);
  const [repricerItems, setRepricerItems] = useState<RepricerItem[]>([]);
  const [fileCogs, setFileCogs] = useState<Record<string, number>>({});
  const ozonCogs = useSyncExternalStore(ozonCogsStore.subscribe, ozonCogsStore.getSnapshot, ozonCogsStore.getServerSnapshot);
  const cogsEdits = useSyncExternalStore(cogsEditsStore.subscribe, cogsEditsStore.getSnapshot, cogsEditsStore.getServerSnapshot);
  const [cogsFileName, setCogsFileName] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState<number>(DEFAULT_VAT_RATE);
  const [cogsVatShare, setCogsVatShare] = useState<number>(DEFAULT_COGS_VAT_SHARE);
  const [incomeTaxRate, setIncomeTaxRate] = useState<number>(DEFAULT_INCOME_TAX_RATE);

  const setCogsEdits = useCallback((edits: Record<string, number | null>) => {
    cogsEditsStore.update((prev) => {
      const next = { ...prev };
      for (const [article, value] of Object.entries(edits)) {
        if (value === null) delete next[article];
        else next[article] = value;
      }
      return next;
    });
  }, []);

  const mergeTemplateCogs = useCallback((templateCogs: Record<string, number>) => {
    ozonCogsStore.update((prev) => ({ ...prev, ...templateCogs }));
    cogsEditsStore.update((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([article, value]) => templateCogs[article] !== value))
    );
  }, []);

  const skuCogs = useMemo(() => ({ ...fileCogs, ...ozonCogs, ...cogsEdits }), [fileCogs, ozonCogs, cogsEdits]);

  return (
    <AppStateContext.Provider value={{
      accrualsResult, setAccrualsResult,
      repricerParsedData, setRepricerParsedData,
      repricerItems, setRepricerItems,
      skuCogs,
      fileCogs, setFileCogs,
      ozonCogs,
      cogsEdits, setCogsEdits, mergeTemplateCogs,
      cogsFileName, setCogsFileName,
      vatRate, setVatRate,
      cogsVatShare, setCogsVatShare,
      incomeTaxRate, setIncomeTaxRate
    }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

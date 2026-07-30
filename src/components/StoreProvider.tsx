"use client";

import { createContext, useContext, useState } from "react";
import { AccrualsSummary } from "@/lib/parseAccruals";
import { ParsedTemplate, RepricerItem } from "@/lib/repricer";
import { DEFAULT_VAT_RATE, DEFAULT_COGS_VAT_SHARE, DEFAULT_INCOME_TAX_RATE } from "@/lib/vat";

interface AppState {
  accrualsResult: AccrualsSummary | null;
  setAccrualsResult: React.Dispatch<React.SetStateAction<AccrualsSummary | null>>;
  
  repricerParsedData: ParsedTemplate | null;
  setRepricerParsedData: React.Dispatch<React.SetStateAction<ParsedTemplate | null>>;
  
  repricerItems: RepricerItem[];
  setRepricerItems: React.Dispatch<React.SetStateAction<RepricerItem[]>>;

  skuCogs: Record<string, number>;
  setSkuCogs: React.Dispatch<React.SetStateAction<Record<string, number>>>;

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
  const [skuCogs, setSkuCogs] = useState<Record<string, number>>({});
  const [cogsFileName, setCogsFileName] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState<number>(DEFAULT_VAT_RATE);
  const [cogsVatShare, setCogsVatShare] = useState<number>(DEFAULT_COGS_VAT_SHARE);
  const [incomeTaxRate, setIncomeTaxRate] = useState<number>(DEFAULT_INCOME_TAX_RATE);

  return (
    <AppStateContext.Provider value={{
      accrualsResult, setAccrualsResult,
      repricerParsedData, setRepricerParsedData,
      repricerItems, setRepricerItems,
      skuCogs, setSkuCogs,
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

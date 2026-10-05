"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CogsSuggestion } from "@/lib/cogsSuggest";

/**
 * Поле себестоимости. Правка применяется по Enter или при уходе с поля, Esc ее отменяет:
 * пересчитывать всю страницу на каждую цифру незачем. Пустое поле показывает подсказку
 * по аналогу, галочка принимает ее одним кликом.
 */
export function CogsInput({
  value,
  suggestion,
  pending,
  onCommit,
  onDraft
}: {
  value: number | undefined;
  suggestion?: CogsSuggestion;
  /** Подсказка к синей точке: значение еще не в Ozon и уйдет туда при выгрузке */
  pending?: string;
  onCommit: (value: number | null) => void;
  /**
   * Что вписано, но еще не применено: число, null — поле очищено, undefined — применять нечего.
   * Страница применяет это сама перед выгрузкой: в Safari и Firefox клик по кнопке не уводит фокус с поля
   */
  onDraft?: (value: number | null | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const isEmpty = value === undefined;

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    onDraft?.(undefined);
    const text = draft.trim().replace(/\s/g, "").replace(",", ".");
    if (text === "") {
      if (!isEmpty) onCommit(null);
      return;
    }
    const next = parseFloat(text);
    if (next > 0 && next !== value) onCommit(next);
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <span
        className={cn("w-1.5 h-1.5 rounded-full shrink-0", pending ? "bg-blue-500" : "bg-transparent")}
        title={pending}
      />
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? (value ?? "")}
        placeholder={suggestion ? `≈ ${suggestion.value}` : "—"}
        title={isEmpty && suggestion ? `Подсказка по аналогу: ${suggestion.source}` : undefined}
        onFocus={(e) => {
          setDraft(isEmpty ? "" : String(value));
          e.target.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const text = e.target.value.trim().replace(/\s/g, "").replace(",", ".");
          const next = parseFloat(text);
          onDraft?.(text === "" ? (isEmpty ? undefined : null) : next > 0 && next !== value ? next : undefined);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            onDraft?.(undefined);
          }
        }}
        className={cn(
          "w-20 px-2 py-1.5 border rounded-lg text-sm font-medium text-right focus:outline-none focus:ring-2 transition-all",
          isEmpty
            ? "bg-amber-50 border-amber-300 placeholder:text-amber-700/50 focus:ring-amber-500/20 focus:border-amber-500"
            : "bg-white border-slate-200 focus:ring-blue-500/20 focus:border-blue-500"
        )}
      />
      {isEmpty && suggestion ? (
        <button
          onClick={() => onCommit(suggestion.value)}
          title={`Принять ${suggestion.value} ₽ — по аналогу ${suggestion.source}`}
          className="p-1 rounded-md text-amber-600 hover:bg-amber-100 hover:text-amber-700 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      ) : (
        <span className="w-[22px]" />
      )}
    </div>
  );
}

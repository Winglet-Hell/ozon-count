"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ozonConnectionStore } from "@/lib/persistentStores";
import { fetchKeyInfo, fetchLivePrices, importPrices, REQUEST_FAILED, type OzonPriceUpdate, type OzonUpdateResult } from "@/lib/ozonApi";
import { FIELD_LABELS, planSend, toPriceUpdate, verifyUpdates, type SendPlan, type Verification } from "@/lib/ozonSync";
import type { AutoPromoSwitches, OzonChange } from "@/lib/repricer";

/**
 * Отправка новых цен и себестоимости в Ozon через API: подключение ключа, сверка с Ozon перед отправкой,
 * подтверждение, ответ Ozon по каждому товару и проверка, что значения применились.
 */

const NUM0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Через сколько после отправки сверять: Ozon применяет цены не мгновенно */
const VERIFY_DELAY_MS = 4000;
/** Сколько артикулов перечислять, остальные — «и еще N» */
const LIST_LIMIT = 6;
/** Ключ скоро истекает — предупреждаем заранее, чтобы успеть выпустить новый */
const KEY_WARN_DAYS = 14;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Что-то пошло не так");

function plural(n: number, [one, few, many]: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «Уйдет 281 товар» */
const goods = (n: number) => `${NUM0.format(n)} ${plural(n, ["товар", "товара", "товаров"])}`;
/** «у 281 товара», «из 280 товаров» */
const goodsOf = (n: number) => `${NUM0.format(n)} ${plural(n, ["товара", "товаров", "товаров"])}`;

const listArticles = (articles: string[]) =>
  articles.length <= LIST_LIMIT
    ? articles.join(", ")
    : `${articles.slice(0, LIST_LIMIT).join(", ")} и еще ${articles.length - LIST_LIMIT}`;

const rub = (value: number) => `${NUM0.format(value)} ₽`;

export function useOzonConnection() {
  return useSyncExternalStore(ozonConnectionStore.subscribe, ozonConnectionStore.getSnapshot, ozonConnectionStore.getServerSnapshot);
}

interface KeyStatus {
  date: string;
  daysLeft: number;
  tone: "ok" | "soon" | "expired";
}

function keyStatus(expiresAt: string | null | undefined, now: number): KeyStatus | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  const daysLeft = Math.ceil((date.getTime() - now) / 86_400_000);
  return { date: DATE.format(date), daysLeft, tone: daysLeft <= 0 ? "expired" : daysLeft <= KEY_WARN_DAYS ? "soon" : "ok" };
}

/** Строка о подключении под кнопкой отправки: срок ключа видно заранее, а не когда Ozon перестанет его принимать */
export function OzonConnectionLink({ onClick }: { onClick: () => void }) {
  const connection = useOzonConnection();
  const [now] = useState(() => Date.now());
  const status = keyStatus(connection?.expiresAt, now);

  let text = "API не подключен";
  if (connection) {
    if (!status) text = "API подключен";
    else if (status.tone === "expired") text = "Ключ API истек";
    else if (status.tone === "soon") text = `Ключ API: осталось ${status.daysLeft} дн.`;
    else text = `API · ключ до ${status.date}`;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title="Подключение к Ozon API: ключ хранится только в этом браузере"
      className={cn(
        "underline decoration-dotted underline-offset-2 hover:text-blue-600",
        !connection && "text-blue-600",
        status?.tone === "soon" && "text-amber-600 font-semibold",
        status?.tone === "expired" && "text-rose-600 font-semibold"
      )}
    >
      {text}
    </button>
  );
}

function Modal({
  children,
  onClose,
  busy,
  labelledBy
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
  labelledBy: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-2xl p-5 sm:p-6 space-y-4"
      >
        {children}
      </div>
    </div>
  );
}

const primaryButton =
  "inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-sm transition-colors";
const secondaryButton =
  "inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors";

/** Окно подключения: Client ID и API-ключ, проверка ключа в Ozon перед сохранением */
export function OzonConnectDialog({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const connection = useOzonConnection();
  const [clientId, setClientId] = useState(connection?.clientId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const status = keyStatus(connection?.expiresAt, now);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    const credentials = { clientId: clientId.trim(), apiKey: apiKey.trim() };
    if (!/^\d+$/.test(credentials.clientId)) {
      setError("Client ID — это число из раздела Seller API в личном кабинете Ozon.");
      return;
    }
    if (!credentials.apiKey) {
      setError("Вставьте API-ключ.");
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const info = await fetchKeyInfo(credentials);
      if (info.missing.length > 0) {
        setError(`У этого ключа нет доступа к ценам (${info.missing.join(", ")}). Создайте ключ с ролью Product.`);
        return;
      }
      ozonConnectionStore.set({ ...credentials, expiresAt: info.expiresAt });
      onConnected();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const disconnect = () => {
    ozonConnectionStore.set(null);
    onClose();
  };

  return (
    <Modal onClose={onClose} busy={checking} labelledBy="ozon-connect-title">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h2 id="ozon-connect-title" className="text-base font-bold text-slate-900">Подключение к Ozon API</h2>
          <p className="text-sm text-slate-500 mt-0.5">Чтобы отправлять новые цены и себестоимость в Ozon без файла.</p>
        </div>
      </div>

      {connection && (
        <div
          className={cn(
            "px-3 py-2 rounded-xl text-sm border",
            status?.tone === "expired"
              ? "bg-rose-50 border-rose-100 text-rose-700"
              : status?.tone === "soon"
                ? "bg-amber-50 border-amber-100 text-amber-800"
                : "bg-emerald-50 border-emerald-100 text-emerald-800"
          )}
        >
          Подключен Client ID {connection.clientId}
          {status && (status.tone === "expired" ? `: ключ истек ${status.date} — вставьте новый.` : `, ключ действует до ${status.date}.`)}
          {status?.tone === "soon" && ` Осталось ${status.daysLeft} дн. — выпустите новый ключ заранее.`}
        </div>
      )}

      <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-1">
        <li>В личном кабинете Ozon: Настройки → API интеграции → Seller API.</li>
        <li>
          «Сгенерировать ключ», роль — <b>Product</b>. Ozon покажет ключ — скопируйте его.
        </li>
        <li>Вставьте Client ID и ключ сюда.</li>
      </ol>

      <form onSubmit={connect} className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Client ID</span>
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">API-ключ</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder={connection ? "Новый ключ — чтобы заменить текущий" : undefined}
            onChange={(event) => setApiKey(event.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-300"
          />
        </label>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Ключ хранится только в этом браузере и отправляется только в Ozon. На другом компьютере его нужно будет ввести заново.
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          {connection ? (
            <button type="button" onClick={disconnect} disabled={checking} className="text-sm font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">
              Отключить
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={checking} className={secondaryButton}>
              Отмена
            </button>
            <button type="submit" disabled={checking} className={primaryButton}>
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              {connection ? "Проверить и заменить" : "Проверить и подключить"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export type SendStep =
  | { step: "checking" }
  | { step: "confirm"; plan: SendPlan; switches: AutoPromoSwitches }
  | { step: "sending"; count: number };

export interface SendReport {
  sentAt: Date;
  results: OzonUpdateResult[];
  /** Что сверяем после отправки: принятое Ozon и то, что могло примениться, хотя ответ не дошел */
  toVerify: OzonPriceUpdate[];
  verification: Verification | null;
  verifying: boolean;
  verifyError: string | null;
}

/**
 * Ход отправки. Ничего не уходит в Ozon без подтверждения: сначала сверка с тем, что в Ozon сейчас,
 * потом окно с итогом, и только по кнопке — запрос
 */
export function useOzonSend({ onAccepted, onError }: { onAccepted: (changes: OzonChange[]) => void; onError: (message: string) => void }) {
  const [step, setStep] = useState<SendStep | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);

  const start = async (changes: OzonChange[], templatePrices: Map<string, number>, switches: AutoPromoSwitches) => {
    const connection = ozonConnectionStore.getSnapshot();
    if (!connection) return;
    setReport(null);
    setStep({ step: "checking" });
    try {
      const live = await fetchLivePrices(connection, changes.map((change) => change.article));
      setStep({ step: "confirm", plan: planSend(changes, templatePrices, live), switches });
    } catch (err) {
      setStep(null);
      onError(errorText(err));
    }
  };

  // sentAt marks the report the check belongs to: a check that finishes after the next send must not land in its report
  const verify = async (updates: OzonPriceUpdate[], sentAt: Date) => {
    const connection = ozonConnectionStore.getSnapshot();
    if (!connection || updates.length === 0) return;
    const patch = (change: Partial<SendReport>) =>
      setReport((prev) => (prev && prev.sentAt === sentAt ? { ...prev, ...change } : prev));

    patch({ verifying: true, verifyError: null });
    try {
      const live = await fetchLivePrices(connection, updates.map((update) => update.offer_id));
      patch({ verification: verifyUpdates(updates, live), verifying: false });
    } catch (err) {
      patch({ verifying: false, verifyError: errorText(err) });
    }
  };

  const confirm = async (skipStale: boolean) => {
    const connection = ozonConnectionStore.getSnapshot();
    if (step?.step !== "confirm" || !connection) return;
    const { plan, switches } = step;
    const stale = new Set(plan.stale.map((item) => item.article));
    const chosen = plan.ready.filter((change) => !(skipStale && stale.has(change.article)));
    const updates = chosen.map((change) => toPriceUpdate(change, plan.live.get(change.article)!, switches));

    setStep({ step: "sending", count: updates.length });
    const results = await importPrices(connection, updates);

    const accepted = new Set(results.filter((result) => result.updated).map((result) => result.article));
    onAccepted(chosen.filter((change) => accepted.has(change.article)));
    const unknown = new Set(
      results.filter((result) => result.errors.some((error) => error.code === REQUEST_FAILED)).map((result) => result.article)
    );
    const toVerify = updates.filter((update) => accepted.has(update.offer_id) || unknown.has(update.offer_id));

    const sentAt = new Date();
    setStep(null);
    setReport({ sentAt, results, toVerify, verification: null, verifying: toVerify.length > 0, verifyError: null });
    if (toVerify.length > 0) {
      await sleep(VERIFY_DELAY_MS);
      await verify(toVerify, sentAt);
    }
  };

  return {
    step,
    report,
    start,
    confirm,
    cancel: () => setStep(null),
    recheck: () => {
      if (report) verify(report.toVerify, report.sentAt);
    },
    dismissReport: () => setReport(null)
  };
}

/** Окно отправки: сверка с Ozon, итог перед отправкой, сама отправка */
export function OzonSendDialog({
  step,
  onConfirm,
  onCancel
}: {
  step: SendStep;
  onConfirm: (skipStale: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} busy={step.step !== "confirm"} labelledBy="ozon-send-title">
      <h2 id="ozon-send-title" className="text-base font-bold text-slate-900">Отправка в Ozon</h2>
      {step.step === "checking" && <Busy text="Сверяем с тем, что сейчас стоит в Ozon…" />}
      {step.step === "sending" && <Busy text={`Отправляем ${goods(step.count)}…`} />}
      {step.step === "confirm" && <SendConfirm plan={step.plan} onConfirm={onConfirm} onCancel={onCancel} />}
    </Modal>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-6 text-sm text-slate-600">
      <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
      {text}
    </div>
  );
}

function SendConfirm({ plan, onConfirm, onCancel }: { plan: SendPlan; onConfirm: (skipStale: boolean) => void; onCancel: () => void }) {
  const { ready, stale, missing, live } = plan;
  const livePrice = (change: OzonChange) => live.get(change.article)?.price ?? 0;
  const withPrice = ready.filter((change) => change.price !== null);
  const changed = withPrice.filter((change) => Math.abs((change.price as number) - livePrice(change)) >= 0.01);
  const samePrice = withPrice.length - changed.length;
  const cogs = ready.filter((change) => change.netPrice !== null).length;
  const fresh = ready.length - stale.length;

  const biggest = changed
    .map((change) => {
      const was = livePrice(change);
      const now = change.price as number;
      return { article: change.article, was, now, delta: was > 0 ? now / was - 1 : 0 };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  if (ready.length === 0) {
    return (
      <>
        <p className="text-sm text-slate-600">
          Отправлять некуда: {missing.length === 1 ? "этого товара" : "этих товаров"} нет в Ozon или они в архиве — {listArticles(missing)}.
        </p>
        <div className="flex justify-end">
          <button onClick={onCancel} className={secondaryButton}>Закрыть</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-sm text-slate-700 space-y-1.5">
        <p>
          Сверено с Ozon в {TIME.format(plan.checkedAt)}. Уйдет <b>{goods(ready.length)}</b>:
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          {changed.length > 0 && <li>новая цена — {NUM0.format(changed.length)}</li>}
          {samePrice > 0 && <li>цена та же, обновится ограничение для акций — {NUM0.format(samePrice)}</li>}
          {cogs > 0 && <li>себестоимость — {NUM0.format(cogs)}</li>}
        </ul>
        {biggest.length > 0 && (
          <p className="text-xs text-slate-500">
            Сильнее всего меняются:{" "}
            {biggest
              .map((b) => `${b.article} ${rub(b.was)} → ${rub(b.now)} (${b.delta > 0 ? "+" : ""}${NUM1.format(b.delta * 100)}%)`)
              .join("; ")}
          </p>
        )}
      </div>

      {stale.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            У {goodsOf(stale.length)} цена в Ozon уже не та, что в шаблоне: ее поменяли после скачивания, и новая цена считалась от старой.{" "}
            <span className="text-amber-800/80">
              {stale
                .slice(0, LIST_LIMIT)
                .map((item) => `${item.article}: в шаблоне ${rub(item.templatePrice)}, в Ozon ${rub(item.ozonPrice)}`)
                .join("; ")}
              {stale.length > LIST_LIMIT && ` и еще ${stale.length - LIST_LIMIT}`}.
            </span>{" "}
            Надежнее скачать свежий шаблон.
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <p className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-sm text-slate-600">
          Нет в Ozon или в архиве — не отправляем: {listArticles(missing)}.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className={secondaryButton}>Отмена</button>
        {stale.length > 0 ? (
          <>
            <button onClick={() => onConfirm(false)} className={secondaryButton}>
              Отправить все — {NUM0.format(ready.length)}
            </button>
            {fresh > 0 && (
              <button onClick={() => onConfirm(true)} className={primaryButton}>
                Отправить без них — {NUM0.format(fresh)}
              </button>
            )}
          </>
        ) : (
          <button onClick={() => onConfirm(false)} className={primaryButton}>
            Отправить — {NUM0.format(ready.length)}
          </button>
        )}
      </div>
    </>
  );
}

/** Итог отправки на странице: что Ozon принял, что нет и почему, и применились ли значения */
export function OzonSendReportBanner({ report, onRecheck, onDismiss }: { report: SendReport; onRecheck: () => void; onDismiss: () => void }) {
  const total = report.results.length;
  const accepted = report.results.filter((result) => result.updated).length;
  const failed = report.results.filter((result) => !result.updated);

  // Одна и та же причина у многих товаров — показываем ее один раз
  const reasons = new Map<string, string[]>();
  for (const result of failed) {
    const reason = result.errors.map((error) => error.message || error.code).filter(Boolean).join("; ") || "Ozon не объяснил причину";
    reasons.set(reason, [...(reasons.get(reason) ?? []), result.article]);
  }

  const { verification } = report;
  const verifiedAll =
    verification !== null && verification.confirmed.length === report.toVerify.length && verification.missing.length === 0;
  const allGood = failed.length === 0 && (report.verifying || verifiedAll);

  // Расхождения по товару одной строкой: цена, зачеркнутая и ограничение обычно расходятся вместе
  const mismatchesByArticle = new Map<string, string[]>();
  for (const mismatch of verification?.mismatches ?? []) {
    const text = `${FIELD_LABELS[mismatch.field]} — отправили ${rub(mismatch.sent)}, в Ozon ${mismatch.ozon === null ? "пусто" : rub(mismatch.ozon)}`;
    mismatchesByArticle.set(mismatch.article, [...(mismatchesByArticle.get(mismatch.article) ?? []), text]);
  }

  return (
    <div
      className={cn(
        "shrink-0 flex items-start justify-between gap-4 px-4 sm:px-5 py-3 border rounded-2xl text-sm text-slate-700",
        allGood ? "bg-emerald-50/70 border-emerald-100" : "bg-amber-50/70 border-amber-100"
      )}
    >
      <div className="space-y-1.5 min-w-0">
        <div>
          <span className="font-bold text-slate-900">
            {failed.length === 0
              ? total === 1 ? "Ozon принял товар." : `Ozon принял все ${goods(total)}.`
              : `Ozon принял ${NUM0.format(accepted)} из ${goodsOf(total)}.`}
          </span>{" "}
          <span className="text-slate-500">Отправлено в {TIME.format(report.sentAt)}.</span>
        </div>

        {reasons.size > 0 && (
          <div className="space-y-0.5">
            <div className="font-semibold text-rose-700">Не принял — {NUM0.format(failed.length)}:</div>
            {[...reasons].map(([reason, articles]) => (
              <div key={reason} className="text-xs text-slate-600">
                «{reason}» — {listArticles(articles)}
              </div>
            ))}
          </div>
        )}

        {report.verifying && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Проверяем, что новые значения применились в Ozon…
          </div>
        )}
        {!report.verifying && report.verifyError && (
          <div className="text-xs text-amber-800">Проверить не удалось: {report.verifyError}</div>
        )}
        {!report.verifying && verification && verifiedAll && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {verification.confirmed.length === 1
              ? "Проверено: в Ozon уже новые значения."
              : `Проверено: в Ozon уже новые значения у всех ${goodsOf(verification.confirmed.length)}.`}
          </div>
        )}
        {!report.verifying && verification && !verifiedAll && (
          <div className="text-xs text-slate-600 space-y-0.5">
            <div className="font-semibold text-amber-800">
              Проверено: совпало у {NUM0.format(verification.confirmed.length)} из {goodsOf(report.toVerify.length)}. Ozon иногда
              применяет изменения с задержкой в несколько минут — проверьте еще раз чуть позже.
            </div>
            {[...mismatchesByArticle].slice(0, LIST_LIMIT).map(([article, texts]) => (
              <div key={article}>
                {article}: {texts.join("; ")}
              </div>
            ))}
            {mismatchesByArticle.size > LIST_LIMIT && <div>и еще {goods(mismatchesByArticle.size - LIST_LIMIT)}</div>}
            {verification.missing.length > 0 && <div>Не нашлись в Ozon при проверке: {listArticles(verification.missing)}</div>}
          </div>
        )}
        {!report.verifying && (report.verifyError || (verification && !verifiedAll)) && (
          <button onClick={onRecheck} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700">
            <RefreshCw className="w-3.5 h-3.5" />
            Проверить еще раз
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-white/60 transition-colors"
        aria-label="Скрыть"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

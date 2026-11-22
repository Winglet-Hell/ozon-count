"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Loader2, PlayCircle, Square, Upload, XCircle } from "lucide-react";
import { Header } from "@/components/Header";
import { OzonConnectDialog, useOzonConnection } from "@/components/OzonSync";
import { useAppState } from "@/components/StoreProvider";
import { cn } from "@/lib/utils";
import { parseOzonTemplate, parseOzonTemplateData, type ParsedTemplate } from "@/lib/repricer";
import { parseAccrualsReport, previewAccrualsFile, type AccrualsSummary } from "@/lib/parseAccruals";
import {
  createReport,
  fetchAccrualTypes,
  fetchBarcodes,
  fetchBuyerPrices,
  fetchKeyInfo,
  fetchLivePrices,
  fetchReportInfo,
  forEachAccrualPage,
  OzonApiError,
  type OzonCredentials,
  type OzonKeyInfo
} from "@/lib/ozonApi";
import {
  addAccrualRecords,
  apiPriceRows,
  COMMISSION_FIELDS,
  compareAccrualTypes,
  compareRows,
  emptyTotals,
  inspectReportFile,
  periodDates,
  templatePriceRows,
  typeTotals,
  type AccrualTotals,
  type CommissionField,
  type ReportFileSummary,
  type RowsComparison,
  type TypeComparison
} from "@/lib/ozonCheck";
import { ozonConnectionStore } from "@/lib/persistentStores";

/**
 * Проверка Ozon API: можно ли брать таблицы автоматически, не теряя в качестве. Все запросы только читают —
 * в Ozon ничего не меняется. Итог можно скопировать и прислать, чтобы решить, что автоматизировать.
 */

const RUB = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const signed = (value: number) => `${value > 0 ? "+" : ""}${RUB.format(value)}`;

/** «282 товара», «5 товаров» */
const goods = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "товар" : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "товара" : "товаров";
  return `${RUB.format(n)} ${word}`;
};

/** «Период: 01.10.2026-31.10.2026» → «01.10.2026-31.10.2026» */
const periodText = (period: string) => period.replace(/^\s*(период|period)\s*:?\s*/i, "");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Что-то пошло не так");

type Run<T> =
  | { state: "idle" }
  | { state: "running"; progress: string }
  | { state: "done"; result: T }
  | { state: "error"; message: string };

const IDLE = { state: "idle" } as const;

/** Методы, которые нужны проверке, и роль ключа, в которой они есть */
const METHOD_GROUPS: { label: string; role: string; methods: string[] }[] = [
  { label: "Цены и индексы, отправка цен", role: "Product", methods: ["/v5/product/info/prices", "/v1/product/import/prices"] },
  { label: "Штрихкоды", role: "Product", methods: ["/v3/product/info/list"] },
  { label: "Цена для покупателя (нужен Premium Pro)", role: "Product", methods: ["/v1/product/prices/details"] },
  { label: "Начисления", role: "Report", methods: ["/v1/finance/accrual/by-day", "/v1/finance/accrual/types"] },
  { label: "Отчет о ценах (нет в документации)", role: "Report", methods: ["/v1/report/products/prices/create", "/v1/report/info"] },
  { label: "Отчет о финансах (нет в документации)", role: "Report", methods: ["/v1/report/finance/create", "/v1/report/info"] }
];

interface PriceCheck {
  comparison: RowsComparison;
  buyerPriceError: string | null;
}

interface AccrualCheck {
  period: string;
  fileTotal: number;
  totals: AccrualTotals;
  types: TypeComparison[];
  /** Формат даты, который принял Ozon */
  dateFormat: string;
}

interface ProbeResult {
  attempts: { body: string; error: string }[];
  code: string | null;
  status: string;
  reportError: string;
  file: string;
  fileError: string | null;
  analysis: ReportAnalysis | null;
}

interface ReportAnalysis {
  summary: ReportFileSummary;
  prices: RowsComparison | null;
  finance: { fileTotal: number; reportTotal: number; types: TypeComparison[] } | null;
  parseError: string | null;
}

type ProbeKind = "prices" | "finance";

const PROBE_PATHS: Record<ProbeKind, string> = {
  prices: "/v1/report/products/prices/create",
  finance: "/v1/report/finance/create"
};

/** Варианты запроса для методов без документации: по ошибкам Ozon видно, какой формат он ждет */
function probeBodies(kind: ProbeKind, dates: string[] | null): unknown[] {
  if (kind === "prices") return [{}, { language: "DEFAULT" }, { language: "DEFAULT", visibility: "ALL" }];
  if (!dates) return [{}];
  const from = dates[0];
  const to = dates[dates.length - 1];
  return [
    { date_from: from, date_to: to },
    { date: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` } },
    { period: { from, to } },
    { from, to },
    {}
  ];
}

export default function OzonCheckPage() {
  const { repricerParsedData, accrualsResult } = useAppState();
  const connection = useOzonConnection();
  const [connectOpen, setConnectOpen] = useState(false);

  const [uploadedTemplate, setUploadedTemplate] = useState<ParsedTemplate | null>(null);
  const [uploadedAccruals, setUploadedAccruals] = useState<AccrualsSummary | null>(null);
  const template = uploadedTemplate ?? repricerParsedData;
  const accruals = uploadedAccruals ?? accrualsResult;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const [keyRun, setKeyRun] = useState<Run<OzonKeyInfo>>(IDLE);
  const [priceRun, setPriceRun] = useState<Run<PriceCheck>>(IDLE);
  const [accrualRun, setAccrualRun] = useState<Run<AccrualCheck>>(IDLE);
  const [probeRuns, setProbeRuns] = useState<Record<ProbeKind, Run<ProbeResult>>>({ prices: IDLE, finance: IDLE });
  const stopAccruals = useRef(false);
  const [copied, setCopied] = useState(false);

  const credentials = (): OzonCredentials | null => {
    const current = ozonConnectionStore.getSnapshot();
    if (!current) setConnectOpen(true);
    return current;
  };

  const loadTemplate = async (file: File) => {
    setLoadError(null);
    setLoading("Читаем шаблон…");
    try {
      setUploadedTemplate(await parseOzonTemplate(file));
      setPriceRun(IDLE);
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setLoading(null);
    }
  };

  const loadAccruals = async (file: File) => {
    setLoadError(null);
    setLoading("Читаем отчет о начислениях…");
    try {
      setUploadedAccruals(await parseAccrualsReport(file));
      setAccrualRun(IDLE);
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setLoading(null);
    }
  };

  const runKeyCheck = async () => {
    const creds = credentials();
    if (!creds) return;
    setKeyRun({ state: "running", progress: "Спрашиваем Ozon о ключе…" });
    try {
      setKeyRun({ state: "done", result: await fetchKeyInfo(creds) });
    } catch (err) {
      setKeyRun({ state: "error", message: errorText(err) });
    }
  };

  const runPriceCheck = async () => {
    const creds = credentials();
    if (!creds || !template) return;
    const rows = templatePriceRows(template);
    const articles = rows.map((row) => row.article);
    try {
      setPriceRun({ state: "running", progress: "Цены и индексы…" });
      const live = await fetchLivePrices(creds, articles);
      setPriceRun({ state: "running", progress: "Штрихкоды…" });
      const barcodes = await fetchBarcodes(creds, articles).catch((err: unknown) => err);
      setPriceRun({ state: "running", progress: "Цена для покупателя…" });
      const skus = rows.flatMap((row) => (row.sku ? [row.sku] : []));
      const buyer = await fetchBuyerPrices(creds, skus).catch((err: unknown) => err);

      const buyerError = buyer instanceof Map ? null : errorText(buyer);
      const barcodeError = barcodes instanceof Map ? null : errorText(barcodes);
      const comparison = compareRows(
        rows,
        apiPriceRows(live, barcodes instanceof Map ? barcodes : null, buyer instanceof Map ? buyer : null),
        {
          ...(buyerError ? { buyerPrice: buyerError } : {}),
          ...(barcodeError ? { barcodes: barcodeError } : {})
        }
      );
      setPriceRun({ state: "done", result: { comparison, buyerPriceError: buyerError } });
    } catch (err) {
      setPriceRun({ state: "error", message: errorText(err) });
    }
  };

  const runAccrualCheck = async () => {
    const creds = credentials();
    if (!creds || !accruals) return;
    const dates = periodDates(accruals.period);
    if (!dates) {
      setAccrualRun({ state: "error", message: `Не удалось понять период отчета: «${accruals.period}»` });
      return;
    }
    stopAccruals.current = false;
    try {
      setAccrualRun({ state: "running", progress: "Справочник начислений…" });
      const typeNames = await fetchAccrualTypes(creds);
      const totals = emptyTotals();
      // Формат даты в документации не показан: сначала «2026-10-01», если Ozon не примет — с временем
      const formats = [(date: string) => date, (date: string) => `${date}T00:00:00Z`];
      let format = 0;

      for (let i = 0; i < dates.length; i++) {
        if (stopAccruals.current) throw new Error("Остановлено");
        try {
          totals.pages += await forEachAccrualPage(creds, formats[format](dates[i]), (records) => addAccrualRecords(totals, records, typeNames));
        } catch (err) {
          if (i === 0 && format === 0 && err instanceof OzonApiError && err.status === 400) {
            format = 1;
            i--;
            continue;
          }
          throw err;
        }
        totals.days++;
        setAccrualRun({
          state: "running",
          progress: `День ${i + 1} из ${dates.length} · страниц ${totals.pages} · начислений ${RUB.format(totals.records)}`
        });
      }

      setAccrualRun({
        state: "done",
        result: {
          period: accruals.period,
          fileTotal: accruals.netResult,
          totals,
          types: compareAccrualTypes(accruals, totals.byType),
          dateFormat: format === 0 ? "2026-10-01" : "2026-10-01T00:00:00Z"
        }
      });
    } catch (err) {
      setAccrualRun({ state: "error", message: errorText(err) });
    }
  };

  const analyzeReport = async (kind: ProbeKind, bytes: Uint8Array): Promise<ReportAnalysis> => {
    const summary = inspectReportFile(bytes);
    const analysis: ReportAnalysis = { summary, prices: null, finance: null, parseError: null };
    if (summary.kind !== "xlsx") return analysis;
    try {
      if (kind === "prices" && template) {
        const report = parseOzonTemplateData(bytes);
        const reportRows = new Map(templatePriceRows(report).map((row) => [row.article, row]));
        analysis.prices = compareRows(templatePriceRows(template), reportRows);
      }
      if (kind === "finance") {
        const file = new File([bytes as BlobPart], "report.xlsx");
        // Колонки читаем так же, как отчет о начислениях: библиотека xlsx портит экранированную кириллицу Ozon
        const preview = await previewAccrualsFile(file);
        if (preview.headers.length > 0) {
          summary.headers = preview.headers;
          summary.rows = preview.rows;
        }
        if (accruals) {
          const report = await parseAccrualsReport(file);
          analysis.finance = {
            fileTotal: accruals.netResult,
            reportTotal: report.netResult,
            types: compareAccrualTypes(accruals, typeTotals(report))
          };
        }
      }
    } catch (err) {
      analysis.parseError = errorText(err);
    }
    return analysis;
  };

  const setProbe = (kind: ProbeKind, run: Run<ProbeResult>) => setProbeRuns((prev) => ({ ...prev, [kind]: run }));

  const runProbe = async (kind: ProbeKind) => {
    const creds = credentials();
    if (!creds) return;
    const result: ProbeResult = { attempts: [], code: null, status: "", reportError: "", file: "", fileError: null, analysis: null };
    try {
      setProbe(kind, { state: "running", progress: "Заказываем отчет…" });
      for (const body of probeBodies(kind, accruals ? periodDates(accruals.period) : null)) {
        try {
          result.code = await createReport(creds, PROBE_PATHS[kind], body);
          break;
        } catch (err) {
          result.attempts.push({ body: JSON.stringify(body), error: errorText(err) });
          // Нет доступа или метода — другие варианты запроса не помогут
          if (err instanceof OzonApiError && [401, 403, 404].includes(err.status)) break;
        }
      }

      if (result.code) {
        for (let i = 0; i < 60; i++) {
          const info = await fetchReportInfo(creds, result.code);
          result.status = info.status;
          result.reportError = info.error;
          result.file = info.file;
          setProbe(kind, { state: "running", progress: `Ozon готовит отчет: ${info.status || "в очереди"} (${i * 3} с)` });
          if (info.status === "success" || info.status === "failed") break;
          await sleep(3000);
        }
      }

      if (result.status === "success" && result.file) {
        try {
          const response = await fetch(result.file);
          if (!response.ok) throw new Error(`ошибка ${response.status}`);
          result.analysis = await analyzeReport(kind, new Uint8Array(await response.arrayBuffer()));
        } catch (err) {
          result.fileError = `Файл не скачался сам (${errorText(err)}). Скачайте его по ссылке и выберите ниже — сверка пройдет так же.`;
        }
      }
      setProbe(kind, { state: "done", result });
    } catch (err) {
      setProbe(kind, { state: "error", message: errorText(err) });
    }
  };

  const loadProbeFile = async (kind: ProbeKind, file: File) => {
    const run = probeRuns[kind];
    if (run.state !== "done") return;
    const analysis = await analyzeReport(kind, new Uint8Array(await file.arrayBuffer()));
    setProbe(kind, { state: "done", result: { ...run.result, fileError: null, analysis } });
  };

  const copySummary = async () => {
    const text = summaryText({ keyRun, priceRun, accrualRun, probeRuns, template, accruals });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setLoadError("Браузер не дал скопировать. Выделите итог вручную.");
    }
  };

  const busy = [keyRun, priceRun, accrualRun, probeRuns.prices, probeRuns.finance].some((run) => run.state === "running");

  return (
    <main className="min-h-screen bg-slate-50/50">
      <Header activeTab="ozon" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Проверка Ozon API</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Можно ли брать таблицы из Ozon автоматически и не потерять в качестве: приложение запрашивает то же самое
              через API и сравнивает с вашими файлами. Все запросы только читают — в Ozon ничего не меняется.
            </p>
          </div>
          <button
            onClick={copySummary}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-xl"
          >
            <ClipboardCopy className="w-4 h-4" />
            {copied ? "Скопировано" : "Скопировать итог"}
          </button>
        </div>

        {loadError && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-100 text-sm text-rose-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{loadError}</span>
            <button onClick={() => setLoadError(null)} aria-label="Скрыть"><XCircle className="w-4 h-4" /></button>
          </div>
        )}
        {loading && <Progress text={loading} />}

        <Section n={1} title="Ключ" hint="Для всех проверок нужен ключ с ролями Product и Report">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">
              {connection ? `Подключен Client ID ${connection.clientId}` : "Ключ не подключен"}
            </span>
            <ActionButton onClick={() => setConnectOpen(true)} secondary>
              {connection ? "Заменить ключ" : "Подключить"}
            </ActionButton>
            <ActionButton onClick={runKeyCheck} disabled={!connection || keyRun.state === "running"}>
              Проверить ключ
            </ActionButton>
          </div>
          <RunView run={keyRun}>
            {(info) => (
              <div className="space-y-2 text-sm">
                <div className="text-slate-600">
                  Роли: <b>{info.roles.join(", ") || "Ozon не перечислил"}</b>
                  {info.expiresAt && <> · действует до {new Date(info.expiresAt).toLocaleDateString("ru-RU")}</>}
                </div>
                {info.methods.length === 0 ? (
                  <div className="text-slate-500">Ozon не перечислил методы ключа — проверки покажут доступ сами.</div>
                ) : (
                  <ul className="space-y-1">
                    {METHOD_GROUPS.map((group) => {
                      const ok = group.methods.every((method) => info.methods.includes(method));
                      return (
                        <li key={group.label} className="flex items-center gap-2">
                          <StatusIcon ok={ok} />
                          <span className={ok ? "text-slate-700" : "text-slate-500"}>
                            {group.label} {!ok && <span className="text-xs">— нужна роль {group.role}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </RunView>
        </Section>

        <Section
          n={2}
          title="Шаблон цен ↔ API"
          hint="Все поля шаблона, которые есть в API, по каждому товару. Свежий шаблон — точнее сравнение"
        >
          <SourceLine
            text={template ? `Шаблон: ${goods(template.items.length)}${uploadedTemplate ? "" : " — из Репрайсера"}` : "Шаблон не загружен"}
            accept=".xlsx"
            buttonText={template ? "Другой шаблон" : "Загрузить шаблон"}
            onFile={loadTemplate}
          />
          <ActionButton onClick={runPriceCheck} disabled={!template || !connection || priceRun.state === "running"}>
            Сверить с API
          </ActionButton>
          <RunView run={priceRun}>{(result) => <RowsComparisonView comparison={result.comparison} sourceName="шаблон" />}</RunView>
        </Section>

        <Section
          n={3}
          title="Отчет о ценах — метод без документации"
          hint="Если Ozon отдаст через него тот же шаблон, его можно будет брать автоматически вместе с ценой для покупателя"
        >
          <ActionButton onClick={() => runProbe("prices")} disabled={!connection || probeRuns.prices.state === "running"}>
            Запросить отчет о ценах
          </ActionButton>
          <RunView run={probeRuns.prices}>
            {(result) => <ProbeView kind="prices" result={result} onFile={(file) => loadProbeFile("prices", file)} hasBase={!!template} />}
          </RunView>
        </Section>

        <Section
          n={4}
          title="Начисления ↔ API"
          hint="Тот же период, что в отчете о начислениях. Лучше закрытый месяц: в свежих днях Ozon еще дописывает начисления"
        >
          <SourceLine
            text={accruals ? `Отчет о начислениях за ${periodText(accruals.period) || "период не указан"}${uploadedAccruals ? "" : " — со страницы «Начисления»"}` : "Отчет о начислениях не загружен"}
            accept=".xlsx"
            buttonText={accruals ? "Другой отчет" : "Загрузить отчет"}
            onFile={loadAccruals}
          />
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={runAccrualCheck} disabled={!accruals || !connection || accrualRun.state === "running"}>
              Сверить период
            </ActionButton>
            {accrualRun.state === "running" && (
              <ActionButton secondary onClick={() => { stopAccruals.current = true; }}>
                <Square className="w-3.5 h-3.5" /> Остановить
              </ActionButton>
            )}
          </div>
          <RunView run={accrualRun}>{(result) => <AccrualView check={result} />}</RunView>
        </Section>

        <Section
          n={5}
          title="Отчет о финансах — метод без документации"
          hint="Если это тот же отчет о начислениях, его можно будет брать автоматически без сопоставления типов"
        >
          <ActionButton onClick={() => runProbe("finance")} disabled={!connection || probeRuns.finance.state === "running"}>
            Запросить отчет о финансах{accruals?.period ? ` за ${periodText(accruals.period)}` : ""}
          </ActionButton>
          <RunView run={probeRuns.finance}>
            {(result) => <ProbeView kind="finance" result={result} onFile={(file) => loadProbeFile("finance", file)} hasBase={!!accruals} />}
          </RunView>
        </Section>
      </div>

      {connectOpen && <OzonConnectDialog onClose={() => setConnectOpen(false)} onConnected={() => setConnectOpen(false)} />}
    </main>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 space-y-3">
      <div>
        <h3 className="text-base font-bold text-slate-900">
          <span className="text-slate-400 mr-1.5">{n}.</span>
          {title}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  onClick,
  disabled,
  secondary,
  children
}: {
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        secondary ? "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-blue-600 hover:bg-blue-700 text-white"
      )}
    >
      {!secondary && <PlayCircle className="w-4 h-4" />}
      {children}
    </button>
  );
}

function SourceLine({ text, accept, buttonText, onFile }: { text: string; accept: string; buttonText: string; onFile: (file: File) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
      <span>{text}</span>
      <label className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-semibold cursor-pointer">
        <Upload className="w-3.5 h-3.5" />
        {buttonText}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
      {text}
    </div>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-500 shrink-0" />;
}

function RunView<T>({ run, children }: { run: Run<T>; children: (result: T) => React.ReactNode }) {
  if (run.state === "idle") return null;
  if (run.state === "running") return <Progress text={run.progress} />;
  if (run.state === "error") {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-100 text-sm text-rose-700">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        {run.message}
      </div>
    );
  }
  return <>{children(run.result)}</>;
}

function RowsComparisonView({ comparison, sourceName }: { comparison: RowsComparison; sourceName: string }) {
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 text-left">
          <tr className="border-b border-slate-100">
            <th className="py-1.5 pr-3 font-semibold">Поле</th>
            <th className="py-1.5 pr-3 font-semibold">Совпало</th>
            <th className="py-1.5 font-semibold">Расхождения: {sourceName} → API</th>
          </tr>
        </thead>
        <tbody>
          {comparison.checks.map((check) => {
            const ok = !check.unavailable && check.matched === check.compared;
            return (
              <tr key={check.key} className="border-b border-slate-50 align-top">
                <td className="py-1.5 pr-3">
                  <div className="flex items-start gap-1.5">
                    <StatusIcon ok={ok} />
                    <span className="text-slate-700">{check.label}</span>
                  </div>
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-slate-700">
                  {check.unavailable ? "—" : `${check.matched} из ${check.compared}`}
                </td>
                <td className="py-1.5 text-xs text-slate-500">
                  {check.unavailable
                    ? `Ozon не отдал: ${check.unavailable}`
                    : check.diffs.map((diff) => `${diff.article}: ${diff.file} → ${diff.api}`).join("; ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {comparison.missing.length > 0 && (
        <p className="text-xs text-slate-500">
          Нет в API ({comparison.missing.length} из {comparison.total}): {comparison.missing.slice(0, 8).join(", ")}
          {comparison.missing.length > 8 && " и другие"}
        </p>
      )}
    </div>
  );
}

function TypesTable({ types, fileName, apiName }: { types: TypeComparison[]; fileName: string; apiName: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500 text-left">
        <tr className="border-b border-slate-100">
          <th className="py-1.5 pr-3 font-semibold">Тип начисления</th>
          <th className="py-1.5 pr-3 font-semibold text-right">{fileName}</th>
          <th className="py-1.5 pr-3 font-semibold text-right">{apiName}</th>
          <th className="py-1.5 font-semibold text-right">Разница</th>
        </tr>
      </thead>
      <tbody>
        {types.map((type) => {
          const diff = (type.api ?? 0) - (type.file ?? 0);
          const same = type.file !== null && type.api !== null && Math.abs(diff) < 1;
          return (
            <tr key={type.name} className="border-b border-slate-50">
              <td className="py-1 pr-3 text-slate-700">{type.name}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{type.file === null ? "—" : RUB.format(type.file)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{type.api === null ? "—" : RUB.format(type.api)}</td>
              <td className={cn("py-1 text-right tabular-nums", same ? "text-emerald-600" : "text-amber-700")}>
                {same ? "✓" : signed(diff)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AccrualView({ check }: { check: AccrualCheck }) {
  const diff = check.totals.total - check.fileTotal;
  const commission = Object.entries(COMMISSION_FIELDS) as [CommissionField, string][];
  return (
    <div className="space-y-3 text-sm">
      <div className={cn("px-3 py-2 rounded-xl border", Math.abs(diff) < 1 ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100")}>
        <b>Итого за {periodText(check.period)}:</b> отчет {RUB.format(check.fileTotal)} ₽ · API {RUB.format(check.totals.total)} ₽ ·{" "}
        {Math.abs(diff) < 1 ? "совпадает" : `разница ${signed(diff)} ₽`}
        <div className="text-xs text-slate-500 mt-0.5">
          Дней {check.totals.days}, страниц {check.totals.pages}, начислений {RUB.format(check.totals.records)}. Дата в формате {check.dateFormat}.
        </div>
      </div>
      <TypesTable types={check.types} fileName="Отчет" apiName="API" />
      <div>
        <div className="text-xs font-semibold text-slate-500 mb-1">Продажи в API лежат не типами, а полями комиссии по товару:</div>
        <ul className="text-xs text-slate-600 space-y-0.5">
          {commission.map(([field, label]) => (
            <li key={field}>{label}: <span className="tabular-nums">{RUB.format(check.totals.commission[field])}</span></li>
          ))}
        </ul>
      </div>
      {check.totals.unknownTypes.size > 0 && (
        <p className="text-xs text-amber-700">
          Типы без названия в справочнике: {[...check.totals.unknownTypes].map(([id, amount]) => `${id} (${RUB.format(amount)})`).join(", ")}
        </p>
      )}
    </div>
  );
}

function ProbeView({ kind, result, onFile, hasBase }: { kind: ProbeKind; result: ProbeResult; onFile: (file: File) => void; hasBase: boolean }) {
  const { analysis } = result;
  return (
    <div className="space-y-2 text-sm">
      {result.attempts.length > 0 && (
        <div className="text-xs text-slate-500 space-y-0.5">
          {result.attempts.map((attempt) => (
            <div key={attempt.body}>Запрос {attempt.body}: {attempt.error}</div>
          ))}
        </div>
      )}
      {!result.code && <div className="text-slate-700">Ozon не принял ни один вариант запроса — метод недоступен или ждет другие параметры.</div>}
      {result.code && (
        <div className="text-slate-700">
          Отчет {result.status === "success" ? "готов" : result.status === "failed" ? "не собрался" : `не успел собраться (${result.status || "нет статуса"})`}
          {result.reportError && <> — {result.reportError}</>}
          {result.file && (
            <>
              {" · "}
              <a href={result.file} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-semibold">
                скачать файл
              </a>
            </>
          )}
        </div>
      )}
      {result.fileError && (
        <div className="space-y-1.5">
          <div className="text-xs text-amber-800">{result.fileError}</div>
          <SourceLine text="" accept=".xlsx,.csv" buttonText="Выбрать скачанный файл" onFile={onFile} />
        </div>
      )}
      {analysis && (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">
            Файл {analysis.summary.kind.toUpperCase()}, {RUB.format(analysis.summary.size / 1024)} КБ, строк {RUB.format(analysis.summary.rows)}
            {analysis.summary.sheets.length > 0 && <>, листы: {analysis.summary.sheets.join(", ")}</>}
          </div>
          <div className="text-xs text-slate-500">Колонки: {analysis.summary.headers.slice(0, 40).join(" · ") || "не нашлись"}</div>
          {analysis.parseError && <div className="text-xs text-amber-800">Разобрать как {kind === "prices" ? "шаблон цен" : "отчет о начислениях"} не вышло: {analysis.parseError}</div>}
          {!hasBase && <div className="text-xs text-slate-500">Чтобы сравнить, загрузите {kind === "prices" ? "шаблон цен (шаг 2)" : "отчет о начислениях (шаг 4)"}.</div>}
          {analysis.prices && <RowsComparisonView comparison={analysis.prices} sourceName="шаблон" />}
          {analysis.finance && (
            <>
              <div className="text-slate-700">
                Итого: ваш отчет {RUB.format(analysis.finance.fileTotal)} ₽ · отчет из API {RUB.format(analysis.finance.reportTotal)} ₽
              </div>
              <TypesTable types={analysis.finance.types} fileName="Ваш отчет" apiName="Из API" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Итог всех проверок текстом — чтобы прислать его и решить, что автоматизировать */
function summaryText({
  keyRun,
  priceRun,
  accrualRun,
  probeRuns,
  template,
  accruals
}: {
  keyRun: Run<OzonKeyInfo>;
  priceRun: Run<PriceCheck>;
  accrualRun: Run<AccrualCheck>;
  probeRuns: Record<ProbeKind, Run<ProbeResult>>;
  template: ParsedTemplate | null;
  accruals: AccrualsSummary | null;
}): string {
  const lines: string[] = [`Проверка Ozon API, ${new Date().toLocaleString("ru-RU")}`];
  const runLine = <T,>(title: string, run: Run<T>, done: (result: T) => string[]) => {
    lines.push("", `## ${title}`);
    if (run.state === "idle") lines.push("не запускалась");
    else if (run.state === "running") lines.push(`еще идет: ${run.progress}`);
    else if (run.state === "error") lines.push(`ошибка: ${run.message}`);
    else lines.push(...done(run.result));
  };
  const comparisonLines = (comparison: RowsComparison) => [
    ...comparison.checks.map((check) =>
      check.unavailable
        ? `${check.label}: Ozon не отдал — ${check.unavailable}`
        : `${check.label}: ${check.matched} из ${check.compared}${check.diffs.length ? ` · ${check.diffs.slice(0, 3).map((d) => `${d.article}: ${d.file} → ${d.api}`).join("; ")}` : ""}`
    ),
    ...(comparison.missing.length ? [`нет в API: ${comparison.missing.length} из ${comparison.total}`] : [])
  ];
  const probeLines = (result: ProbeResult) => [
    ...result.attempts.map((attempt) => `запрос ${attempt.body}: ${attempt.error}`),
    result.code ? `статус: ${result.status || "нет"}${result.reportError ? ` (${result.reportError})` : ""}` : "ни один вариант запроса не принят",
    ...(result.fileError ? [result.fileError] : []),
    ...(result.analysis
      ? [
          `файл: ${result.analysis.summary.kind}, строк ${result.analysis.summary.rows}, листы: ${result.analysis.summary.sheets.join(", ") || "—"}`,
          `колонки: ${result.analysis.summary.headers.slice(0, 60).join(" | ")}`,
          ...(result.analysis.parseError ? [`разбор: ${result.analysis.parseError}`] : []),
          ...(result.analysis.prices ? comparisonLines(result.analysis.prices) : []),
          ...(result.analysis.finance
            ? [
                `итого: ваш отчет ${RUB.format(result.analysis.finance.fileTotal)}, из API ${RUB.format(result.analysis.finance.reportTotal)}`,
                ...result.analysis.finance.types.map((t) => `${t.name}: ${t.file === null ? "—" : RUB.format(t.file)} / ${t.api === null ? "—" : RUB.format(t.api)}`)
              ]
            : [])
        ]
      : [])
  ];

  runLine("Ключ", keyRun, (info) => [
    `роли: ${info.roles.join(", ") || "—"}; до ${info.expiresAt ?? "—"}`,
    ...METHOD_GROUPS.map((group) => `${group.label}: ${info.methods.length === 0 ? "?" : group.methods.every((m) => info.methods.includes(m)) ? "есть" : "нет"}`)
  ]);
  runLine(`Шаблон цен ↔ API (${template ? goods(template.items.length) : "шаблона нет"})`, priceRun, (result) => comparisonLines(result.comparison));
  runLine("Отчет о ценах (метод без документации)", probeRuns.prices, probeLines);
  runLine(`Начисления ↔ API (${accruals ? periodText(accruals.period) : "отчета нет"})`, accrualRun, (check) => [
    `итого: отчет ${RUB.format(check.fileTotal)}, API ${RUB.format(check.totals.total)}, разница ${signed(check.totals.total - check.fileTotal)}`,
    `дней ${check.totals.days}, страниц ${check.totals.pages}, начислений ${check.totals.records}, дата ${check.dateFormat}`,
    ...check.types.map((t) => `${t.name}: ${t.file === null ? "—" : RUB.format(t.file)} / ${t.api === null ? "—" : RUB.format(t.api)}`),
    ...(Object.entries(COMMISSION_FIELDS) as [CommissionField, string][]).map(([field, label]) => `API ${field} (${label}): ${RUB.format(check.totals.commission[field])}`),
    ...(check.totals.unknownTypes.size ? [`типы без названия: ${[...check.totals.unknownTypes].map(([id, amount]) => `${id}=${RUB.format(amount)}`).join(", ")}`] : [])
  ]);
  runLine("Отчет о финансах (метод без документации)", probeRuns.finance, probeLines);
  return lines.join("\n");
}

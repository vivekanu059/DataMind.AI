import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import type { AnalysisResponse, ChartConfig } from '../types/dashboard';
import { DynamicChart } from './DynamicChart';
import {
  Sparkles, AlertTriangle, Lightbulb, ArrowLeft, Download, Filter, Layers,
  Search, FileText, BarChart3, Table2, X,
} from 'lucide-react';
import { ChatAssistant } from './ChatAssistant';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface ExportLink { url: string; label: string; }
interface DynamicFilter { column: string; label: string; options: string[]; }
interface Anomaly { metric?: unknown; anomaly?: unknown; description?: unknown; value?: unknown; }

type Row = Record<string, unknown>;

/**
 * Describes how a chart was built from the raw CSV columns, so the browser can
 * rebuild it after a filter is applied. Produced by the SQL engineer agent
 * (see dashboardGraph.ts) and carried on each chart as `chart.spec`.
 */
interface Measure { dataKey: string; column?: string | null; agg?: string }
interface ChartSpec {
  dimension?: string | null;
  bucket?: 'day' | 'month' | 'year' | null;
  measures?: Measure[];
  sort?: 'x_asc' | 'value_desc' | 'value_asc' | null;
  limit?: number | null;
  xColumn?: string;
  yColumn?: string;
}
type SpecChart = ChartConfig & { spec?: ChartSpec };

interface Props {
  data: AnalysisResponse & {
    exportLinks?: ExportLink[];
    availableFilters?: (string | DynamicFilter)[];
    anomalies?: Anomaly[];
    recommendations?: unknown[];
    fileLocation?: string;
    sessionId?: string;
  };
  onReset: () => void;
}

/** Must match the LIMIT used for drillDownQuery in dashboardGraph.ts */
const DRILL_LIMIT = 5000;
const PAGE = 100;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const renderText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredValue = record.action ?? record.details ?? record.description;
    return preferredValue !== undefined ? renderText(preferredValue) : JSON.stringify(value);
  }
  return String(value);
};

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md';
const PROSE = 'prose prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-headings:text-white prose-a:text-cyan-300 prose-strong:text-white';

const SectionTitle = ({ icon: Icon, children, tone = 'text-cyan-300' }: { icon: React.ElementType; children: React.ReactNode; tone?: string }) => (
  <h3 className="font-display flex items-center gap-2.5 text-xl font-bold text-white">
    <Icon className={`h-5 w-5 ${tone}`} /> {children}
  </h3>
);

/** Column names from the AI and from the CSV rarely match exactly ("Order Date" / order_date), so compare loosely. */
const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
type Resolver = (name?: string | null) => string | undefined;
const makeResolver = (rows: Row[]): Resolver => {
  const map = new Map<string, string>();
  Object.keys(rows[0] || {}).forEach((k) => map.set(norm(k), k));
  return (name) => (name ? map.get(norm(name)) : undefined);
};

const isEmptyVal = (v: unknown) => v === null || v === undefined || v === '';

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isEmptyVal(v)) return null;
  const s = String(v).trim();
  if (!/^[-+]?[$€£₹]?\s?[-+]?[\d,]*\.?\d+%?$/.test(s)) return null;
  const n = Number(s.replace(/[^0-9.\-+]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const optionsFor = (rows: Row[], key: string): string[] =>
  Array.from(new Set(rows.map((r) => r[key]).filter((v) => !isEmptyVal(v)).map(String)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** Keep only rows matching every [column, value] pair. Columns missing from the data are ignored. */
const applyFilters = (rows: Row[], pairs: Array<[string, string]>, resolve: Resolver): Row[] => {
  const active = pairs
    .map(([col, val]) => [resolve(col), val] as const)
    .filter((p): p is readonly [string, string] => !!p[0]);
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(([key, val]) => String(row[key] ?? '').trim() === val));
};

const bucketLabel = (v: unknown, bucket?: ChartSpec['bucket']): string => {
  if (isEmptyVal(v)) return 'Unknown';
  if (!bucket) return String(v);
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return bucket === 'year' ? `${y}` : bucket === 'month' ? `${y}-${m}` : `${y}-${m}-${day}`;
};

const aggregate = (rows: Row[], key: string | undefined, agg: string): number => {
  const a = agg.toUpperCase();
  if (a === 'COUNT' && !key) return rows.length;
  const vals = key ? rows.map((r) => r[key]) : [];
  if (a === 'COUNT') return vals.filter((v) => !isEmptyVal(v)).length;
  if (a === 'COUNT_DISTINCT') return new Set(vals.filter((v) => !isEmptyVal(v)).map(String)).size;
  const nums = vals.map(toNum).filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  const sum = nums.reduce((s, n) => s + n, 0);
  const out =
    a === 'AVG' ? sum / nums.length :
    a === 'MIN' ? Math.min(...nums) :
    a === 'MAX' ? Math.max(...nums) : sum;
  return Math.round(out * 100) / 100;
};

/** Rebuild a chart's rows from filtered raw rows. Returns null when the chart carries no usable spec. */
const rebuildChart = (chart: SpecChart, rows: Row[], resolve: Resolver, originalLen: number): Row[] | null => {
  const spec = chart.spec;
  const xKey = chart.xAxisKey;
  if (!spec || !xKey) return null;

  if (chart.type === 'ScatterChart') {
    const xk = resolve(spec.xColumn);
    const yk = resolve(spec.yColumn);
    if (!xk || !yk) return null;
    const yName = (chart as unknown as { yAxisKey?: string }).yAxisKey || 'value';
    return rows.slice(0, 500).map((r) => ({ [xKey]: toNum(r[xk]) ?? r[xk], [yName]: toNum(r[yk]) ?? r[yk] }));
  }

  const series = (chart.series || []) as unknown as Array<{ dataKey?: string }>;
  const seriesKeys = series.map((s) => s.dataKey).filter((k): k is string => !!k);
  const measures = spec.measures || [];
  if (seriesKeys.length === 0 || measures.length === 0) return null;
  if (!seriesKeys.every((k) => measures.some((m) => m.dataKey === k))) return null;

  const dimKey = resolve(spec.dimension);
  if (!dimKey) return null;

  const resolved: Array<{ dataKey: string; key?: string; agg: string }> = [];
  for (const m of measures.filter((mm) => seriesKeys.includes(mm.dataKey))) {
    const agg = String(m.agg || 'SUM').toUpperCase();
    const wantsColumn = m.column && m.column !== '*';
    const key = wantsColumn ? resolve(m.column) : undefined;
    if (wantsColumn && !key) return null;
    if (!wantsColumn && agg !== 'COUNT') return null;
    resolved.push({ dataKey: m.dataKey, key, agg });
  }

  const groups = new Map<string, Row[]>();
  rows.forEach((r) => {
    const label = bucketLabel(r[dimKey], spec.bucket);
    const g = groups.get(label);
    if (g) g.push(r); else groups.set(label, [r]);
  });

  const out: Row[] = Array.from(groups, ([label, rs]) => {
    const o: Row = { [xKey]: label };
    resolved.forEach((m) => { o[m.dataKey] = aggregate(rs, m.key, m.agg); });
    return o;
  });

  const timeLike = chart.type === 'LineChart' || chart.type === 'AreaChart';
  const mode = spec.sort ?? (timeLike ? 'x_asc' : 'value_desc');
  const first = seriesKeys[0];
  out.sort((a, b) => {
    if (mode === 'value_desc') return Number(b[first]) - Number(a[first]);
    if (mode === 'value_asc') return Number(a[first]) - Number(b[first]);
    const la = String(a[xKey]); const lb = String(b[xKey]);
    return la.localeCompare(lb, undefined, { numeric: true });
  });

  const limit = spec.limit && spec.limit > 0 ? spec.limit : originalLen > 0 ? originalLen : out.length;
  return out.slice(0, limit);
};

/** Fallback when a chart has no spec: filter the chart's own rows, but only by columns the chart actually contains. */
const directFilter = (data: Row[], pairs: Array<[string, string]>) => {
  const resolve = makeResolver(data);
  const skipped: string[] = [];
  let applied = 0;
  const usable: Array<[string, string]> = [];
  pairs.forEach(([col, val]) => {
    if (resolve(col)) { usable.push([col, val]); applied += 1; } else skipped.push(col);
  });
  return { out: applyFilters(data, usable, resolve), applied, skipped };
};

/* ------------------------------------------------------------------ */
/*  Per-chart filter                                                   */
/* ------------------------------------------------------------------ */
interface ChartResult { data: Row[]; mode: 'original' | 'recomputed' | 'direct'; rows: number; applied: number; skipped: string[]; }

const selectCls = 'max-w-[170px] cursor-pointer truncate rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none transition hover:bg-black/50 focus:border-cyan-400/60';

const LocalFilteredChart = ({
  chartConfig, filterOptions, baseRows, rawRows, activeFilters,
}: {
  chartConfig: ChartConfig;
  filterOptions: DynamicFilter[];
  baseRows: Row[];      // raw rows after the GLOBAL filters
  rawRows: Row[];       // all raw rows
  activeFilters: Record<string, string>;
}) => {
  const [local, setLocal] = useState<{ column: string; value: string }>({ column: '', value: 'ALL' });
  const chart = chartConfig as SpecChart;

  const globalPairs = useMemo(
    () => Object.entries(activeFilters).filter(([, v]) => v !== 'ALL') as Array<[string, string]>,
    [activeFilters]
  );
  const localActive = !!local.column && local.value !== 'ALL';

  const result: ChartResult = useMemo(() => {
    const original = ((chart.data || []) as unknown as Row[]);
    if (globalPairs.length === 0 && !localActive) {
      return { data: original, mode: 'original', rows: rawRows.length, applied: 0, skipped: [] };
    }

    const resolveRaw = makeResolver(rawRows);
    const rows = localActive ? applyFilters(baseRows, [[local.column, local.value]], resolveRaw) : baseRows;

    const rebuilt = rawRows.length > 0 ? rebuildChart(chart, rows, resolveRaw, original.length) : null;
    if (rebuilt) return { data: rebuilt, mode: 'recomputed', rows: rows.length, applied: 0, skipped: [] };

    const pairs: Array<[string, string]> = [...globalPairs, ...(localActive ? [[local.column, local.value] as [string, string]] : [])];
    const { out, applied, skipped } = directFilter(original, pairs);
    return { data: out, mode: 'direct', rows: out.length, applied, skipped };
  }, [chart, globalPairs, localActive, local, baseRows, rawRows]);

  const colOptions = filterOptions.find((f) => f.column === local.column)?.options || [];

  let note: { text: string; tone?: 'info' | 'warn' } | undefined;
  if (result.mode === 'recomputed') {
    note = { text: `Recalculated from ${result.rows.toLocaleString()} matching rows` };
  } else if (result.mode === 'direct') {
    note = result.applied === 0
      ? { text: 'Filters cannot be applied to this chart', tone: 'warn' }
      : result.skipped.length > 0
        ? { text: `Not filtered by ${result.skipped.join(', ')}`, tone: 'warn' }
        : { text: 'Filtered chart rows' };
  }

  const control = filterOptions.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className={`h-3.5 w-3.5 ${localActive ? 'text-cyan-300' : 'text-slate-500'}`} />
      <select
        aria-label="Filter this chart by column"
        value={local.column}
        onChange={(e) => setLocal({ column: e.target.value, value: 'ALL' })}
        className={selectCls}
      >
        <option value="">Filter this chart</option>
        {filterOptions.map((f) => <option key={f.column} value={f.column}>{f.label}</option>)}
      </select>
      {local.column && (
        <>
          <select
            aria-label="Filter value"
            value={local.value}
            onChange={(e) => setLocal((p) => ({ ...p, value: e.target.value }))}
            className={`${selectCls} ${localActive ? 'border-cyan-400/40 bg-cyan-400/10' : ''}`}
          >
            <option value="ALL">All</option>
            {colOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button
            onClick={() => setLocal({ column: '', value: 'ALL' })}
            className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Clear chart filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  ) : undefined;

  const filteredConfig = { ...chartConfig, data: result.data } as unknown as ChartConfig;
  return <DynamicChart config={filteredConfig} headerAction={control} note={note} />;
};

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */
export const Dashboard: React.FC<Props> = ({ data, onReset }) => {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [drillSearch, setDrillSearch] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [resetKey, setResetKey] = useState(0); // remounts charts so their local filters clear too

  const drillRows = useMemo(() => ((data.drillDownData as unknown as Row[]) || []), [data.drillDownData]);
  const columns = Object.keys(drillRows[0] || {});
  const resolveRaw = useMemo(() => makeResolver(drillRows), [drillRows]);

  // Filter options: from the backend if provided, otherwise computed from the loaded rows
  const filterOptions = useMemo<DynamicFilter[]>(() => {
    if (drillRows.length === 0) return [];

    if (data.availableFilters && data.availableFilters.length > 0) {
      return data.availableFilters
        .map((filter): DynamicFilter => {
          if (typeof filter === 'string') {
            const key = resolveRaw(filter) || filter;
            return { column: key, label: filter.replace(/_/g, ' '), options: optionsFor(drillRows, key) };
          }
          const key = resolveRaw(filter.column) || filter.column;
          const options = filter.options?.length ? filter.options.map(String) : optionsFor(drillRows, key);
          return { column: key, label: filter.label || key.replace(/_/g, ' '), options };
        })
        .filter((f) => f.options.length > 0);
    }

    const auto: DynamicFilter[] = [];
    Object.keys(drillRows[0]).forEach((key) => {
      const options = optionsFor(drillRows, key);
      if (options.length > 1 && options.length <= 15) {
        auto.push({ column: key, label: key.replace(/_/g, ' '), options });
      }
    });
    return auto;
  }, [data.availableFilters, drillRows, resolveRaw]);

  const handleFilterChange = (column: string, value: string) => {
    setActiveFilters((prev) => ({ ...prev, [column]: value }));
    setVisible(PAGE);
  };

  const resetAllFilters = () => {
    setActiveFilters({});
    setResetKey((k) => k + 1);
    setVisible(PAGE);
  };

  const activePairs = useMemo(
    () => Object.entries(activeFilters).filter(([, v]) => v !== 'ALL') as Array<[string, string]>,
    [activeFilters]
  );
  const activeFilterCount = activePairs.length;
  const hasActiveFilters = activeFilterCount > 0;

  // 1) Rows after the GLOBAL filters only. Charts are rebuilt from these.
  const globalFilteredRows = useMemo(
    () => applyFilters(drillRows, activePairs, resolveRaw),
    [drillRows, activePairs, resolveRaw]
  );

  // 2) The explorer additionally applies the search box (the search must not change the charts).
  const explorerRows = useMemo(() => {
    const q = drillSearch.toLowerCase().trim();
    if (!q) return globalFilteredRows;
    return globalFilteredRows.filter((row) => Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [globalFilteredRows, drillSearch]);

  const sampled = drillRows.length >= DRILL_LIMIT;

  const glance = [
    { icon: BarChart3, label: 'Charts', value: (data.charts || []).length },
    { icon: Table2, label: 'Records explored', value: drillRows.length },
    { icon: AlertTriangle, label: 'Anomalies flagged', value: (data.anomalies || []).length },
    { icon: Lightbulb, label: 'Recommendations', value: (data.recommendations || []).length },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-10 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={onReset}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          <ArrowLeft className="h-4 w-4" /> Analyze a new dataset
        </button>

        <div className="flex flex-wrap items-center gap-3">
          {(data.exportLinks || []).map((link: ExportLink, idx: number) => (
            <a
              key={idx} href={link.url} download
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-cyan-300 transition hover:bg-white/10"
            >
              <Download className="h-3.5 w-3.5" /> {link.label}
            </a>
          ))}
          <span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3.5 py-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            Live BI engine active
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {glance.map(({ icon: Icon, label, value }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`${card} p-5`}
          >
            <Icon className="h-4 w-4 text-cyan-300" />
            <p className="font-display mt-3 text-3xl font-bold text-white">{value.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-slate-400">{label}</p>
          </motion.div>
        ))}
      </div>

      {filterOptions.length > 0 && (
        <div className={`${card} sticky top-20 z-20 bg-[#0b111a]/85 p-4 backdrop-blur-xl`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Filter className="h-4 w-4 text-cyan-300" /> Global filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[11px] text-cyan-300" style={{ fontFamily: 'var(--font-mono)' }}>{activeFilterCount} active</span>
              )}
            </span>

            {filterOptions.map((filter) => (
              <select
                key={filter.column}
                value={activeFilters[filter.column] || 'ALL'}
                onChange={(e) => handleFilterChange(filter.column, e.target.value)}
                aria-label={`Filter by ${filter.label}`}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs text-white outline-none transition focus:border-cyan-400/60 ${
                  (activeFilters[filter.column] || 'ALL') !== 'ALL' ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-black/30 hover:bg-black/50'
                }`}
              >
                <option value="ALL">All {filter.label}</option>
                {filter.options.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
              </select>
            ))}

            {hasActiveFilters && (
              <button onClick={resetAllFilters} className="ml-auto flex items-center gap-1 text-xs text-amber-300 transition hover:text-amber-200">
                <X className="h-3.5 w-3.5" /> Reset filters
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <p className="mt-3 text-xs text-slate-400" style={{ fontFamily: 'var(--font-mono)' }}>
              {globalFilteredRows.length.toLocaleString()} of {drillRows.length.toLocaleString()} rows match
              {sampled && ` · filtering uses the first ${DRILL_LIMIT.toLocaleString()} rows of your file, so totals can differ from the unfiltered charts`}
            </p>
          )}
        </div>
      )}

      {data.summary && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-white/[0.03] to-emerald-500/10 p-8 backdrop-blur-md md:p-10"
        >
          <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
          <SectionTitle icon={Sparkles}>Executive summary</SectionTitle>
          <div className={`${PROSE} mt-4 text-base text-slate-200`}>
            <ReactMarkdown>{renderText(data.summary).replace(/\\n/g, '\n')}</ReactMarkdown>
          </div>
        </motion.div>
      )}

      {data.charts && data.charts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {data.charts.map((chartConfig, idx) => (
            <LocalFilteredChart
              key={`${idx}-${resetKey}`}
              chartConfig={chartConfig}
              filterOptions={filterOptions}
              baseRows={globalFilteredRows}
              rawRows={drillRows}
              activeFilters={activeFilters}
            />
          ))}
        </div>
      )}

      {drillRows.length > 0 && (
        <div className={`${card} p-6`}>
          <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <SectionTitle icon={Layers}>Raw data explorer</SectionTitle>
              <p className="mt-1 text-xs text-slate-500" style={{ fontFamily: 'var(--font-mono)' }}>
                showing {Math.min(visible, explorerRows.length).toLocaleString()} of {explorerRows.length.toLocaleString()} matching rows
              </p>
            </div>
            <label className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search any field..."
                value={drillSearch}
                onChange={(e) => { setDrillSearch(e.target.value); setVisible(PAGE); }}
                className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/40"
              />
            </label>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="sticky top-0 z-10 bg-[#101826] text-xs font-semibold text-slate-300">
                <tr>
                  {columns.map((key) => (
                    <th key={key} className="whitespace-nowrap border-b border-white/10 px-4 py-3">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {explorerRows.slice(0, visible).map((row, i) => (
                  <tr key={i} className="transition-colors even:bg-white/[0.02] hover:bg-cyan-400/5">
                    {columns.map((col) => (
                      <td key={col} className="whitespace-nowrap px-4 py-2.5">{renderText(row[col]) || '-'}</td>
                    ))}
                  </tr>
                ))}
                {explorerRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length || 1} className="px-4 py-14 text-center text-slate-500">
                      No records match. Clear the search or reset the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {explorerRows.length > visible && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisible((v) => v + PAGE)}
                className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                Show {Math.min(PAGE, explorerRows.length - visible)} more rows
              </button>
            </div>
          )}
        </div>
      )}

      {data.detailedReport && (
        <div className={`${card} p-8 md:p-10`}>
          <SectionTitle icon={FileText}>Detailed report</SectionTitle>
          <div className={`${PROSE} mt-5`}>
            <ReactMarkdown>{renderText(data.detailedReport).replace(/\\n/g, '\n')}</ReactMarkdown>
          </div>
        </div>
      )}

      {data.anomalies && data.anomalies.length > 0 && (
        <div className="space-y-5">
          <SectionTitle icon={AlertTriangle} tone="text-amber-300">Anomalies worth a look</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {data.anomalies.map((item: Anomaly, idx: number) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className="flex flex-col justify-between rounded-2xl border border-white/10 border-l-4 border-l-amber-400 bg-white/[0.03] p-5 backdrop-blur-md"
              >
                <div>
                  <span className="rounded bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300" style={{ fontFamily: 'var(--font-mono)' }}>
                    {renderText(item.metric)}
                  </span>
                  <h4 className="font-display mt-3 text-base font-bold text-white">{renderText(item.anomaly)}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{renderText(item.description)}</p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-500">
                  <span>Signal value</span>
                  <strong className="text-sm text-white" style={{ fontFamily: 'var(--font-mono)' }}>{renderText(item.value)}</strong>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {data.recommendations && data.recommendations.length > 0 && (
        <div className="space-y-5">
          <SectionTitle icon={Lightbulb} tone="text-violet-300">Recommended next steps</SectionTitle>
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {data.recommendations.map((rec: unknown, idx: number) => (
              <li key={idx} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent p-5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-400/40 bg-[#0b111a] text-xs text-violet-300" style={{ fontFamily: 'var(--font-mono)' }}>
                  {idx + 1}
                </span>
                <p className="text-sm leading-relaxed text-slate-300">{renderText(rec)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="pt-4">
        <ChatAssistant fileLocation={data.fileLocation || ''} sessionId={data.sessionId || ''} />
      </div>
    </div>
  );
};
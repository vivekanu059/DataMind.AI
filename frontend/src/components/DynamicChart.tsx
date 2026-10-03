import React, { useId } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ChartConfig } from '../types/dashboard';
import { motion } from 'framer-motion';

interface Props {
  config: ChartConfig;
  /** Optional controls rendered between the title and the plot (used for the per-chart filter). */
  headerAction?: React.ReactNode;
  /** Optional one-line status under the description, e.g. "Recalculated from 1,204 matching rows". */
  note?: { text: string; tone?: 'info' | 'warn' };
}

// Same hues as the homepage: cyan and emerald lead, the rest are distinct enough to tell apart
const COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#60a5fa'];
const AXIS = '#64748b';
const GRID = 'rgba(255,255,255,0.06)';

const TYPE_LABEL: Record<string, string> = {
  BarChart: 'Bar',
  LineChart: 'Line',
  AreaChart: 'Area',
  PieChart: 'Pie',
  ScatterChart: 'Scatter',
};

interface TipProps {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: string | number; color?: string }>;
  label?: string | number;
}

const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : String(v ?? ''));

const ChartTooltip: React.FC<TipProps> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b111a]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-xl">
      {label !== undefined && label !== '' && <p className="mb-1.5 font-semibold text-white">{String(label)}</p>}
      <ul className="space-y-1">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-400">{p.name}</span>
            <span className="ml-auto pl-4 text-white" style={{ fontFamily: 'var(--font-mono)' }}>{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const axisProps = { stroke: AXIS, fontSize: 11, tickLine: false, axisLine: { stroke: GRID } } as const;
const legendProps = { wrapperStyle: { paddingTop: '12px', fontSize: '12px', color: '#94a3b8' } } as const;

export const DynamicChart: React.FC<Props> = ({ config, headerAction, note }) => {
  const uid = useId().replace(/:/g, '');
  const chartData = Array.isArray(config.data) ? config.data : [];
  const series = config.series || [];
  const gradId = (i: number) => `${uid}-g${i}`;
  const colorOf = (i: number, own?: string) => own || COLORS[i % COLORS.length];

  const gradients = (
    <defs>
      {series.map((s, i) => {
        const c = colorOf(i, s.fill || s.stroke);
        return (
          <linearGradient key={i} id={gradId(i)} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity={0.55} />
            <stop offset="100%" stopColor={c} stopOpacity={0.02} />
          </linearGradient>
        );
      })}
    </defs>
  );

  const renderChart = () => {
    switch (config.type) {
      case 'ScatterChart':
        return (
          <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis type="number" dataKey={config.xAxisKey} name={config.xAxisKey} {...axisProps} />
            <YAxis type="number" dataKey={config.yAxisKey || 'value'} name={config.yAxisKey || 'value'} {...axisProps} />
            <ZAxis range={[60, 400]} />
            <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {series.map((s, i) => (
              <Scatter key={i} name={s.name} data={chartData} fill={colorOf(i, s.fill)} fillOpacity={0.75} />
            ))}
          </ScatterChart>
        );

      case 'LineChart':
        return (
          <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={config.xAxisKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {series.map((s, i) => (
              <Line
                key={i} type="monotone" dataKey={s.dataKey} name={s.name}
                stroke={colorOf(i, s.stroke)} strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: colorOf(i, s.stroke) }}
                activeDot={{ r: 6, stroke: '#0b111a', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );

      case 'AreaChart':
        return (
          <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            {gradients}
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={config.xAxisKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {series.map((s, i) => (
              <Area
                key={i} type="monotone" dataKey={s.dataKey} name={s.name}
                stroke={colorOf(i, s.stroke || s.fill)} strokeWidth={2}
                fill={s.fill ? s.fill : `url(#${gradId(i)})`} fillOpacity={s.fill ? 0.3 : 1}
              />
            ))}
          </AreaChart>
        );

      case 'PieChart':
        return (
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Legend {...legendProps} />
            <Pie
              data={chartData}
              dataKey={(series[0]?.dataKey) || 'value'}
              nameKey={config.xAxisKey}
              cx="50%" cy="50%" innerRadius={62} outerRadius={100} paddingAngle={2}
              stroke="#0b111a" strokeWidth={2}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );

      case 'BarChart':
      default:
        return (
          <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            {gradients}
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={config.xAxisKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<ChartTooltip />} />
            <Legend {...legendProps} />
            {series.map((s, i) => (
              <Bar
                key={i} dataKey={s.dataKey} name={s.name}
                fill={s.fill ? s.fill : `url(#${gradId(i)})`}
                stroke={colorOf(i, s.fill)} strokeOpacity={0.6}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        );
    }
  };

  const isEmpty = chartData.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-[400px] flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md transition-colors hover:border-cyan-400/30"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display truncate text-lg font-bold text-white">{config.title}</h3>
          {config.description && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{config.description}</p>}
          {note && (
            <p className={`mt-1 text-xs ${note.tone === 'warn' ? 'text-amber-300' : 'text-cyan-300'}`} style={{ fontFamily: 'var(--font-mono)' }}>
              {note.text}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
          {TYPE_LABEL[config.type] || 'Bar'}
        </span>
      </div>

      {headerAction && <div className="mb-3">{headerAction}</div>}

      <div className="min-h-0 w-full flex-1">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
            No rows match the current filters.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        )}
      </div>
    </motion.div>
  );
};
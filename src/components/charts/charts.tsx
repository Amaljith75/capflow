"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/money";

const GREEN = "#0e6b46";
const GREEN_SOFT = "#8fd3ae";
const INK = "#0c100d";
const GRID = "#e5e8e3";
const MUTED = "#6b736d";

const axis = { stroke: "transparent", tick: { fill: MUTED, fontSize: 12 }, tickLine: false, axisLine: false } as const;

function MoneyTooltip({ active, payload, label, currency }: {
  active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-pop">
      <p className="mb-1 text-white/60">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center justify-between gap-6 tabular">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-medium">{formatMoney(Number(p.value ?? 0).toFixed(2), currency)}</span>
        </p>
      ))}
    </div>
  );
}

const compact = (currency: string) => (value: number) => formatMoney(value, currency, true);

export function CashflowChart({ data, currency }: { data: { label: string; Invoiced: number; Collected: number }[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barGap={6} margin={{ left: 4, right: 4, top: 8 }}>
        <defs>
          <linearGradient id="cf-collected" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} /><stop offset="100%" stopColor="#12804f" stopOpacity={0.75} /></linearGradient>
          <linearGradient id="cf-invoiced" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#cfe3d6" /><stop offset="100%" stopColor="#e9f1ec" /></linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} tickFormatter={compact(currency)} width={64} />
        <Tooltip cursor={{ fill: "rgb(12 16 13 / 0.04)" }} content={<MoneyTooltip currency={currency} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Bar dataKey="Invoiced" fill="url(#cf-invoiced)" radius={[8, 8, 2, 2]} maxBarSize={36} />
        <Bar dataKey="Collected" fill="url(#cf-collected)" radius={[8, 8, 2, 2]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OutstandingChart({ data, currency }: { data: { label: string; Outstanding: number; Collected: number }[]; currency: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
        <defs>
          <linearGradient id="cf-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={INK} stopOpacity={0.14} /><stop offset="100%" stopColor={INK} stopOpacity={0} /></linearGradient>
          <linearGradient id="cf-col" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.28} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} tickFormatter={compact(currency)} width={64} />
        <Tooltip content={<MoneyTooltip currency={currency} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Area type="monotone" dataKey="Outstanding" stroke={INK} strokeWidth={2} fill="url(#cf-out)" />
        <Area type="monotone" dataKey="Collected" stroke={GREEN} strokeWidth={2} fill="url(#cf-col)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RateChart({ data }: { data: { label: string; rate: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} tickFormatter={(v: number) => `${v}%`} width={48} />
        <Tooltip formatter={(value) => [`${value}%`, "Collected vs invoiced"]} contentStyle={{ borderRadius: 12, border: `1px solid ${GRID}`, fontSize: 12 }} />
        <Line type="monotone" dataKey="rate" stroke={GREEN} strokeWidth={2.5} dot={{ r: 3, fill: GREEN }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

const RISK_COLORS: Record<string, string> = { Low: GREEN, Medium: "#d99a1c", High: "#d92d20" };

export function RiskDonut({ data, currency }: { data: { name: string; value: number; customers: number }[]; currency: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={2} stroke="none">
              {data.map((d) => <Cell key={d.name} fill={RISK_COLORS[d.name] ?? GREEN_SOFT} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted">At risk</span>
          <span className="text-sm font-semibold tabular">{formatMoney(total, currency, true)}</span>
        </div>
      </div>
      <ul className="flex min-w-40 flex-1 flex-col gap-2.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: RISK_COLORS[d.name] }} />{d.name} risk<span className="text-xs text-faint">{d.customers}</span></span>
            <span className="font-medium tabular">{formatMoney(d.value.toFixed(2), currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

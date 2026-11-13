"use client";
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "#8d95a4", fontSize: 11 };
const tip = { contentStyle: { background: "#1b212a", border: "1px solid #2a313c", borderRadius: 6, fontSize: 12 }, labelStyle: { color: "#e7e9ee" } };

export function ActivityChart({ data }: { data: { date: string; jobs: number; suppliers: number; findings: number }[] }) {
  const empty = data.every((d) => d.jobs + d.suppliers + d.findings === 0);
  if (empty) return <p className="py-10 text-center text-[13px] text-muted">No activity recorded in the last 30 days.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily research jobs, suppliers discovered and security findings over the last 30 days">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="#2a313c" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} {...axis} minTickGap={24} />
          <YAxis allowDecimals={false} {...axis} />
          <Tooltip {...tip} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="suppliers" name="Suppliers discovered" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
          <Area type="monotone" dataKey="jobs" name="Research jobs" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.15} />
          <Area type="monotone" dataKey="findings" name="Security findings" stroke="#f87171" fill="#f87171" fillOpacity={0.15} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const SEV_COLOR: Record<string, string> = { CRITICAL: "#f87171", HIGH: "#fb923c", MEDIUM: "#fbbf24", LOW: "#60a5fa", INFO: "#8d95a4" };
export function SeverityChart({ data }: { data: { severity: string; count: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-[13px] text-muted">No security findings yet.</p>;
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  const rows = order.map((s) => ({ severity: s, count: data.find((d) => d.severity === s)?.count ?? 0 })).filter((r) => r.count);
  return (
    <div className="h-56 w-full" role="img" aria-label="Security findings by severity">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="#2a313c" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="severity" {...axis} /><YAxis allowDecimals={false} {...axis} /><Tooltip {...tip} />
          <Bar dataKey="count" name="Findings" radius={[3, 3, 0, 0]}>{rows.map((r) => <Cell key={r.severity} fill={SEV_COLOR[r.severity]} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

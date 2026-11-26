"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from "recharts";

const money = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0));
const tip = { contentStyle: { borderRadius: 12, fontSize: 12 }, formatter: (v: unknown) => `AED ${Number(v).toLocaleString("en-AE", { minimumFractionDigits: 2 })}` };

export function DailyChart({ data }: { data: { date: string; sales: number; purchases: number; expenses: number; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data.map((d) => ({ ...d, day: d.date.slice(8) }))} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b833" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={money} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip {...tip} labelFormatter={(_, p) => (p?.[0]?.payload?.date as string) ?? ""} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="sales" name="Sales" fill="#2554e8" radius={[4, 4, 0, 0]} />
        <Bar dataKey="purchases" name="Purchases" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlyChart({ data }: { data: { month: string; sales: number; purchases: number; expenses: number; profit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b833" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={money} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip {...tip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="sales" name="Sales" stroke="#2554e8" strokeWidth={2} dot={false} />
        <Line dataKey="purchases" name="Purchases" stroke="#0ea5e9" strokeWidth={2} dot={false} />
        <Line dataKey="expenses" name="Expenses" stroke="#f59e0b" strokeWidth={2} dot={false} />
        <Line dataKey="profit" name="Profit" stroke="#10b981" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

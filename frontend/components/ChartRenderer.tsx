"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";

type ChartSpec = {
  type: string;
  title: string;
  data: any[];
  xKey: string;
  yKey: string;
  xLabel?: string;
  yLabel?: string;
};

const COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#be185d', '#65a30d'];

function fmtVal(value: any): string {
  if (typeof value !== "number") return String(value);
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return value % 1 === 0 ? value.toString() : value.toFixed(2);
}

const TooltipStyle = {
  borderRadius: "12px",
  border: "none",
  boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  padding: "10px 14px",
  fontSize: "13px",
};

export default function ChartRenderer({ chart }: { chart: ChartSpec | null }) {
  if (!chart || !chart.data || chart.data.length === 0) return null;

  const xKey = chart.xKey || Object.keys(chart.data[0])[0];
  const yKey = chart.yKey || Object.keys(chart.data[0])[1] || xKey;

  const renderChart = () => {
    switch (chart.type) {
      case "bar":
        return (
          <BarChart data={chart.data} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={false}
              tickLine={false}
              angle={chart.data.length > 5 ? -30 : 0}
              textAnchor={chart.data.length > 5 ? "end" : "middle"}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={fmtVal}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip
              contentStyle={TooltipStyle}
              formatter={(v: any) => [fmtVal(v), chart.yLabel || yKey]}
              labelFormatter={(l) => `${chart.xLabel || xKey}: ${l}`}
              cursor={{ fill: "#f8fafc" }}
            />
            <Bar dataKey={yKey} radius={[6, 6, 0, 0]} maxBarSize={52}>
              {chart.data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
              <LabelList dataKey={yKey} position="top" formatter={fmtVal} style={{ fontSize: 10, fill: "#6b7280" }} />
            </Bar>
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={chart.data} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={false}
              tickLine={false}
              angle={chart.data.length > 5 ? -30 : 0}
              textAnchor={chart.data.length > 5 ? "end" : "middle"}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6b7280" }}
              tickFormatter={fmtVal}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip
              contentStyle={TooltipStyle}
              formatter={(v: any) => [fmtVal(v), chart.yLabel || yKey]}
              labelFormatter={(l) => `${chart.xLabel || xKey}: ${l}`}
            />
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={COLORS[0]}
              strokeWidth={2.5}
              dot={{ r: 5, fill: "#fff", stroke: COLORS[0], strokeWidth: 2 }}
              activeDot={{ r: 7, fill: COLORS[0] }}
            />
          </LineChart>
        );

      case "pie":
        return (
          <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <Tooltip
              contentStyle={TooltipStyle}
              formatter={(v: any, name: any) => [fmtVal(v), name]}
            />
            <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
            <Pie
              data={chart.data}
              cx="50%"
              cy="45%"
              innerRadius="35%"
              outerRadius="65%"
              paddingAngle={3}
              dataKey={yKey}
              nameKey={xKey}
              label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {chart.data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        );

      default:
        return null;
    }
  };

  const body = renderChart();
  if (!body) return null;

  return (
    <div className="w-full rounded-xl border border-neutral-200 bg-white overflow-hidden mt-3">
      <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/60">
        <p className="text-[13px] font-semibold text-neutral-700">{chart.title}</p>
      </div>
      <div className="w-full" style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {body}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

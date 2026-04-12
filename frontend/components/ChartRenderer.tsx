"use client";

import { useRef, useCallback, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from "recharts";
import { Download, Check } from "lucide-react";

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
  const chartRef = useRef<HTMLDivElement>(null);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = useCallback(() => {
    const container = chartRef.current;
    if (!container) return;

    const svg = container.querySelector("svg");
    if (!svg) return;

    const svgClone = svg.cloneNode(true) as SVGElement;
    const svgW = svg.clientWidth || 800;
    const svgH = svg.clientHeight || 300;
    const titleH = 40;
    const totalH = svgH + titleH;

    // Create a wrapper SVG that includes the title text + the chart
    const wrapperSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wrapperSvg.setAttribute("width", String(svgW));
    wrapperSvg.setAttribute("height", String(totalH));
    wrapperSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    // White background
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "white");
    wrapperSvg.appendChild(bg);

    // Title text
    const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    titleEl.setAttribute("x", "16");
    titleEl.setAttribute("y", "26");
    titleEl.setAttribute("font-size", "14");
    titleEl.setAttribute("font-weight", "600");
    titleEl.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
    titleEl.setAttribute("fill", "#374151");
    titleEl.textContent = chart?.title || "Chart";
    wrapperSvg.appendChild(titleEl);

    // Offset the chart SVG below the title
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(0, ${titleH})`);
    // Move all children from the cloned chart SVG into the group
    while (svgClone.firstChild) {
      g.appendChild(svgClone.firstChild);
    }
    // Copy viewBox if present
    const viewBox = svgClone.getAttribute("viewBox");
    if (viewBox) {
      const inner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      inner.setAttribute("viewBox", viewBox);
      inner.setAttribute("width", String(svgW));
      inner.setAttribute("height", String(svgH));
      while (g.firstChild) inner.appendChild(g.firstChild);
      g.appendChild(inner);
    }
    wrapperSvg.appendChild(g);

    const svgData = new XMLSerializer().serializeToString(wrapperSvg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = svgW * scale;
      canvas.height = totalH * scale;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, svgW, totalH);

      const link = document.createElement("a");
      link.download = `${(chart?.title || "chart").replace(/[^a-zA-Z0-9]/g, "_")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    };
    img.src = url;
  }, [chart?.title]);

  if (!chart || !chart.data || chart.data.length === 0) return null;

  const xKey = chart.xKey || Object.keys(chart.data[0])[0];
  const yKey = chart.yKey || Object.keys(chart.data[0])[1] || xKey;

  const renderChart = () => {
    switch (chart.type) {
      case "bar":
        return (
          <BarChart data={chart.data} margin={{ top: 20, right: 20, bottom: 40, left: 10 }}>
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
      {/* Download button — outside ref so it doesn't appear in the PNG */}
      <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/60 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-neutral-700">{chart.title}</p>
        <button
          onClick={handleDownload}
          title="Download chart as PNG"
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-neutral-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg border border-transparent hover:border-violet-200 transition-all"
        >
          {downloaded ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Download className="w-3.5 h-3.5" />}
          {downloaded ? "Saved!" : "PNG"}
        </button>
      </div>
      <div ref={chartRef} className="w-full overflow-hidden bg-white" style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {body}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

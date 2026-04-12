"use client";

import ChartRenderer from "./ChartRenderer";

interface InsightCardProps {
  message: {
    id: string;
    content: string;
    insight?: string;
    chart?: any;
    code_used?: string;
    clarification?: string;
    isError?: boolean;
    follow_up?: string[];
  };
  onFollowUp?: (q: string) => void;
}

/** Renders bold (**text**) and newlines into React nodes */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, li) => {
        if (!line.trim()) return <div key={li} className="h-0.5" />;
        if (line.includes(" | ") || /^[\s\-|]+$/.test(line)) return null;

        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={li} className="leading-[1.75] text-neutral-800">
            {parts.map((part, pi) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={pi} className="font-bold text-neutral-900">{part.slice(2, -2)}</strong>
                : <span key={pi}>{part}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

/** Detects and renders markdown tables inside content */
function ContentBlock({ text, isError }: { text: string; isError?: boolean }) {
  const lines = text.split("\n");
  const blocks: { type: "text" | "table"; lines: string[] }[] = [];
  let currentText: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableRow = line.includes(" | ");
    const isSep = /^[\s\-|]+$/.test(line) && line.includes("|");

    if (isTableRow || isSep) {
      if (currentText.length > 0) {
        blocks.push({ type: "text", lines: currentText });
        currentText = [];
      }
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i].includes(" | ") || (/^[\s\-|]+$/.test(lines[i]) && lines[i].includes("|")))) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;
      blocks.push({ type: "table", lines: tableLines });
    } else {
      currentText.push(line);
    }
  }
  if (currentText.length > 0) blocks.push({ type: "text", lines: currentText });

  return (
    <div className={`text-[14px] ${isError ? "text-red-900" : "text-neutral-800"}`}>
      {blocks.map((block, bi) => {
        if (block.type === "text") {
          return <RichText key={bi} text={block.lines.join("\n")} />;
        }
        const rows = block.lines.filter(l => !(/^[\s\-|]+$/.test(l) && l.includes("|")));
        if (rows.length === 0) return null;
        const headers = rows[0].split("|").map(h => h.trim()).filter(Boolean);
        const dataRows = rows.slice(1).map(r => r.split("|").map(c => c.trim()).filter(Boolean));
        return (
          <div key={bi} className="my-4 overflow-x-auto rounded-2xl border border-neutral-200 shadow-sm">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  {headers.map((h, hi) => (
                    <th key={hi} className="px-4 py-3 text-left font-bold text-neutral-500 uppercase tracking-wide text-[11px] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className={`border-t border-neutral-100 ${ri % 2 === 0 ? "bg-white" : "bg-neutral-50/40"} hover:bg-primary/5 transition-colors`}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-4 py-2.5 text-neutral-700 font-medium">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default function InsightCard({ message, onFollowUp }: InsightCardProps) {
  return (
    <div className={`flex flex-col gap-4 p-5 rounded-2xl border shadow-sm ${
      message.isError
        ? "bg-red-50/50 border-red-100"
        : "bg-white border-neutral-100 shadow-neutral-100/30"
    }`}>

      {/* Answer */}
      <ContentBlock text={message.content} isError={message.isError} />

      {/* Chart */}
      {message.chart && message.chart.type !== "none" && (
        <div className="mt-1 w-full">
          <ChartRenderer chart={message.chart} />
        </div>
      )}

      {/* Business Insight */}
      {message.insight && !message.isError && (
        <div className="flex items-start gap-2.5 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
          <span className="text-base shrink-0 mt-0.5">💡</span>
          <p className="text-[13px] text-amber-900 leading-relaxed font-medium">
            {message.insight}
          </p>
        </div>
      )}

      {/* Follow-up suggestions */}
      {message.follow_up && message.follow_up.length > 0 && !message.isError && (
        <div className="border-t border-neutral-100 pt-4">
          <p className="text-[10.5px] font-bold uppercase tracking-widest text-neutral-400 mb-2.5">You might also ask</p>
          <div className="flex flex-col gap-1.5">
            {message.follow_up.map((q, i) => (
              <button
                key={i}
                onClick={() => onFollowUp?.(q)}
                className="flex items-center gap-2 text-left text-[13px] px-3.5 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all group"
              >
                <span className="w-4 h-4 rounded-full bg-neutral-200 group-hover:bg-primary/20 flex items-center justify-center shrink-0 text-[10px] font-bold text-neutral-500 group-hover:text-primary transition-colors">
                  {i + 1}
                </span>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error detail */}
      {message.isError && message.insight && (
        <div className="bg-red-50 border border-red-200 p-3 rounded-xl text-red-700 font-mono text-xs overflow-auto">
          {message.insight}
        </div>
      )}
    </div>
  );
}

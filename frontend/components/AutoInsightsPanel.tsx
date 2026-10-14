"use client";

import { useState, useEffect } from "react";
import { analyzeData, fetchModels, ProviderGroup, ModelDef } from "@/lib/api";
import { Sparkles, X, RefreshCw, AlertCircle, MessageSquare, Copy, Check, ChevronDown } from "lucide-react";
import { trackInsightGenerated } from "@/lib/analytics";

interface InsightItem {
  title: string;
  body: string;
  type: string;
  icon: string;
}

interface AutoInsightsPanelProps {
  workspaceId: string;
  analysisId: string;
  dataset: string;
  selectedDatasets: string[];
  model: string;
  cachedInsights?: InsightItem[];
  onClose: () => void;
  onInsightsLoaded?: (items: InsightItem[]) => void;
  onAskInChat?: (question: string) => void;
}

const TYPE_STYLES: Record<string, string> = {
  trend:          "bg-blue-50  border-blue-100  text-blue-700",
  top_performer:  "bg-amber-50 border-amber-100 text-amber-700",
  anomaly:        "bg-red-50   border-red-100   text-red-700",
  summary:        "bg-neutral-50 border-neutral-200 text-neutral-600",
  opportunity:    "bg-emerald-50 border-emerald-100 text-emerald-700",
};

const TYPE_LABELS: Record<string, string> = {
  trend:         "Trend",
  top_performer: "Top Performer",
  anomaly:       "Anomaly",
  summary:       "Summary",
  opportunity:   "Opportunity",
};

const ANALYSIS_STEPS = [
  "Reading dataset structure",
  "Computing numeric statistics",
  "Finding top & bottom performers",
  "Detecting monthly trends",
  "Comparing recent vs prior period",
  "Scanning for statistical anomalies",
  "Synthesizing key insights",
];

function InsightBadge({ type }: { type: string }) {
  const cls = TYPE_STYLES[type] ?? TYPE_STYLES.summary;
  return (
    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${cls}`}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

function LoadingSteps({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      {/* Spinner */}
      <div className="relative">
        <div className="w-16 h-16 border-4 border-violet-100 border-t-violet-500 rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-violet-400 animate-pulse" />
        </div>
      </div>

      {/* Step list */}
      <div className="w-full max-w-xs flex flex-col gap-2">
        {ANALYSIS_STEPS.map((step, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-500 ${
                done
                  ? "opacity-40"
                  : active
                  ? "bg-violet-50 border border-violet-100"
                  : "opacity-20"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] transition-all ${
                  done
                    ? "bg-emerald-100 text-emerald-600"
                    : active
                    ? "bg-violet-500 text-white animate-pulse"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                {done ? "✓" : active ? "⟳" : i + 1}
              </div>
              <span
                className={`text-xs font-semibold ${
                  done ? "text-neutral-400 line-through" : active ? "text-violet-700" : "text-neutral-300"
                }`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AutoInsightsPanel({
  workspaceId,
  analysisId,
  dataset,
  selectedDatasets,
  model,
  cachedInsights,
  onClose,
  onInsightsLoaded,
  onAskInChat,
}: AutoInsightsPanelProps) {
  const hasCached = (cachedInsights?.length ?? 0) > 0;
  const [insights, setInsights] = useState<InsightItem[]>(cachedInsights ?? []);
  const [activeModel, setActiveModel] = useState(model || "openai/gpt-oss-120b");
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [ran, setRan] = useState(hasCached);
  const [currentStep, setCurrentStep] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchModels().then(setProviders).catch(() => {});
  }, []);

  // Animate step progression while loading
  useEffect(() => {
    if (!loading) {
      setCurrentStep(0);
      return;
    }
    setCurrentStep(0);
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < ANALYSIS_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 1100);
    return () => clearInterval(interval);
  }, [loading]);

  const run = async (modelToUse?: string) => {
    const targetModel = modelToUse ?? activeModel;
    setLoading(true);
    setError(null);
    setInsights([]);
    const startTime = Date.now();
    try {
      const res = await analyzeData(workspaceId, analysisId, dataset, targetModel, selectedDatasets);
      const items: InsightItem[] = res.data.insights ?? [];
      setInsights(items);
      if (res.data.throttled) setThrottled(true);
      setRan(true);
      onInsightsLoaded?.(items);
      trackInsightGenerated({
        analysis_id: analysisId,
        response_time_ms: Date.now() - startTime,
        insight_count: items.length,
      });
    } catch (err: any) {
      const raw: string =
        err?.response?.data?.detail ??
        err?.message ??
        "";
      const isAllExhausted = raw.toLowerCase().includes("all model fallbacks exhausted");
      const isQuota = err?.response?.status === 429;
      const isBusy = err?.response?.status === 503;

      const msg = isAllExhausted
        ? "AI models are currently unavailable. You can try another model below or try again in a moment."
        : isQuota
        ? "Model quota exceeded. Please switch to a different model and try again."
        : isBusy
        ? "The model is temporarily busy. Please try again or choose another provider below."
        : "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Auto-run on mount if no cached insights
  useEffect(() => {
    if (!ran && !loading && !error) {
      run(activeModel);
    }
  }, []);

  const handleCopyAll = () => {
    const text = insights
      .map((ins, i) => `${i + 1}. ${ins.icon} ${ins.title}\n${ins.body}`)
      .join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAskInChat = (insight: InsightItem) => {
    if (!onAskInChat) return;
    onAskInChat(`Tell me more about this insight: "${insight.title}". ${insight.body}`);
  };

  const allModels: ModelDef[] = providers.flatMap((g) => g.models);
  const activeModelDef = allModels.find((m) => m.id === activeModel);
  const modelLabel = activeModelDef?.label ?? activeModel.split("/").pop()?.replace(/-/g, " ") ?? activeModel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div
        className="relative w-full max-w-2xl max-h-[95vh] md:max-h-[90vh] bg-white rounded-2xl md:rounded-[2.5rem] shadow-2xl border border-neutral-100 flex flex-col overflow-hidden mx-2 md:mx-auto"
        style={{ animation: "slideUp 0.25s ease-out" }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-7 pt-7 pb-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-200">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black text-neutral-900 tracking-tight">Auto Insights</h2>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">
                  {dataset}
                </span>
                <span className="text-neutral-300">·</span>
                <span className="text-[11px] font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
                  {modelLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ran && !loading && insights.length > 0 && (
              <button
                onClick={() => run(activeModel)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-neutral-500 hover:text-violet-600 bg-neutral-50 hover:bg-violet-50 border border-neutral-200 hover:border-violet-200 rounded-xl transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-analyze
              </button>
            )}
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-2xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6">

          {/* Loading with step animation */}
          {loading && <LoadingSteps currentStep={currentStep} />}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <div className="max-w-md">
                <p className="text-sm font-bold text-neutral-800 mb-1">Analysis failed</p>
                <p className="text-xs text-neutral-500">{error}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <button
                  onClick={() => run(activeModel)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-2xl hover:bg-violet-700 transition-colors shadow-lg shadow-violet-200"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try again
                </button>
                {activeModel !== "openai/gpt-oss-120b" && (
                  <button
                    onClick={() => {
                      setActiveModel("openai/gpt-oss-120b");
                      run("openai/gpt-oss-120b");
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-xs font-bold rounded-2xl transition-colors"
                  >
                    ⚡ Try GPT-OSS 120B (Groq)
                  </button>
                )}
                {activeModel !== "openai/gpt-oss-20b" && (
                  <button
                    onClick={() => {
                      setActiveModel("openai/gpt-oss-20b");
                      run("openai/gpt-oss-20b");
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-xs font-bold rounded-2xl transition-colors"
                  >
                    ⚡ Try GPT-OSS 20B (Groq)
                  </button>
                )}
                {activeModel !== "nvidia/nemotron-3.5-lightning:free" && (
                  <button
                    onClick={() => {
                      setActiveModel("nvidia/nemotron-3.5-lightning:free");
                      run("nvidia/nemotron-3.5-lightning:free");
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 text-xs font-bold rounded-2xl transition-colors"
                  >
                    ⚡ Try Nemotron (OpenRouter)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Throttle warning */}
          {throttled && !loading && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium">
              <span className="text-amber-500">⚠</span>
              High usage detected, responses may be slower.
            </div>
          )}

          {/* Insights */}
          {!loading && !error && insights.length > 0 && (
            <div className="flex flex-col gap-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                {insights.length} insights found
              </p>
              {insights.map((item, i) => (
                <div
                  key={i}
                  className="group p-5 rounded-2xl border border-neutral-100 bg-white hover:border-violet-200 hover:shadow-md transition-all"
                  style={{ animation: `fadeSlideIn 0.3s ease-out ${i * 60}ms both` }}
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 w-11 h-11 rounded-2xl bg-neutral-50 border border-neutral-100 flex items-center justify-center text-xl">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <h3 className="text-sm font-black text-neutral-900">{item.title}</h3>
                        <InsightBadge type={item.type} />
                      </div>
                      <p className="text-[13.5px] text-neutral-600 leading-relaxed">{item.body}</p>

                      {/* Ask in Chat button */}
                      {onAskInChat && (
                        <button
                          onClick={() => handleAskInChat(item)}
                          className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400 hover:text-violet-600 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Ask in Chat
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && insights.length > 0 && (
          <div className="shrink-0 border-t border-neutral-100 px-7 py-4 flex items-center justify-between">
            <p className="text-[11px] text-neutral-400 font-medium">
              Powered by {modelLabel}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-neutral-500 hover:text-neutral-700 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 rounded-xl transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy all"}
              </button>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-neutral-900 text-white text-xs font-bold rounded-xl hover:bg-neutral-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

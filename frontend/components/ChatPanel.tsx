"use client";

import { useState, useRef, useEffect } from "react";
import ChatInput from "./ChatInput";
import InsightCard from "./InsightCard";
import { sendChatQuery, fetchModels } from "@/lib/api";
import type { ProviderGroup, ModelDef } from "@/lib/api";
import { ChevronDown } from "lucide-react";
import { trackAskQuestion, trackChatResponse, trackChatError } from "@/lib/analytics";

// ── Tier badge config ───────────────────────────────────────────────────────
const TIER_BADGE: Record<string, { label: string; cls: string }> = {
  best:        { label: "Best",      cls: "bg-amber-100 text-amber-700" },
  recommended: { label: "⭐",        cls: "bg-emerald-50 text-emerald-600" },
  standard:    { label: "",          cls: "" },
  fast:        { label: "Fast",      cls: "bg-sky-100 text-sky-600" },
};

// Provider dot colour fallback map (used before fetch resolves)
const PROVIDER_COLORS: Record<string, string> = {
  Gemini:     "bg-blue-500",
  Groq:       "bg-orange-500",
  OpenRouter: "bg-violet-500",
};

const DEFAULT_MODEL = "gemini-3.8-flash";
const QUOTA_KEY = "datachat_quota_exceeded";

function loadQuotaState(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(QUOTA_KEY) || "{}"); }
  catch { return {}; }
}
function saveQuotaState(state: Record<string, number>) {
  localStorage.setItem(QUOTA_KEY, JSON.stringify(state));
}
function isQuotaExceeded(modelId: string, quotaState: Record<string, number>): boolean {
  const ts = quotaState[modelId];
  if (!ts) return false;
  return Date.now() - ts < 60 * 60 * 1000; // 1 hour
}


type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chart?: any;
  insight?: string;
  code_used?: string;
  clarification?: string;
  isError?: boolean;
  follow_up?: string[];
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChatPanel({
  workspaceId,
  analysisId,
  primaryDataset,
  selectedDatasets,
  model,
  onModelChange,
  externalQuestion,
  onExternalQuestionHandled,
  initialMessages,
}: {
  workspaceId: string;
  analysisId: string;
  primaryDataset: string;
  selectedDatasets: string[];
  model: string;
  onModelChange: (model: string) => void;
  externalQuestion?: string | null;
  onExternalQuestionHandled?: () => void;
  initialMessages?: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", content: "I've analyzed your data. What would you like to know?" },
  ]);

  // Dynamic model registry from backend
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const allModels: ModelDef[] = providers.flatMap((g) => g.models);

  useEffect(() => {
    fetchModels()
      .then(setProviders)
      .catch(() => {
        // Fallback static list if backend unreachable
        setProviders([
          {
            provider: "Gemini", color: "blue", connected: true,
            models: [
              { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Latest & flagship", tier: "best" },
              { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", note: "Ultra fast & free", tier: "recommended" },
            ],
          },
        ]);
      });
  }, []);

  // Apply chat history when the parent's async fetch delivers it.
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);
  const [loading, setLoading] = useState(false);
  const [throttled, setThrottled] = useState(false);
  const [quotaState, setQuotaState] = useState<Record<string, number>>({});
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuotaState(loadQuotaState()); }, []);

  // Handle question injected externally (e.g., from Auto Insights "Ask in Chat")
  useEffect(() => {
    if (externalQuestion) {
      handleSend(externalQuestion);
      onExternalQuestionHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalQuestion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markQuotaExceeded = (modelId: string) => {
    const updated = { ...quotaState, [modelId]: Date.now() };
    setQuotaState(updated);
    saveQuotaState(updated);
  };

  const handleSend = async (question: string) => {
    if (!workspaceId || !analysisId) return;

    const userMessage: Message = { id: Date.now().toString(), role: "user", content: question };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    const sendStart = Date.now();

    trackAskQuestion({ question, analysis_id: analysisId, model });

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await sendChatQuery(workspaceId, analysisId, primaryDataset, question, history, model, selectedDatasets);

      trackChatResponse({
        analysis_id: analysisId,
        response_time_ms: Date.now() - sendStart,
        has_chart: !!res.data.chart,
        model,
      });

      if (res.data.throttled) setThrottled(true);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: res.data.answer,
          insight: res.data.insight,
          chart: res.data.chart,
          code_used: res.data.code_used,
          clarification: res.data.clarification,
          follow_up: res.data.follow_up || [],
        },
      ]);
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail || err.message;
      const errorType = status === 429 ? "quota_exceeded" : status === 503 ? "model_busy" : "error";
      trackChatError({ analysis_id: analysisId, error_type: errorType, model });

      if (status === 429) {
        markQuotaExceeded(model);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `Quota exceeded for **${allModels.find((m: ModelDef) => m.id === model)?.label ?? model}**. Please select a different model.`,
            isError: true,
          },
        ]);
      } else if (status === 503) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `**${allModels.find((m: ModelDef) => m.id === model)?.label ?? model}** is temporarily busy. Please try again or switch models.`,
            isError: true,
          },
        ]);
      } else {
        if (isQuotaExceeded(model, quotaState)) {
          const updated = { ...quotaState };
          delete updated[model];
          setQuotaState(updated);
          saveQuotaState(updated);
        }

        // Show a friendly message — never expose raw API internals
        const isAllExhausted = typeof detail === "string" && detail.toLowerCase().includes("all model fallbacks exhausted");
        if (isAllExhausted) markQuotaExceeded(model);
        const modelName = allModels.find((m: ModelDef) => m.id === model)?.label ?? model;
        const friendlyMsg = isAllExhausted
          ? `**${modelName}** is currently unavailable. Please switch to a different model.`
          : "Sorry, something went wrong. Please try again or switch to a different model.";

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: friendlyMsg,
            isError: true,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  const currentModelDef = allModels.find((m: ModelDef) => m.id === model);
  const currentGroup = providers.find((g) => g.models.some((m) => m.id === model));
  const currentDotColor = PROVIDER_COLORS[currentGroup?.provider ?? ""] ?? "bg-gray-400";

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:6rem_4rem] opacity-40 pointer-events-none" />

      {/* ── Model selector bar ── */}
      <div className="relative z-30 flex items-center gap-3 px-5 py-3 border-b border-neutral-100 bg-white/90 backdrop-blur-sm shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Model</span>

        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-2xl border border-neutral-200 bg-white hover:border-neutral-300 transition-all text-sm font-semibold text-neutral-700 shadow-sm"
          >
            <span className={`w-2 h-2 rounded-full ${currentDotColor}`} />
            {currentModelDef?.label ?? model}
            <span className="text-[10px] text-neutral-400 font-normal">{currentGroup?.provider}</span>
            {isQuotaExceeded(model, quotaState) && (
              <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">QUOTA</span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-2xl border border-neutral-200 shadow-xl overflow-hidden z-50">
              {providers.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-neutral-400">Loading models…</div>
              )}
              {providers.map((group) => (
                <div key={group.provider}>
                  <div className="flex items-center gap-2 px-4 py-2 bg-neutral-50 border-b border-neutral-100">
                    <span className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[group.provider] ?? "bg-gray-400"}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{group.provider}</span>
                    <span className={`ml-auto text-[9px] font-semibold ${group.connected ? "text-emerald-500" : "text-red-400"}`}>
                      {group.connected ? "● connected" : "● no api key"}
                    </span>
                  </div>
                  {group.models.map((modelDef: ModelDef) => {
                    const exceeded = isQuotaExceeded(modelDef.id, quotaState);
                    const active = model === modelDef.id;
                    const badge = TIER_BADGE[modelDef.tier ?? "standard"];
                    return (
                      <button
                        key={modelDef.id}
                        disabled={exceeded || !group.connected}
                        onClick={() => { if (!exceeded && group.connected) { onModelChange(modelDef.id); setDropdownOpen(false); } }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                          exceeded || !group.connected
                            ? "opacity-40 cursor-not-allowed"
                            : active
                            ? "bg-primary/5 text-primary"
                            : "hover:bg-neutral-50 text-neutral-700"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            exceeded ? "bg-red-400" : !group.connected ? "bg-neutral-300" : "bg-emerald-400"
                          }`} />
                          <span className={`text-sm font-semibold ${exceeded ? "line-through text-neutral-400" : ""}`}>{modelDef.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {exceeded ? (
                            <span className="text-[9px] bg-red-100 text-red-500 font-bold px-1.5 py-0.5 rounded-full">QUOTA</span>
                          ) : badge?.label ? (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                          ) : modelDef.note ? (
                            <span className="text-[10px] text-neutral-400">{modelDef.note}</span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-100 flex items-center justify-between">
                <p className="text-[10px] text-neutral-400">🟢 Available · 🔴 Quota exceeded (~1 hr)</p>
                <button
                  onClick={() => { setQuotaState({}); saveQuotaState({}); }}
                  className="text-[10px] text-violet-500 hover:text-violet-700 font-semibold underline"
                >
                  Reset all
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Messages (scrollable) ── */}
      <div className="flex-1 overflow-y-auto z-10 custom-scrollbar">
        <div className="flex flex-col gap-6 p-4 md:p-6 pb-6">
          {messages.map((msg, i) => (
            <div key={msg.id ?? `msg-${i}`} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "user" ? (
                <div className="bg-primary text-white px-5 py-3.5 rounded-3xl rounded-tr-sm max-w-[75%] shadow-md text-[15px] leading-relaxed">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full max-w-[92%]">
                  <InsightCard message={msg} onFollowUp={handleSend} />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-neutral-200 shadow-sm px-5 py-4 rounded-3xl rounded-tl-sm flex items-center gap-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full bg-primary/80 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-sm font-medium text-neutral-500 animate-pulse">
                  {currentModelDef?.label ?? model} is thinking...
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Throttle warning banner ── */}
      {throttled && (
        <div className="relative z-20 shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-200 text-amber-700 text-[11px] font-medium">
          <span className="text-amber-500">⚠</span>
          High usage detected, responses may be slower.
        </div>
      )}

      {/* ── Input (fixed at bottom, in flow) ── */}
      <div className="relative z-20 shrink-0 px-4 md:px-6 pt-3 pb-4 bg-white/90 backdrop-blur-sm border-t border-neutral-100">
        {/* Dataset context pills */}
        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Querying:</span>
          {selectedDatasets.map((name) => (
            <span
              key={name}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                name === primaryDataset
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-neutral-100 text-neutral-500 border border-neutral-200"
              }`}
            >
              {name}
            </span>
          ))}
        </div>
        <ChatInput onSend={handleSend} disabled={loading} />
      </div>
    </div>
  );
}

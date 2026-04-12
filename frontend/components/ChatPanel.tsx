"use client";

import { useState, useRef, useEffect } from "react";
import ChatInput from "./ChatInput";
import InsightCard from "./InsightCard";
import { sendChatQuery } from "@/lib/api";
import { ChevronDown } from "lucide-react";

// ── Model registry ─────────────────────────────────────────────────────────

type Provider = "Gemini" | "Groq" | "OpenRouter";

interface ModelDef {
  id: string;
  label: string;
  provider: Provider;
  note?: string;
}

const MODEL_GROUPS: { provider: Provider; color: string; models: ModelDef[] }[] = [
  {
    provider: "Gemini",
    color: "bg-blue-500",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Gemini", note: "Fast & free" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", provider: "Gemini", note: "Free tier" },
    ],
  },
  {
    provider: "Groq",
    color: "bg-orange-500",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq", note: "Recommended" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", provider: "Groq", note: "Latest" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", provider: "Groq", note: "Very fast" },
      { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2", provider: "Groq", note: "Moonshot AI" },
      { id: "qwen/qwen3-32b", label: "Qwen3 32B", provider: "Groq", note: "Alibaba" },
      { id: "groq/compound", label: "Compound", provider: "Groq", note: "Groq native" },
    ],
  },
  {
    provider: "OpenRouter",
    color: "bg-violet-500",
    models: [
      { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B", provider: "OpenRouter", note: "Powerful" },
      { id: "google/gemma-3-12b-it:free", label: "Gemma 3 12B", provider: "OpenRouter", note: "Fast" },
      { id: "google/gemma-3-4b-it:free", label: "Gemma 3 4B", provider: "OpenRouter", note: "Light" },
      { id: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron 30B", provider: "OpenRouter", note: "NVIDIA" },
      { id: "nvidia/nemotron-nano-9b-v2:free", label: "Nemotron 9B", provider: "OpenRouter", note: "NVIDIA" },
      { id: "minimax/minimax-m2.5:free", label: "MiniMax M2.5", provider: "OpenRouter", note: "Large" },
      { id: "liquid/lfm-2.5-1.2b-instruct:free", label: "LFM 1.2B", provider: "OpenRouter", note: "Tiny" },
      { id: "arcee-ai/trinity-large-preview:free", label: "Trinity Large", provider: "OpenRouter", note: "Free" },
    ],
  },
];

const ALL_MODELS: ModelDef[] = MODEL_GROUPS.flatMap((g) => g.models);
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
  return Date.now() - ts < 60 * 60 * 1000;
}

// ── Types ──────────────────────────────────────────────────────────────────

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

  // Apply chat history when the parent's async fetch delivers it.
  // This runs after mount, so it correctly handles the case where
  // initialMessages arrives after ChatPanel already rendered.
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

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await sendChatQuery(workspaceId, analysisId, primaryDataset, question, history, model, selectedDatasets);

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

      if (status === 429) {
        markQuotaExceeded(model);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `Quota exceeded for **${ALL_MODELS.find((m) => m.id === model)?.label ?? model}**. Please select a different model.`,
            isError: true,
          },
        ]);
      } else if (status === 503) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `**${ALL_MODELS.find((m) => m.id === model)?.label ?? model}** is temporarily busy. Please try again or switch models.`,
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
        const modelName = ALL_MODELS.find((m) => m.id === model)?.label ?? model;
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

  const currentModelDef = ALL_MODELS.find((m) => m.id === model);
  const currentGroup = MODEL_GROUPS.find((g) => g.provider === currentModelDef?.provider);

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
            <span className={`w-2 h-2 rounded-full ${currentGroup?.color ?? "bg-gray-400"}`} />
            {currentModelDef?.label ?? model}
            <span className="text-[10px] text-neutral-400 font-normal">{currentModelDef?.provider}</span>
            {isQuotaExceeded(model, quotaState) && (
              <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full">QUOTA</span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-2xl border border-neutral-200 shadow-xl overflow-hidden z-50">
              {MODEL_GROUPS.map((group) => (
                <div key={group.provider}>
                  <div className="flex items-center gap-2 px-4 py-2 bg-neutral-50 border-b border-neutral-100">
                    <span className={`w-2 h-2 rounded-full ${group.color}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{group.provider}</span>
                    <span className="ml-auto text-[9px] text-emerald-500">● connected</span>
                  </div>
                  {group.models.map((modelDef) => {
                    const exceeded = isQuotaExceeded(modelDef.id, quotaState);
                    const active = model === modelDef.id;
                    return (
                      <button
                        key={modelDef.id}
                        disabled={exceeded}
                        onClick={() => { if (!exceeded) { onModelChange(modelDef.id); setDropdownOpen(false); } }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                          exceeded
                            ? "opacity-50 cursor-not-allowed bg-red-50/40"
                            : active
                            ? "bg-primary/5 text-primary"
                            : "hover:bg-neutral-50 text-neutral-700"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${exceeded ? "bg-red-400" : "bg-emerald-400"}`} />
                          <span className={`text-sm font-semibold ${exceeded ? "line-through text-neutral-400" : ""}`}>{modelDef.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {exceeded
                            ? <span className="text-[9px] bg-red-100 text-red-500 font-bold px-1.5 py-0.5 rounded-full">QUOTA</span>
                            : modelDef.note && <span className="text-[10px] text-neutral-400">{modelDef.note}</span>
                          }
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

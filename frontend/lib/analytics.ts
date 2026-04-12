"use client";

import posthog from "posthog-js";

// ── Init ─────────────────────────────────────────────────────────────────────

let initialized = false;

export function initPostHog() {
  if (initialized || typeof window === "undefined") return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  if (!key) return;

  // Use workspace_id as distinct_id for anonymous session continuity
  const sessionId =
    localStorage.getItem("workspace_id") || `anon_${crypto.randomUUID()}`;

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // we fire page_view manually for SPA
    capture_pageleave: true,
    persistence: "localStorage",
    autocapture: false, // we track events explicitly
    session_recording: {
      maskAllInputs: true, // mask sensitive inputs
      maskTextSelector: "[data-mask]",
    },
  });

  posthog.identify(sessionId);
  initialized = true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Re-identify when workspace_id changes (first upload creates it) */
export function identifySession(workspaceId: string) {
  if (typeof window === "undefined") return;
  posthog.identify(workspaceId);
}

// ── Events ───────────────────────────────────────────────────────────────────

export function trackPageView(path?: string) {
  posthog.capture("page_view", {
    path: path ?? window.location.pathname,
  });
}

export function trackUploadDataset(props: {
  dataset_name: string;
  number_of_rows: number;
  number_of_columns: number;
}) {
  posthog.capture("upload_dataset", props);
}

export function trackCreateAnalysis(props: {
  analysis_id: string;
  analysis_name: string;
}) {
  posthog.capture("create_analysis", props);
}

export function trackSwitchAnalysis(props: { analysis_id: string }) {
  posthog.capture("switch_analysis", props);
}

export function trackAskQuestion(props: {
  question: string;
  analysis_id: string;
  model: string;
}) {
  posthog.capture("ask_question", props);
}

export function trackInsightGenerated(props: {
  analysis_id: string;
  response_time_ms: number;
  insight_count: number;
}) {
  posthog.capture("insight_generated", props);
}

export function trackShareAnalysis(props: { analysis_id: string }) {
  posthog.capture("share_analysis", props);
}

export function trackSessionRestored() {
  posthog.capture("session_restored");
}

export function trackChatResponse(props: {
  analysis_id: string;
  response_time_ms: number;
  has_chart: boolean;
  model: string;
}) {
  posthog.capture("chat_response", props);
}

export function trackChatError(props: {
  analysis_id: string;
  error_type: string;
  model: string;
}) {
  posthog.capture("chat_error", props);
}

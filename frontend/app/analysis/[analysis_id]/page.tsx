"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAnalysis } from "@/lib/api";
import { Database, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

export default function AnalysisRestorePage() {
  const params = useParams();
  const router = useRouter();
  const analysisId = params.analysis_id as string;
  const [state, setState] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!analysisId) return;

    getAnalysis(analysisId)
      .then((res) => {
        const { workspace_id } = res.data;
        // Store workspace so the dashboard can load it
        localStorage.setItem("workspace_id", workspace_id);
        // Tell the dashboard which analysis to activate on load
        localStorage.setItem("active_analysis_id", analysisId);
        router.push("/dashboard");
      })
      .catch(() => {
        setState("error");
        setErrorMsg("This analysis has expired or the link is invalid.");
      });
  }, [analysisId, router]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center gap-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <Database className="w-7 h-7 text-white" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-semibold">Loading shared analysis…</span>
          </div>
          <p className="text-xs text-neutral-400">Restoring datasets, chat history, and insights</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center gap-6 px-4">
      <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center">
        <AlertCircle className="w-7 h-7 text-red-500" />
      </div>
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-bold text-neutral-900 mb-2">Analysis not found</h1>
        <p className="text-sm text-neutral-500 leading-relaxed">{errorMsg}</p>
      </div>
      <Link
        href="/"
        className="px-6 py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
      >
        Start a new workspace
      </Link>
    </div>
  );
}

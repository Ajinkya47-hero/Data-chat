"use client";

import { useState, useRef } from "react";
import { uploadCsv } from "@/lib/api";
import { useRouter } from "next/navigation";
import { identifySession, trackUploadDataset, trackCreateAnalysis } from "@/lib/analytics";
import {
  FileUp, LoaderCircle, Lock,
  CheckCircle2, Plus, ArrowRight, Table2, X, Sparkles,
} from "lucide-react";

interface DatasetEntry {
  name: string;
  row_count: number;
  column_count: number;
}

export default function UploadZone() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem("workspace_id") : null
  );
  // All uploads in this session go into a single analysis
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string | null>(null);
  const [analysisName, setAnalysisName] = useState<string>("");
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleUploadResult = (data: any) => {
    const wid: string = data.workspace_id;
    const aid: string = data.analysis_id;
    const isNewAnalysis = !currentAnalysisId || currentAnalysisId !== aid;

    setWorkspaceId(wid);
    localStorage.setItem("workspace_id", wid);
    localStorage.setItem("active_analysis_id", aid);
    setCurrentAnalysisId(aid);
    setAnalysisName(data.analysis_name ?? "Analysis");
    setDatasets(data.datasets ?? []);

    // Analytics
    identifySession(wid);
    if (isNewAnalysis) {
      trackCreateAnalysis({ analysis_id: aid, analysis_name: data.analysis_name ?? "Analysis" });
    }
    const uploaded = data.uploaded as string | undefined;
    const ds = (data.datasets ?? []).find((d: any) => d.name === uploaded);
    if (ds) {
      trackUploadDataset({
        dataset_name: ds.name,
        number_of_rows: ds.row_count,
        number_of_columns: ds.column_count,
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    setUploading(true);

    // Reuse the existing analysis for every file in this session
    let activeAnalysisId = currentAnalysisId;
    let activeWorkspaceId = workspaceId;
    try {
      for (const file of files) {
        const res = await uploadCsv(file, activeWorkspaceId ?? undefined, activeAnalysisId ?? undefined);
        activeWorkspaceId = res.data.workspace_id;
        activeAnalysisId = res.data.analysis_id;
        handleUploadResult(res.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const hasUploads = datasets.length > 0;

  return (
    <div className="w-full max-w-2xl mx-auto glass rounded-2xl md:rounded-[3rem] p-1 md:p-1.5 animate-in">
      <div className="bg-white/40 backdrop-blur-md rounded-xl md:rounded-[2.8rem] border border-white/40 p-6 md:p-14">

        <header className="text-center mb-10">
          <h2 className="text-3xl font-black text-neutral-900 tracking-tight mb-3">
            Connect your Data
          </h2>
          <p className="text-neutral-500 font-medium">
            Upload CSV files — all files are combined into one analysis.
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50/80 border border-red-100 text-red-600 rounded-2xl text-sm font-medium flex gap-3 items-start">
            <X className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1">{error}</p>
          </div>
        )}

        {/* Uploaded datasets list */}
        {hasUploads && (
          <div className="mb-8 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 flex flex-col gap-1.5">
            {datasets.map((ds) => (
              <div key={ds.name} className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <Table2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <p className="text-sm font-semibold text-neutral-700 truncate">{ds.name}</p>
                <span className="ml-auto text-[11px] text-neutral-400 shrink-0">
                  {ds.row_count.toLocaleString()} rows · {ds.column_count} cols
                </span>
                <button
                  onClick={() => setDatasets((prev) => prev.filter((d) => d.name !== ds.name))}
                  title="Remove"
                  className="w-5 h-5 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* CSV Upload Drop Zone */}
        <div className="relative group p-6 md:p-10 border-2 border-dashed border-neutral-200 rounded-2xl md:rounded-[2.5rem] hover:border-primary/40 transition-all hover:bg-white/50 hover:shadow-xl hover:shadow-primary/5 cursor-pointer mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            onChange={handleFileChange}
            disabled={uploading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
          />
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 bg-white rounded-[1.5rem] shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform duration-500 relative">
              <div className="absolute inset-0 bg-primary/5 rounded-[1.5rem] blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              {uploading ? (
                <LoaderCircle className="w-8 h-8 text-primary animate-spin" />
              ) : hasUploads ? (
                <Plus className="w-8 h-8 text-primary relative z-10" />
              ) : (
                <FileUp className="w-8 h-8 text-primary relative z-10" />
              )}
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-neutral-800 tracking-tight">
                {uploading ? "Uploading..." : hasUploads ? "Add another file" : "Drop your CSV here"}
              </p>
              <p className="text-xs font-bold text-neutral-400 mt-1 uppercase tracking-widest">
                {uploading ? "please wait" : "or click to browse · multiple files supported"}
              </p>
            </div>
          </div>
        </div>

        {/* Start Analysis CTA */}
        {hasUploads && (
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full flex items-center justify-center gap-3 py-4 bg-gradient-to-r from-primary to-blue-600 text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:from-primary/90 hover:to-blue-600/90 transition-all shadow-lg shadow-primary/20 active:scale-95 mb-6"
          >
            <Sparkles className="w-4 h-4" />
            Start Analysis
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {/* Trust line */}
        <div className="flex items-start gap-2.5 pt-4 border-t border-neutral-100">
          <Lock className="w-4 h-4 text-neutral-300 shrink-0 mt-0.5" />
          <p className="text-xs text-neutral-400 leading-relaxed">
            <span className="font-semibold text-neutral-500">Your data is never stored.</span>{" "}
            We process your data temporarily in your session and don't store it permanently.
          </p>
        </div>
      </div>
    </div>
  );
}

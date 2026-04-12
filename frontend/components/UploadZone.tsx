"use client";

import { useState, useRef } from "react";
import { uploadCsv, uploadGsheet } from "@/lib/api";
import { useRouter } from "next/navigation";
import { identifySession, trackUploadDataset, trackCreateAnalysis } from "@/lib/analytics";
import {
  FileUp, Link as LinkIcon, LoaderCircle,
  CheckCircle2, Plus, ArrowRight, Table2, X,
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
  const [sheetUrl, setSheetUrl] = useState("");
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

  const handleGsheetSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!sheetUrl) return;
    setError(null);
    setUploading(true);
    try {
      // Reuse the same analysis as CSV uploads in this session
      const res = await uploadGsheet(sheetUrl, workspaceId ?? undefined, currentAnalysisId ?? undefined);
      handleUploadResult(res.data);
      setSheetUrl("");
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setUploading(false);
    }
  };

  const hasUploads = datasets.length > 0;

  return (
    <div className="w-full max-w-2xl mx-auto glass rounded-[3rem] p-1.5 animate-in">
      <div className="bg-white/40 backdrop-blur-md rounded-[2.8rem] border border-white/40 p-10 md:p-14">

        <header className="text-center mb-10">
          <h2 className="text-3xl font-black text-neutral-900 tracking-tight mb-3">
            {hasUploads ? analysisName : "Connect your Data"}
          </h2>
          <p className="text-neutral-500 font-medium">
            {hasUploads
              ? "Add more files to this analysis or open the dashboard."
              : "Upload CSV files — all files are combined into one analysis."}
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
              </div>
            ))}
          </div>
        )}

        {/* CSV Upload Drop Zone */}
        <div className="relative group p-10 border-2 border-dashed border-neutral-200 rounded-[2.5rem] hover:border-primary/40 transition-all hover:bg-white/50 hover:shadow-xl hover:shadow-primary/5 cursor-pointer mb-6">
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

        {/* Google Sheet */}
        <form onSubmit={handleGsheetSubmit} className="flex gap-3 mb-8">
          <div className="relative flex-1 group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-lg shadow-sm flex items-center justify-center border border-neutral-100 group-focus-within:border-primary/30 transition-colors">
              <LinkIcon className="w-3 h-3 text-neutral-400 group-focus-within:text-primary transition-colors" />
            </div>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="Google Sheets link"
              disabled={uploading}
              className="w-full pl-12 pr-4 py-3.5 bg-white/50 border border-neutral-100 rounded-2xl focus:ring-4 focus:ring-primary/10 focus:border-primary/30 focus:bg-white outline-none transition-all font-medium text-neutral-700 placeholder:text-neutral-300 shadow-sm text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!sheetUrl || uploading}
            className="px-6 py-3.5 bg-neutral-900 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg active:scale-95"
          >
            Connect
          </button>
        </form>

        {/* Open Dashboard CTA */}
        {hasUploads && (
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full flex items-center justify-center gap-3 py-4 bg-primary text-white font-black text-sm uppercase tracking-widest rounded-2xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-95"
          >
            Open Dashboard
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

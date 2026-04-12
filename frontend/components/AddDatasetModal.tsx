"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { uploadCsv, uploadGsheet } from "@/lib/api";
import {
  X, FileUp, Link as LinkIcon, LoaderCircle,
  CheckCircle2, Table2, Plus, AlertCircle, Upload,
} from "lucide-react";

interface UploadedEntry {
  name: string;
  row_count: number;
  column_count: number;
}

interface AddDatasetModalProps {
  workspaceId: string;
  analysisId: string;
  onClose: () => void;
  /** Called after every successful upload with the latest full dataset list */
  onSuccess: (datasets: UploadedEntry[]) => void;
}

export default function AddDatasetModal({ workspaceId, analysisId, onClose, onSuccess }: AddDatasetModalProps) {
  const [uploaded, setUploaded] = useState<UploadedEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Escape key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleResult = (data: any) => {
    const list: UploadedEntry[] = data.datasets;
    setUploaded((prev) => {
      // Merge: keep prev entries not returned, add/update returned ones
      const map = new Map(prev.map((d) => [d.name, d]));
      list.forEach((d) => map.set(d.name, d));
      return Array.from(map.values());
    });
    onSuccess(list);
  };

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        const res = await uploadCsv(file, workspaceId, analysisId);
        handleResult(res.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [workspaceId, analysisId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadFiles(Array.from(e.target.files || []));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".csv"));
    if (!files.length) { setError("Only CSV files are supported."); return; }
    uploadFiles(files);
  };

  const handleGsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl) return;
    setError(null);
    setUploading(true);
    try {
      const res = await uploadGsheet(sheetUrl, workspaceId, analysisId);
      handleResult(res.data);
      setSheetUrl("");
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setUploading(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow">
              <Upload className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-neutral-900">Add Dataset</p>
              <p className="text-[10px] text-neutral-400">Upload CSV or connect Google Sheets</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="flex-1 font-medium">{error}</p>
              <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Uploaded files this session */}
          {uploaded.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {uploaded.map((ds) => (
                <div
                  key={ds.name}
                  className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <Table2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-neutral-800 truncate">{ds.name}</p>
                    <p className="text-[10px] text-neutral-400">{ds.row_count.toLocaleString()} rows · {ds.column_count} cols</p>
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase">Added</span>
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          <div
            className={`relative group cursor-pointer rounded-2xl border-2 border-dashed transition-all px-6 py-8 flex flex-col items-center gap-3 ${
              dragOver
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-neutral-200 hover:border-primary/40 hover:bg-neutral-50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
              dragOver ? "bg-primary text-white scale-110" : "bg-neutral-100 text-neutral-400 group-hover:bg-primary/10 group-hover:text-primary"
            }`}>
              {uploading ? (
                <LoaderCircle className="w-6 h-6 animate-spin text-primary" />
              ) : uploaded.length > 0 ? (
                <Plus className="w-6 h-6" />
              ) : (
                <FileUp className="w-6 h-6" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-neutral-700">
                {uploading ? "Uploading…" : dragOver ? "Drop to upload" : uploaded.length > 0 ? "Add more CSVs" : "Drop CSV files here"}
              </p>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {uploading ? "Please wait" : "or click to browse · multiple files supported"}
              </p>
            </div>
          </div>

          {/* Google Sheets */}
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2">Or connect Google Sheets</p>
            <form onSubmit={handleGsheet} className="flex gap-2">
              <div className="relative flex-1">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center">
                  <LinkIcon className="w-3.5 h-3.5 text-neutral-400" />
                </div>
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/..."
                  disabled={uploading}
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!sheetUrl || uploading}
                className="px-4 py-2.5 bg-neutral-900 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-black disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                Connect
              </button>
            </form>
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between bg-neutral-50/60">
          <p className="text-[10px] text-neutral-400">
            Datasets are added to your current session
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-neutral-600 bg-white border border-neutral-200 rounded-xl hover:bg-neutral-50 transition-all"
          >
            {uploaded.length > 0 ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

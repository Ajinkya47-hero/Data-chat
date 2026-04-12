"use client";

import UploadZone from "@/components/UploadZone";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function UploadPage() {
  const router = useRouter();
  const [backPath, setBackPath] = useState("/");

  useEffect(() => {
    // If there's a saved workspace with analyses, back button should return to dashboard
    const workspaceId = localStorage.getItem("workspace_id");
    if (workspaceId) setBackPath("/dashboard");
  }, []);

  return (
    <main className="min-h-screen bg-gradient-to-br from-neutral-50 to-primary/5 flex flex-col items-center justify-center p-6">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
      </div>

      <div className="w-full max-w-2xl">
        <button
          onClick={() => router.push(backPath)}
          className="inline-flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {backPath === "/dashboard" ? "Back to dashboard" : "Back to home"}
        </button>

        <UploadZone />
      </div>
    </main>
  );
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initPostHog, trackPageView } from "@/lib/analytics";

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Initialize PostHog once on mount
  useEffect(() => {
    initPostHog();
  }, []);

  // Track SPA page views on route change
  const pathname = usePathname();
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return <>{children}</>;
}

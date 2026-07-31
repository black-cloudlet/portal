"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetch the server-rendered page on an interval so lists, statuses, and logs
 * pick up new data without a manual reload. Refreshes are skipped while the tab
 * is hidden (no point churning in the background) and resume on the next tick
 * once it's visible again. Callers pass a shorter interval while a workload is
 * still settling and a longer one for steady-state polling.
 */
export default function AutoRefresh({
  intervalMs = 10000,
  active = true,
}: {
  intervalMs?: number;
  active?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}

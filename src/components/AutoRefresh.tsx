"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetch the server-rendered page on an interval while a workload is still
 * settling (Pending/Deploying/Terminating), so the 202 create/update flow shows
 * progress without a manual reload. Stops once the status becomes terminal.
 */
export default function AutoRefresh({
  intervalMs = 5000,
  active,
}: {
  intervalMs?: number;
  active: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}

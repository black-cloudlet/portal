"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Controls for the Logs tab: pick which pod container to read (the API defaults
 * to the user-container) and re-fetch the snapshot. "Load" navigates with a
 * `?container=` param; "Refresh" re-runs the server fetch for a fresh snapshot.
 */
export default function LogsToolbar({ container }: { container: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(container);

  function load(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    next.set("tab", "logs");
    if (value.trim()) next.set("container", value.trim());
    else next.delete("container");
    router.push(`${pathname}?${next}`);
  }

  return (
    <form className="logs-toolbar" onSubmit={load}>
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="user-container"
        aria-label="Container"
      />
      <button type="submit" className="btn btn--sm">
        Load
      </button>
      <button type="button" className="btn btn--sm" onClick={() => router.refresh()}>
        Refresh
      </button>
    </form>
  );
}

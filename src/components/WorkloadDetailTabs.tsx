"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { id: "status", label: "Status" },
  { id: "variables", label: "Variables" },
  { id: "secrets", label: "Secrets" },
  { id: "files", label: "Files" },
  { id: "advanced", label: "Advanced" },
  { id: "logs", label: "Logs" },
] as const;

export type DetailTab = (typeof TABS)[number]["id"];

/** Sub-navigation for the workload detail view; the active tab is a `?tab=` param. */
export default function WorkloadDetailTabs({ active }: { active: DetailTab }) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <nav className="subtabs" aria-label="Workload detail sections">
      {TABS.map((t) => {
        const next = new URLSearchParams(params);
        next.set("tab", t.id);
        return (
          <Link
            key={t.id}
            href={`${pathname}?${next}`}
            className={`subtab${t.id === active ? " subtab--active" : ""}`}
            aria-current={t.id === active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

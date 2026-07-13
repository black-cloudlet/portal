"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The Serverless sub-navigation, GCP-style (like Compute Engine's "VM instances"
 * / "Instance groups" tabs). One tab per workload type; the active tab is
 * derived from the pathname.
 */
const TABS = [
  { href: "/serverless/functions", label: "Functions" },
  { href: "/serverless/containers", label: "Containers" },
];

export default function ServerlessTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Serverless sections">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className={`tab ${active ? "tab--active" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

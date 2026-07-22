"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import Icon from "@/components/Icon";
import type { ServiceDef } from "@/lib/services";

interface SideNavProps {
  categories: { category: string; services: ServiceDef[] }[];
}

/**
 * The left navigation rail listing the platform's service offerings, grouped by
 * category (GCP-style: "Serverless", "Storage", ...). Enabled services link to
 * their console page; not-yet-available ones render disabled with a "Soon" tag.
 *
 * A service with sub-sections (e.g. Serverless -> Containers / Functions) shows
 * them as a collapsible group: a caret toggles the sub-list so it can be hidden.
 * By default the group is expanded while you are somewhere inside that service.
 */
export default function SideNav({ categories }: SideNavProps) {
  const pathname = usePathname();

  // Per-service open/closed overrides for the collapsible sub-lists. Until a
  // user toggles a group, it defaults to open when the current route is inside
  // that service (so the relevant sub-nav is visible on arrival).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isInside = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`);
  const isOpen = (id: string) => overrides[id] ?? isInside(id);
  const toggle = (id: string) => setOverrides((o) => ({ ...o, [id]: !isOpen(id) }));

  return (
    <nav className="sidenav" aria-label="Services">
      <Link
        href="/dashboard"
        className={`sidenav__item ${pathname === "/dashboard" ? "sidenav__item--active" : ""}`}
      >
        <span className="sidenav__icon" aria-hidden="true">
          <Icon name="home" />
        </span>
        <span className="sidenav__label">Home</span>
      </Link>

      {categories.map((cat) => (
        <div className="sidenav__group" key={cat.category}>
          <div className="sidenav__heading">{cat.category}</div>
          {cat.services.map((svc) => {
            const href = `/${svc.id}`;
            const hasSub = Boolean(svc.subItems && svc.subItems.length > 0);
            // A service with sub-sections highlights only its active leaf, never
            // itself — so a sub-page doesn't light up both the parent and the
            // child. A leaf service (no sub-list) highlights on its whole subtree.
            const active = hasSub
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
            if (!svc.enabled) {
              return (
                <span
                  key={svc.id}
                  className="sidenav__item sidenav__item--disabled"
                  title="Coming soon"
                >
                  <span className="sidenav__icon" aria-hidden="true">
                    <Icon name={svc.icon} />
                  </span>
                  <span className="sidenav__label">{svc.name}</span>
                  <span className="tag tag--soon">Soon</span>
                </span>
              );
            }
            const open = hasSub && isOpen(svc.id);
            return (
              <div key={svc.id}>
                <div className="sidenav__parent">
                  <Link
                    href={href}
                    className={`sidenav__item ${active ? "sidenav__item--active" : ""}`}
                  >
                    <span className="sidenav__icon" aria-hidden="true">
                      <Icon name={svc.icon} />
                    </span>
                    <span className="sidenav__label">{svc.name}</span>
                  </Link>
                  {hasSub && (
                    <button
                      type="button"
                      className="sidenav__toggle"
                      aria-label={`${open ? "Collapse" : "Expand"} ${svc.name} sections`}
                      aria-expanded={open}
                      onClick={() => toggle(svc.id)}
                    >
                      <Icon
                        name="chevron-down"
                        size={16}
                        className={`sidenav__chevron ${open ? "" : "sidenav__chevron--collapsed"}`}
                      />
                    </button>
                  )}
                </div>
                {hasSub && open && (
                  <div className="sidenav__sub">
                    {svc.subItems?.map((sub) => {
                      const subHref = `/${svc.id}/${sub.id}`;
                      const subActive = pathname === subHref || pathname.startsWith(`${subHref}/`);
                      return (
                        <Link
                          key={sub.id}
                          href={subHref}
                          className={`sidenav__item sidenav__item--sub ${
                            subActive ? "sidenav__item--active" : ""
                          }`}
                        >
                          <span className="sidenav__label">{sub.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

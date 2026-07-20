"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import Icon from "@/components/Icon";
import type { ServiceDef } from "@/lib/services";

interface SideNavProps {
  categories: { category: string; services: ServiceDef[] }[];
}

/**
 * The left navigation rail listing the platform's service offerings, grouped by
 * category (GCP-style: "Serverless", "Storage", ...). Enabled services link to
 * their console page; not-yet-available ones render disabled with a "Soon" tag.
 */
export default function SideNav({ categories }: SideNavProps) {
  const pathname = usePathname();

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
            const active = pathname === href || pathname.startsWith(`${href}/`);
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
            return (
              <div key={svc.id}>
                <Link
                  href={href}
                  className={`sidenav__item ${active ? "sidenav__item--active" : ""}`}
                >
                  <span className="sidenav__icon" aria-hidden="true">
                    <Icon name={svc.icon} />
                  </span>
                  <span className="sidenav__label">{svc.name}</span>
                </Link>
                {svc.subItems && svc.subItems.length > 0 && (
                  <div className="sidenav__sub">
                    {svc.subItems.map((sub) => {
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

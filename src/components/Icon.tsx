import type { ReactNode } from "react";

/**
 * Inline SVG icon set. Self-contained line icons (no emoji, no icon-font CDN) so
 * the console renders identically in the airgapped environment. Every glyph is
 * drawn on a 24x24 grid and inherits the surrounding text color via
 * `stroke="currentColor"`, so icons tint automatically in light and dark themes.
 *
 * Service definitions (see lib/services.ts) reference a glyph by name; unknown
 * names fall back to a generic box so a new offering never renders blank.
 */
const ICONS: Record<string, ReactNode> = {
  cloud: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  // Close / dismiss.
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  home: (
    <>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  // Serverless: a lightning bolt (scale-to-zero / event-driven).
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  // Storage: a database cylinder.
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  // Generic offering fallback: a box.
  cube: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  // Theme toggle glyphs.
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  monitor: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </>
  ),
};

interface IconProps {
  /** Glyph name; falls back to a generic box for unknown names. */
  name: string;
  /** Square size in px (default 20). */
  size?: number;
  className?: string;
  /** Accessible label. When set the icon is exposed to assistive tech; when
   * omitted the icon is decorative (aria-hidden). */
  title?: string;
}

export default function Icon({ name, size = 20, className, title }: IconProps) {
  const glyph = ICONS[name] ?? ICONS.cube;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}

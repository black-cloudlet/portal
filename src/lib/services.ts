/**
 * The catalog of platform offerings shown in the left navigation, GCP-style
 * (Compute, Serverless, ...). This is the first of many APIs the console will
 * front, so the catalog is data-driven: each service declares its identity and
 * the base URL of its backing API, and new offerings are added by extending
 * `PORTAL_SERVICES` (or this default) - no UI code changes.
 *
 * Configuration precedence for a service's API address:
 *   1. `PORTAL_SERVICES` JSON (per-service `apiBaseUrl` / `enabled` overrides)
 *   2. the service's dedicated env var (e.g. PORTAL_SERVERLESS_API_URL)
 *   3. built-in default below (disabled until an address is provided)
 */

export interface ServiceDef {
  /** Stable id; also the console route segment (/console/<id>). */
  id: string;
  /** Display name in the nav and dashboard cards. */
  name: string;
  /** One-line description for the dashboard card. */
  description: string;
  /** Inline SVG icon name (see components/Icon.tsx); airgap-friendly, no CDN. */
  icon: string;
  /** Nav grouping header, e.g. "Serverless", "Compute". */
  category: string;
  /** Base URL of the backing API (no trailing slash), or "" if unset. */
  apiBaseUrl: string;
  /** Whether the offering is live. Disabled services render as "Coming soon". */
  enabled: boolean;
  /**
   * Optional left-nav sub-sections, shown nested under the service when it is
   * live (GCP-style). Each maps to `/<service id>/<sub id>`.
   */
  subItems?: { id: string; name: string }[];
}

/** Built-in catalog. Addresses come from env; unset -> disabled ("Coming soon"). */
function defaultCatalog(): ServiceDef[] {
  // A future offering with no address yet renders as a disabled "Coming soon"
  // nav entry - the catalog is intentionally broad (GCP-style) so the shell
  // reads as a full platform console; each lights up once its API lands.
  const soon = (
    id: string,
    name: string,
    icon: string,
    category: string,
    description: string,
  ): ServiceDef => ({
    id,
    name,
    icon,
    category,
    description,
    apiBaseUrl: "",
    enabled: false,
  });

  return [
    soon("compute", "Compute", "server", "Compute", "Virtual machines and instance groups."),
    {
      id: "serverless",
      name: "Serverless",
      description: "Deploy functions and containers on Knative with autoscaling and scale-to-zero.",
      icon: "bolt",
      category: "Serverless",
      apiBaseUrl: stripSlash(process.env.PORTAL_SERVERLESS_API_URL ?? ""),
      enabled: Boolean(process.env.PORTAL_SERVERLESS_API_URL),
      subItems: [
        { id: "functions", name: "Functions" },
        { id: "containers", name: "Containers" },
        { id: "groups", name: "Groups" },
      ],
    },
    soon(
      "databases",
      "Databases",
      "database",
      "Databases",
      "Managed relational and key-value stores.",
    ),
    soon(
      "networking",
      "Networking",
      "network",
      "Networking",
      "Load balancers, DNS, and private links.",
    ),
    {
      id: "storage",
      name: "Object Storage",
      description: "Buckets and objects for your group. Coming soon.",
      icon: "database",
      category: "Storage",
      apiBaseUrl: stripSlash(process.env.PORTAL_STORAGE_API_URL ?? ""),
      enabled: Boolean(process.env.PORTAL_STORAGE_API_URL),
    },
    soon("observability", "Observability", "activity", "Operations", "Metrics, logs, and traces."),
    soon("data-integration", "Data Integration", "shuffle", "Data", "Pipelines and event streams."),
    soon("data-analytics", "Data Analytics", "bar-chart", "Data", "Warehouses and query engines."),
    soon("dev-tools", "Dev Tools", "wrench", "Tools", "Build, registry, and CI/CD."),
    soon("machine-learning", "Machine Learning", "cpu", "AI / ML", "Training and model serving."),
    soon("security", "Security", "shield", "Security", "IAM, secrets, and policy."),
  ];
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the service catalog for this deployment: the default catalog merged
 * with any `PORTAL_SERVICES` JSON overrides (matched by `id`; unknown ids are
 * appended so an operator can add a whole new offering purely via env).
 */
export function getServices(): ServiceDef[] {
  const base = defaultCatalog();
  const raw = process.env.PORTAL_SERVICES;
  if (!raw) return base;

  let overrides: Partial<ServiceDef>[];
  try {
    overrides = JSON.parse(raw);
    if (!Array.isArray(overrides)) return base;
  } catch {
    return base;
  }

  const byId = new Map(base.map((s) => [s.id, { ...s }]));
  for (const o of overrides) {
    if (!o.id) continue;
    const existing = byId.get(o.id);
    const merged: ServiceDef = {
      id: o.id,
      name: o.name ?? existing?.name ?? o.id,
      description: o.description ?? existing?.description ?? "",
      icon: o.icon ?? existing?.icon ?? "cube",
      category: o.category ?? existing?.category ?? "Other",
      apiBaseUrl: stripSlash(o.apiBaseUrl ?? existing?.apiBaseUrl ?? ""),
      // An override may enable/disable explicitly; otherwise a service is
      // enabled once it has an address.
      enabled: o.enabled ?? Boolean(o.apiBaseUrl ?? existing?.apiBaseUrl),
      subItems: o.subItems ?? existing?.subItems,
    };
    byId.set(o.id, merged);
  }
  return Array.from(byId.values());
}

/** Look up a single service by id (used by the per-service console pages). */
export function getService(id: string): ServiceDef | undefined {
  return getServices().find((s) => s.id === id);
}

/** Services grouped by category, preserving first-seen category order. */
export function getServicesByCategory(): { category: string; services: ServiceDef[] }[] {
  const groups: { category: string; services: ServiceDef[] }[] = [];
  for (const svc of getServices()) {
    let group = groups.find((g) => g.category === svc.category);
    if (!group) {
      group = { category: svc.category, services: [] };
      groups.push(group);
    }
    group.services.push(svc);
  }
  return groups;
}

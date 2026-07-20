# Cloud Console Portal

A self-service **web console** for the on-prem, airgapped platform - a single UI,
modelled on the **Google Cloud console**, that fronts the platform's growing set
of service APIs. The first offering is **Serverless** (the FaaS/CaaS API in the
sibling `serverless` project); more are added as data, not code.

Built with **Next.js (App Router) + TypeScript**. Identity is **SSO (Keycloak /
RHBK) OIDC** - the same realm and the same `groups` claim the Serverless API
trusts - so one login works across every offering, and group names are
**normalized identically** on both sides.

## What it does

- **Login with SSO (OIDC / RHBK).** Authorization Code + PKCE via a confidential
  Keycloak client. No local accounts. Access tokens are refreshed transparently
  and forwarded (server-side only) when the console calls a downstream API.
- **Group ("project") switcher, top-left.** A user can belong to several SSO
  groups; the console always operates in exactly one, chosen from the picker.
  The choice is validated against the token's group membership - it can never
  widen access.
- **Profile panel, top-right.** Name, username, email, the platform-admin badge,
  and the full group membership with the active group marked. A dedicated
  `/profile` page shows the same detail.
- **Service navigation, left rail.** The platform offerings grouped by category
  (GCP-style: _Serverless_, _Storage_, ...). Live services link to their page;
  not-yet-available ones show as _Coming soon_. A live service can declare
  left-nav sub-sections (see `subItems` in `src/lib/services.ts`).
- **Light / dark theme toggle, top-right.** The console follows the OS
  preference by default; the toggle forces a light ("bright") or dark theme
  per-device (persisted in `localStorage`, applied before first paint so there
  is no flash). All glyphs are inline SVG icons (`src/components/Icon.tsx`) - no
  emoji, no icon-font CDN - so they render identically in the airgap.
- **Serverless section with sub-navigation.** GCP Compute–style: **Containers**
  and **Functions** appear as nested items under _Serverless_ in the left rail,
  each listing the active group's workloads of that type from the Serverless API
  (sortable by name or creation time). A shared header shows the platform
  capabilities from the public `/info`
  endpoint. New workload types are added as more sub-sections.
- **Workload detail view.** Each row opens a per-workload page with
  sub-tabs - **Status** (source + per-site deploy state and errors),
  **Variables** and **Secrets** (env, secrets redacted), **Files**,
  **Advanced** (autoscaling + live per-site replicas/usage), and **Logs**
  (a pod-log snapshot with a container picker and refresh). It auto-refreshes
  while a workload is still deploying.
- **Create, edit, and delete.** A tabbed form (General / Variables / Secrets /
  Files / Advanced) driven by the `/info` capabilities creates and edits
  workloads; delete confirms first. Writes go through server actions that
  forward the SSO token and re-resolve the active group server-side. Edits
  follow the API's keep-on-write contract - a secret left blank keeps its
  stored value, the function git token is sent only to rotate, and the
  container registry token is kept when the username is echoed without one.

## Group normalization

Ported verbatim from the Serverless API (`api/models/common.py::normalize_group`):
a group is stripped of the Keycloak path prefix (`/`) and a leading
`ggd-<1-4 digits>-` prefix, so `/ggd-1234-platforms` and `platforms` name the
same group. See `src/lib/groups.ts` (with tests in `tests/groups.test.ts`).

## Configuration

Everything dynamic is an environment variable (`PORTAL_*`), mirroring the
Serverless API's 12-factor config. In production the secrets are projected from
Vault via the External Secrets Operator (see `charts/portal`). See
[`.env.example`](.env.example) for the full list; the essentials:

| Variable                     | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `AUTH_SECRET`                | Encrypts the session cookie (Auth.js).               |
| `AUTH_URL`                   | Public URL of the portal (OIDC redirect base).       |
| `PORTAL_OIDC_ISSUER`         | Keycloak realm issuer (shared with the APIs).        |
| `PORTAL_OIDC_CLIENT_ID`      | Confidential OIDC client id.                         |
| `PORTAL_OIDC_CLIENT_SECRET`  | OIDC client secret (from Vault via ESO).             |
| `PORTAL_OIDC_GROUPS_CLAIM`   | Token claim carrying groups (default `groups`).      |
| `PORTAL_OIDC_SCOPES`         | OIDC scopes at login (default `openid profile email`). |
| `PORTAL_OIDC_DEBUG`          | Log which token claims carry groups (diagnostics).   |
| `PORTAL_ADMIN_GROUPS`        | JSON list of admin groups (same rule as the API).    |
| `PORTAL_SERVERLESS_API_URL`  | Address of the Serverless API.                       |
| `PORTAL_SERVICES`            | Optional JSON to add/override the service catalog.    |

Adding a new offering is env-only: point `PORTAL_SERVICES` (or a dedicated
`PORTAL_<NAME>_API_URL`) at the new API - no UI changes. See `src/lib/services.ts`.

### Troubleshooting: "You don't belong to any group"

The portal reads the groups claim from the OIDC profile, the ID token, **and**
the access token, and captures it **at sign-in**. If a user sees no groups:

1. **Sign out and back in.** The group set is fixed when the session is created,
   so an old session (from before a config/redeploy change) keeps its old,
   possibly empty, membership until a fresh login.
2. **Check the portal's Keycloak client emits the claim.** Group mappers are
   per-client: the `cloud-console-portal` client needs its own **Group
   Membership** mapper (or the `groups` client scope) with the token claim name
   matching `PORTAL_OIDC_GROUPS_CLAIM` and "Add to ID/access token" enabled -
   enabling it only on the Serverless API client is not enough.
3. **Confirm with `PORTAL_OIDC_DEBUG=true`,** then read the pod logs on the next
   sign-in: it prints the claim keys present in each token and where (if
   anywhere) the groups claim was found. If your realm gates groups behind a
   scope, add it to `PORTAL_OIDC_SCOPES` (e.g. `openid profile email groups`).

## Layout

```
src/
  auth.ts             SSO/OIDC (Auth.js + Keycloak): tokens, refresh, groups
  middleware.ts       route gate (everything but /login + /api/auth is protected)
  lib/                groups (ported normalization), config, service catalog,
                      active-group cookie, Serverless API client, workload-spec
                      (keep-on-write env/files mapping)
  app/
    login/            SSO sign-in landing
    (console)/        the shell: top bar (group switcher + theme + profile) + side nav
      dashboard/      service cards
      serverless/     offering shell (Containers/Functions live in the left nav)
        actions.ts    create/update/delete server actions (token forwarding)
        functions/    list, [name] detail, [name]/edit, new
        containers/   list, [name] detail, [name]/edit, new
      profile/        full account detail
    api/              Auth.js endpoints, active-group setter, health probe
  components/         TopBar, GroupSwitcher, ProfileMenu, ThemeToggle, Icon,
                      SideNav, WorkloadTable, WorkloadDetail(+Tabs), WorkloadForm,
                      DeleteWorkloadButton, LogsToolbar, AutoRefresh, StatusPill
charts/portal/        Helm chart (Deployment, Service, Route, ExternalSecret,
                      NetworkPolicy)
.github/workflows/    CI/CD: checks (reusable), ci, release
Dockerfile            multi-stage standalone Next.js build
```

## Develop

```bash
npm install
cp .env.example .env   # fill in AUTH_SECRET (openssl rand -base64 32) and OIDC client

npm run dev            # http://localhost:3000
npm run lint           # ESLint (next) + Prettier check via `npm run format:check`
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build          # production build (standalone output)
```

> **Note:** this project lives under `portal/` in the `serverless` repository for
> now, but is fully self-contained (own `package.json`, `Dockerfile`, chart, and
> CI). It is intended to be extracted into its own repository; the CI workflows
> and chart already assume `portal/` is the repository root.

## Deploy

Helm chart in `charts/portal` (OpenShift `Route`, `Deployment`, `Service`,
`ExternalSecret`, default-deny `NetworkPolicy`), following the same conventions
as `charts/serverless-api`: image tag tracks the chart `appVersion`, secrets come
from Vault via ESO, and the internal CA bundle is trusted via `NODE_EXTRA_CA_CERTS`.
The release workflow builds/scans/signs the image and chart and cuts a GitHub
Release, exactly like the Serverless API's.

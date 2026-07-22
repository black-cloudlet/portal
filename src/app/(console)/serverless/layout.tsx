import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Serverless" };

// Always render live against the API for the active group.
export const dynamic = "force-dynamic";

/**
 * The Serverless offering shell: a shared header. The Containers/Functions
 * sub-sections are reached from the left-nav (see SideNav / lib/services
 * `subItems`); the active sub-section's page renders as `children`. When the
 * offering isn't configured or the user has no group, the shell shows a notice
 * (the sub-pages guard the same way, so they render nothing in that case).
 */
export default async function ServerlessLayout({ children }: { children: React.ReactNode }) {
  const { enabled, activeGroup } = await getServerlessContext();

  return (
    <div className="page">
      <div className="page__header">
        <h1 className="page__title">Serverless</h1>
        {enabled && activeGroup && (
          <p className="page__subtitle">
            Functions and containers for group <strong>{activeGroup}</strong>.
          </p>
        )}
      </div>

      {!enabled ? (
        <div className="notice notice--warn">
          The Serverless API address is not configured. Set <code>PORTAL_SERVERLESS_API_URL</code>{" "}
          to enable this offering.
        </div>
      ) : !activeGroup ? (
        <div className="notice notice--warn">
          You have no group membership, so there are no workloads to show.
        </div>
      ) : (
        children
      )}
    </div>
  );
}

import WorkloadTable from "@/components/WorkloadTable";
import { listFunctions, ServerlessApiError } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Functions" };
export const dynamic = "force-dynamic";

/** Functions tab: the active group's functions from the Serverless API. */
export default async function FunctionsPage() {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  // The layout already shows the not-configured / no-group notice.
  if (!enabled || !activeGroup) return null;

  try {
    const workloads = await listFunctions(activeGroup, accessToken);
    return (
      <WorkloadTable workloads={workloads} emptyLabel={`No functions in ${activeGroup} yet.`} />
    );
  } catch (err) {
    const message =
      err instanceof ServerlessApiError
        ? err.message
        : `Unexpected error: ${(err as Error).message}`;
    return <div className="notice notice--error">{message}</div>;
  }
}

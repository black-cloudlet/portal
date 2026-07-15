import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadTable from "@/components/WorkloadTable";
import { listContainers } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Containers" };
export const dynamic = "force-dynamic";

/** Containers tab: the active group's containers from the Serverless API. */
export default async function ContainersPage() {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  // The layout already shows the not-configured / no-group notice.
  if (!enabled || !activeGroup) return null;

  try {
    const workloads = await listContainers(activeGroup, accessToken);
    return (
      <WorkloadTable workloads={workloads} emptyLabel={`No containers in ${activeGroup} yet.`} />
    );
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }
}

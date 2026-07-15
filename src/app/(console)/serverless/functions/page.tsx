import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadTable from "@/components/WorkloadTable";
import { listFunctions } from "@/lib/serverless";
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
    return <ApiErrorNotice error={err} />;
  }
}

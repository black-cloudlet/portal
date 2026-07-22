import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadCreateDialog from "@/components/WorkloadCreateDialog";
import WorkloadList from "@/components/WorkloadList";
import {
  getFunctionInfo,
  listFunctions,
  type FunctionInfo,
  type WorkloadSummary,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Functions" };
export const dynamic = "force-dynamic";

/** Functions tab: the active group's functions from the Serverless API. */
export default async function FunctionsPage() {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  // The layout already shows the not-configured / no-group notice.
  if (!enabled || !activeGroup) return null;

  let workloads: WorkloadSummary[] | null = null;
  let fetchError: unknown = null;
  try {
    workloads = await listFunctions(activeGroup, accessToken);
  } catch (err) {
    fetchError = err;
  }

  // The create dialog needs the platform capabilities up front; if that lookup
  // fails, fall back to the standalone /new screen (which surfaces the error).
  const info: FunctionInfo | null = await getFunctionInfo().catch(() => null);
  const create = info ? (
    <WorkloadCreateDialog type="function" info={info} group={activeGroup} />
  ) : (
    <Link className="btn btn--primary" href="/serverless/functions/new">
      <span aria-hidden="true">+</span> Create function
    </Link>
  );

  return (
    <div className="stack">
      <div className="viewhead">
        <h2 className="viewhead__title">Functions</h2>
        <p className="viewhead__sub">Functions View</p>
      </div>
      {fetchError ? (
        <ApiErrorNotice error={fetchError} />
      ) : (
        <WorkloadList
          workloads={workloads ?? []}
          type="function"
          emptyLabel={`No functions in ${activeGroup} yet.`}
          toolbarRight={create}
        />
      )}
    </div>
  );
}

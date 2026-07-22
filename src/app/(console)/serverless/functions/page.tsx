import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadCreateDialog from "@/components/WorkloadCreateDialog";
import WorkloadTable from "@/components/WorkloadTable";
import {
  getPlatformInfo,
  listFunctions,
  type PlatformInfo,
  type WorkloadSort,
  type WorkloadSummary,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Functions" };
export const dynamic = "force-dynamic";

function parseSort(v?: string): WorkloadSort {
  return v === "createdAt" ? "createdAt" : "name";
}

/** Functions tab: the active group's functions from the Serverless API. */
export default async function FunctionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  // The layout already shows the not-configured / no-group notice.
  if (!enabled || !activeGroup) return null;

  const { sort } = await searchParams;
  const activeSort = parseSort(sort);

  let workloads: WorkloadSummary[] | null = null;
  let fetchError: unknown = null;
  try {
    workloads = await listFunctions(activeGroup, accessToken, activeSort);
  } catch (err) {
    fetchError = err;
  }

  // The create dialog needs the platform capabilities up front; if that lookup
  // fails, fall back to the standalone /new screen (which surfaces the error).
  const info: PlatformInfo | null = await getPlatformInfo().catch(() => null);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="sortlinks">
          <span className="text-muted">Sort:</span>
          <Link
            className={`sortlink${activeSort === "name" ? " sortlink--active" : ""}`}
            href="/serverless/functions?sort=name"
          >
            Name
          </Link>
          <Link
            className={`sortlink${activeSort === "createdAt" ? " sortlink--active" : ""}`}
            href="/serverless/functions?sort=createdAt"
          >
            Created
          </Link>
        </div>
        {info ? (
          <WorkloadCreateDialog type="function" info={info} group={activeGroup} />
        ) : (
          <Link className="btn btn--primary" href="/serverless/functions/new">
            + Create function
          </Link>
        )}
      </div>
      {fetchError ? (
        <ApiErrorNotice error={fetchError} />
      ) : (
        <WorkloadTable
          workloads={workloads ?? []}
          emptyLabel={`No functions in ${activeGroup} yet.`}
        />
      )}
    </div>
  );
}

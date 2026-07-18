import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadTable from "@/components/WorkloadTable";
import { listContainers, type WorkloadSort, type WorkloadSummary } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Containers" };
export const dynamic = "force-dynamic";

function parseSort(v?: string): WorkloadSort {
  return v === "createdAt" ? "createdAt" : "name";
}

/** Containers tab: the active group's containers from the Serverless API. */
export default async function ContainersPage({
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
    workloads = await listContainers(activeGroup, accessToken, activeSort);
  } catch (err) {
    fetchError = err;
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="sortlinks">
          <span className="text-muted">Sort:</span>
          <Link
            className={`sortlink${activeSort === "name" ? " sortlink--active" : ""}`}
            href="/serverless/containers?sort=name"
          >
            Name
          </Link>
          <Link
            className={`sortlink${activeSort === "createdAt" ? " sortlink--active" : ""}`}
            href="/serverless/containers?sort=createdAt"
          >
            Created
          </Link>
        </div>
        <Link className="btn btn--primary" href="/serverless/containers/new">
          + Create container
        </Link>
      </div>
      {fetchError ? (
        <ApiErrorNotice error={fetchError} />
      ) : (
        <WorkloadTable
          workloads={workloads ?? []}
          emptyLabel={`No containers in ${activeGroup} yet.`}
        />
      )}
    </div>
  );
}

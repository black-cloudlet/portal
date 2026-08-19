import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadCreateDialog from "@/components/WorkloadCreateDialog";
import WorkloadList from "@/components/WorkloadList";
import {
  getContainerInfo,
  listContainers,
  type ContainerInfo,
  type WorkloadSummary,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const metadata = { title: "Containers" };
export const dynamic = "force-dynamic";

/** Containers tab: the active group's containers from the Serverless API. */
export default async function ContainersPage() {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  // The layout already shows the not-configured / no-group notice.
  if (!enabled || !activeGroup) return null;

  let workloads: WorkloadSummary[] | null = null;
  let fetchError: unknown = null;
  try {
    workloads = await listContainers(activeGroup, accessToken);
  } catch (err) {
    fetchError = err;
  }

  // The create dialog needs the platform capabilities up front; if that lookup
  // fails, fall back to the standalone /new screen (which surfaces the error).
  const info: ContainerInfo | null = await getContainerInfo().catch(() => null);
  const create = info ? (
    <WorkloadCreateDialog type="container" info={info} group={activeGroup} />
  ) : (
    <Link className="btn btn--primary" href="/serverless/containers/new">
      <span aria-hidden="true">+</span> Create container
    </Link>
  );

  return (
    <div className="stack">
      <div className="viewhead">
        <h2 className="viewhead__title">Containers</h2>
        <p className="viewhead__sub">
          Deploy a prebuilt image from any registry, with autoscaling and scale to zero.
        </p>
      </div>
      {fetchError ? (
        <ApiErrorNotice error={fetchError} />
      ) : (
        <WorkloadList
          workloads={workloads ?? []}
          type="container"
          emptyLabel={`No containers in ${activeGroup} yet.`}
          toolbarRight={create}
        />
      )}
    </div>
  );
}

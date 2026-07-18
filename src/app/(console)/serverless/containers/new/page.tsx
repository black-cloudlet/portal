import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadForm from "@/components/WorkloadForm";
import { getPlatformInfo, type PlatformInfo } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "New container" };

export default async function NewContainerPage() {
  const { enabled, activeGroup } = await getServerlessContext();
  if (!enabled)
    return <div className="notice notice--warn">The Serverless API is not configured.</div>;
  if (!activeGroup) return <div className="notice notice--warn">You have no active group.</div>;

  let info: PlatformInfo;
  try {
    info = await getPlatformInfo();
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }
  return <WorkloadForm mode="create" type="container" info={info} group={activeGroup} />;
}

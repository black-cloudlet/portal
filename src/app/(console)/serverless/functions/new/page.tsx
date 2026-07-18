import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadForm from "@/components/WorkloadForm";
import { getPlatformInfo, type PlatformInfo } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "New function" };

export default async function NewFunctionPage() {
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
  return <WorkloadForm mode="create" type="function" info={info} group={activeGroup} />;
}

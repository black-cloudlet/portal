import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadForm from "@/components/WorkloadForm";
import { getPlatformInfo } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "New container" };

export default async function NewContainerPage() {
  const { enabled, activeGroup } = await getServerlessContext();
  if (!enabled)
    return <div className="notice notice--warn">The Serverless API is not configured.</div>;
  if (!activeGroup) return <div className="notice notice--warn">You have no active group.</div>;

  try {
    const info = await getPlatformInfo();
    return <WorkloadForm mode="create" type="container" info={info} group={activeGroup} />;
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }
}

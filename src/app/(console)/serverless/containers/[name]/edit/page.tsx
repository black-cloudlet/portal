import ApiErrorNotice from "@/components/ApiErrorNotice";
import WorkloadForm from "@/components/WorkloadForm";
import { getPlatformInfo, getWorkload } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `Edit ${name}` };
}

export default async function EditContainerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  if (!enabled)
    return <div className="notice notice--warn">The Serverless API is not configured.</div>;
  if (!activeGroup) return <div className="notice notice--warn">You have no active group.</div>;

  try {
    const [info, wl] = await Promise.all([
      getPlatformInfo(),
      getWorkload("container", activeGroup, name, accessToken),
    ]);
    return (
      <WorkloadForm mode="edit" type="container" info={info} group={activeGroup} initial={wl} />
    );
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }
}

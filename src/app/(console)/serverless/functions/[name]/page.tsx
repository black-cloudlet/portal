import WorkloadDetail from "@/components/WorkloadDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `${name} · Functions` };
}

export default async function FunctionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ tab?: string; container?: string }>;
}) {
  const { name } = await params;
  const { tab, container } = await searchParams;
  return <WorkloadDetail type="function" name={name} tab={tab} container={container} />;
}

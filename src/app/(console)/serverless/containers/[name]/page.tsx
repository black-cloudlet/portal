import WorkloadDetail from "@/components/WorkloadDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `${name} · Containers` };
}

export default async function ContainerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ tab?: string; container?: string }>;
}) {
  const { name } = await params;
  const { tab, container } = await searchParams;
  return <WorkloadDetail type="container" name={name} tab={tab} container={container} />;
}

import { TaskDashboard } from "@/components/task-dashboard";

export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDashboard taskId={id} />;
}

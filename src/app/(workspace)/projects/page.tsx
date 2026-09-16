import { WorkspaceUnavailable } from "@/components/layout/workspace-unavailable";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

export default async function ProjectsPage() {
  const { locale } = await requireCompletedWorkspace("/projects");
  return <WorkspaceUnavailable locale={locale} titleKey="workspace.projects" />;
}

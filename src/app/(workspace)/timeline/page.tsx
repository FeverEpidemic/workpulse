import { WorkspaceUnavailable } from "@/components/layout/workspace-unavailable";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

export default async function TimelinePage() {
  const { locale } = await requireCompletedWorkspace("/timeline");
  return <WorkspaceUnavailable locale={locale} titleKey="workspace.timeline" />;
}

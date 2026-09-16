import { WorkspaceUnavailable } from "@/components/layout/workspace-unavailable";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

export default async function AchievementsPage() {
  const { locale } = await requireCompletedWorkspace("/achievements");
  return <WorkspaceUnavailable locale={locale} titleKey="workspace.achievements" />;
}

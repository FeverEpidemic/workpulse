import { WorkspaceUnavailable } from "@/components/layout/workspace-unavailable";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

export default async function CvPage() {
  const { locale } = await requireCompletedWorkspace("/cv");
  return <WorkspaceUnavailable locale={locale} titleKey="workspace.cv" />;
}

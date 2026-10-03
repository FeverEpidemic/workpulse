import { achievementListHref, EMPTY_ACHIEVEMENT_FILTERS } from "@/domain/routes/achievement-filters";
import { projectListHref } from "@/domain/routes/project-filters";

export const dashboardLinks = {
  confirmedAchievements: () => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed" }),
  missingEvidence: () => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed", evidence: "missing" }),
  skill: (skillId: string) => achievementListHref({ ...EMPTY_ACHIEVEMENT_FILTERS, status: "confirmed", skill: skillId }),
  activeProjects: () => projectListHref({ status: "active", outcome: "" }),
  missingOutcome: () => projectListHref({ status: "completed", outcome: "missing" }),
  activity: (id: string) => `/activity/${id}`,
  project: (id: string) => `/projects/${id}`,
  allActivity: () => "/activity",
  newActivity: () => "/activity/new",
  profile: () => "/settings/profile",
  cvReview: () => "/cv#cv-review",
  cvAvailable: () => "/cv#cv-pool-achievements",
} as const;

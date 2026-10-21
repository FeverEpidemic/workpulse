import {
  Award,
  CalendarDays,
  FileText,
  FolderKanban,
  LayoutDashboard,
  NotebookTabs,
} from "lucide-react";

import type { MessageKey } from "@/i18n/messages";

export const navigation = [
  { href: "/dashboard", key: "workspace.dashboard", Icon: LayoutDashboard },
  { href: "/activity", key: "workspace.activity", Icon: NotebookTabs },
  { href: "/achievements", key: "workspace.achievements", Icon: Award },
  { href: "/projects", key: "workspace.projects", Icon: FolderKanban },
  { href: "/timeline", key: "workspace.timeline", Icon: CalendarDays },
  { href: "/cv", key: "workspace.cv", Icon: FileText },
] as const;

export function isCurrent(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

export type MobileTabId = "dashboard" | "activity" | "quickLog" | "projects" | "profile";

export const mobileTabs = [
  { id: "dashboard", href: "/dashboard", key: "workspace.dashboard" },
  { id: "activity", href: "/activity", key: "workspace.activity" },
  { id: "quickLog", href: null, key: "workspace.quickLog" },
  { id: "projects", href: "/projects", key: "workspace.projects" },
  { id: "profile", href: "/settings/profile", key: "workspace.profileTab" },
] as const satisfies readonly { id: MobileTabId; href: string | null; key: MessageKey }[];

// Achievements, Timeline and CV are reached from the More menu on Profile, so Profile stays lit there.
const profileSections = ["/settings/profile", "/achievements", "/timeline", "/cv"];

export function mobileTabFor(pathname: string): MobileTabId | null {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/activity/new") return null;
  if (isCurrent(pathname, "/activity")) return "activity";
  if (isCurrent(pathname, "/projects")) return "projects";
  if (profileSections.some((href) => isCurrent(pathname, href))) return "profile";
  return null;
}

export function mobileTabCurrent(pathname: string, tab: MobileTabId): "page" | "true" | undefined {
  if (mobileTabFor(pathname) !== tab) return undefined;
  const href = mobileTabs.find(({ id }) => id === tab)?.href;
  return pathname === href ? "page" : "true";
}

const mobileTitles: readonly [string, MessageKey][] = [
  ["/dashboard", "workspace.dashboard"],
  ["/activity", "workspace.activity"],
  ["/projects", "workspace.projects"],
  ["/achievements", "workspace.achievements"],
  ["/timeline", "workspace.timeline"],
  ["/cv", "workspace.cv"],
  ["/settings/profile", "profile.title"],
];

export function mobileTitleKey(pathname: string): MessageKey | null {
  if (pathname === "/activity/new") return "quickLog.title";
  return mobileTitles.find(([href]) => isCurrent(pathname, href))?.[1] ?? null;
}

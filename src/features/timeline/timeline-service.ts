import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";
import {
  filterTimelineEvents,
  groupTimelineEvents,
  buildTimelineEvents,
  TIMELINE_SOURCE_LIMIT,
  type TimelineSources,
} from "@/domain/timeline/timeline";
import type { TimelineFilters } from "@/domain/routes/timeline-filters";

export type TimelineServiceErrorCode = "UNAUTHENTICATED" | "UNAVAILABLE";

const ERROR_KEYS: Record<TimelineServiceErrorCode, MessageKey> = {
  UNAUTHENTICATED: "auth.signInRequired",
  UNAVAILABLE: "error.unavailable",
};

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);
type TimelineClient = SupabaseClient<Database>;

export class TimelineServiceError extends Error {
  readonly code: TimelineServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;

  constructor(code: TimelineServiceErrorCode) {
    super("Timeline service request could not be completed.");
    this.name = "TimelineServiceError";
    this.code = code;
    this.messageKey = ERROR_KEYS[code];
    this.correlationId = randomUUID();
  }
}

function isUnauthenticatedAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  return error.status === 401 || error.status === 403 || (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code));
}

async function withBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TimelineServiceError) throw error;
    throw new TimelineServiceError("UNAVAILABLE");
  }
}

export function createTimelineService(client: TimelineClient) {
  async function requireActorId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (data?.user) throw new TimelineServiceError("UNAVAILABLE");
      if (isUnauthenticatedAuthFailure(error)) throw new TimelineServiceError("UNAUTHENTICATED");
      throw new TimelineServiceError("UNAVAILABLE");
    }
    if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
    if (data?.user === null) throw new TimelineServiceError("UNAUTHENTICATED");
    throw new TimelineServiceError("UNAVAILABLE");
  }

  return {
    async getTimeline(filters: TimelineFilters) {
      return withBoundary(async () => {
        const actorId = await requireActorId();
        const [experienceResult, educationResult, projectResult, achievementResult] = await Promise.all([
          client.from("experiences")
            .select("id, organization, role_title, start_date, start_precision, end_date, end_precision, is_current")
            .eq("user_id", actorId)
            .order("start_date", { ascending: false, nullsFirst: false })
            .order("id", { ascending: true })
            .limit(TIMELINE_SOURCE_LIMIT + 1),
          client.from("education")
            .select("id, institution, qualification, start_date, start_precision, end_date, end_precision, is_current")
            .eq("user_id", actorId)
            .order("start_date", { ascending: false, nullsFirst: false })
            .order("id", { ascending: true })
            .limit(TIMELINE_SOURCE_LIMIT + 1),
          client.from("projects")
            .select("id, title, experience_id, start_date, start_precision, end_date, end_precision, is_current")
            .eq("user_id", actorId)
            .order("start_date", { ascending: false, nullsFirst: false })
            .order("id", { ascending: true })
            .limit(TIMELINE_SOURCE_LIMIT + 1),
          client.from("achievements")
            .select("id, title, status, achieved_on, project_id, experience_id")
            .eq("user_id", actorId)
            .eq("status", "confirmed")
            .order("achieved_on", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .limit(TIMELINE_SOURCE_LIMIT + 1),
        ]);

        if (experienceResult.error || educationResult.error || projectResult.error || achievementResult.error) {
          throw new TimelineServiceError("UNAVAILABLE");
        }

        const experiences = experienceResult.data ?? [];
        const education = educationResult.data ?? [];
        const projects = projectResult.data ?? [];
        const achievements = achievementResult.data ?? [];
        const truncated = [experiences, education, projects, achievements].some((rows) => rows.length > TIMELINE_SOURCE_LIMIT);
        const sources: TimelineSources = {
          experiences: experiences.slice(0, TIMELINE_SOURCE_LIMIT) as TimelineSources["experiences"],
          education: education.slice(0, TIMELINE_SOURCE_LIMIT) as TimelineSources["education"],
          projects: projects.slice(0, TIMELINE_SOURCE_LIMIT) as TimelineSources["projects"],
          achievements: achievements.slice(0, TIMELINE_SOURCE_LIMIT) as TimelineSources["achievements"],
        };
        const projectOptions = sources.projects
          .map((project) => ({ id: project.id, title: project.title }))
          .sort((left, right) => left.title.localeCompare(right.title, "en") || left.id.localeCompare(right.id, "en"));
        const events = filterTimelineEvents(buildTimelineEvents(sources), filters);
        return { groups: groupTimelineEvents(events), truncated, projectOptions };
      });
    },
  };
}

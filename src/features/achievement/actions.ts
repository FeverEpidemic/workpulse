"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sanitizeAchievementReturnTo } from "@/domain/routes/safe-return";
import type { MessageKey } from "@/i18n/messages";
import {
  achievementActionErrorState,
  achievementCreateInputFromForm,
  achievementDeleteInputFromForm,
  achievementRelinkInputFromForm,
  achievementSaveInputFromForm,
} from "@/features/achievement/achievement-action-contract";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function createAchievementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createAchievementService(client).createAchievement(achievementCreateInputFromForm(formData));
    revalidatePath("/achievements");
    revalidatePath(`/achievements/${receipt.achievementId}`);
    return actionSuccess("achievement.saved", receipt);
  } catch (error) {
    if (error instanceof AchievementServiceError) return achievementActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function saveAchievementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const input = achievementSaveInputFromForm(formData);
    const achievement = await createAchievementService(client).saveAchievement(input);
    revalidatePath("/achievements");
    revalidatePath(`/achievements/${achievement.id}`);
    if (achievement.activity_id) revalidatePath(`/activity/${achievement.activity_id}`);
    if (achievement.project_id) revalidatePath(`/projects/${achievement.project_id}`);
    const messageKey: MessageKey = achievement.status === "confirmed" && input.action === "confirm"
      ? "achievement.confirmedMessage"
      : input.action === "dismiss" ? "achievement.dismissedMessage" : "achievement.saved";
    return actionSuccess(messageKey, achievement);
  } catch (error) {
    if (error instanceof AchievementServiceError) {
      return achievementActionErrorState(error, error.code === "CONFLICT" ? formData.get("achievement_action") : undefined);
    }
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function relinkAchievementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const achievement = await createAchievementService(client).relinkAchievement(achievementRelinkInputFromForm(formData));
    revalidatePath("/achievements");
    revalidatePath(`/achievements/${achievement.id}`);
    revalidatePath("/projects/[id]", "page");
    revalidatePath("/activity/[id]", "page");
    return actionSuccess("achievement.saved", achievement);
  } catch (error) {
    if (error instanceof AchievementServiceError) return achievementActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function listAchievementRelinkCandidatesAction(projectId: string, cursor: string | null): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const page = await createAchievementService(client).listRelinkCandidates(projectId, { cursor });
    return actionSuccess(undefined, page);
  } catch (error) {
    if (error instanceof AchievementServiceError) return achievementActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function deleteAchievementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let returnTo = "/achievements";
  const rawReturnTo = formData.get("return_to");
  if (typeof rawReturnTo === "string") returnTo = sanitizeAchievementReturnTo(rawReturnTo);
  try {
    const client = await createSupabaseServerClient();
    await createAchievementService(client).deleteAchievement(achievementDeleteInputFromForm(formData));
    revalidatePath("/achievements");
    revalidatePath(returnTo.split("?", 1)[0] ?? "/achievements");
  } catch (error) {
    if (error instanceof AchievementServiceError) return achievementActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
  redirect(returnTo);
}

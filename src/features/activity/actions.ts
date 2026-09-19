"use server";

import { revalidatePath } from "next/cache";

import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import {
  activityActionErrorState,
  activityCreateInputFromForm,
  activityUpdateInputFromForm,
  isActivityCaptureMode,
} from "@/features/activity/activity-action-contract";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function createActivityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createActivityService(client).createActivity(activityCreateInputFromForm(formData));
    revalidatePath("/activity");
    revalidatePath(`/activity/${receipt.activityId}`);
    return actionSuccess("activity.saved", receipt);
  } catch (error) {
    if (error instanceof ActivityServiceError) return activityActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function updateActivityAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const service = createActivityService(client);
    const rawActivityId = formData.get("activity_id");
    const detail = await service.getActivity(typeof rawActivityId === "string" ? rawActivityId : "");
    const captureMode = detail.activity.capture_mode;
    if (!isActivityCaptureMode(captureMode)) return actionFailure("UNAVAILABLE", "error.unavailable");
    const activity = await service.updateActivity(activityUpdateInputFromForm(formData, captureMode));
    revalidatePath("/activity");
    revalidatePath(`/activity/${activity.id}`);
    return actionSuccess("activity.saved", activity);
  } catch (error) {
    if (error instanceof ActivityServiceError) return activityActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

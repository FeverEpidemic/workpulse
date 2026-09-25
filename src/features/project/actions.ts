"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  deleteProjectInputFromForm,
  projectCreateInputFromForm,
  projectFormErrorState,
  projectUpdateInputFromForm,
  projectActionErrorState,
  ProjectFormParseError,
  relinkActivityInputFromForm,
} from "@/features/project/project-action-contract";
import { ProjectServiceError, createProjectService } from "@/features/project/project-service";
import { sanitizeProjectReturnTo } from "@/domain/routes/safe-return";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

export async function createProjectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createProjectService(client).createProject(projectCreateInputFromForm(formData));
    revalidatePath("/projects");
    revalidatePath(`/projects/${receipt.projectId}`);
    return actionSuccess("project.saved", receipt);
  } catch (error) {
    if (error instanceof ProjectFormParseError) return projectFormErrorState(error);
    if (error instanceof ProjectServiceError) return projectActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function updateProjectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const project = await createProjectService(client).updateProject(projectUpdateInputFromForm(formData));
    revalidatePath("/projects");
    revalidatePath(`/projects/${project.id}`);
    revalidatePath("/activity");
    revalidatePath("/achievements");
    return actionSuccess("project.saved", project);
  } catch (error) {
    if (error instanceof ProjectFormParseError) return projectFormErrorState(error);
    if (error instanceof ProjectServiceError) return projectActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function relinkActivityProjectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const activity = await createProjectService(client).relinkActivity(relinkActivityInputFromForm(formData));
    revalidatePath("/projects");
    if (activity.project_id) revalidatePath(`/projects/${activity.project_id}`);
    revalidatePath(`/activity/${activity.id}`);
    revalidatePath("/activity");
    return actionSuccess("project.activityRelinked", activity);
  } catch (error) {
    if (error instanceof ProjectServiceError) return projectActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function listRelinkCandidatesAction(projectId: string, cursor: string | null): Promise<ActionState> {
  try {
    const client = await createSupabaseServerClient();
    const page = await createProjectService(client).listRelinkCandidates(projectId, { cursor });
    return actionSuccess(undefined, page);
  } catch (error) {
    if (error instanceof ProjectServiceError) return projectActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function deleteProjectAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let returnTo = "/projects";
  const rawReturnTo = formData.get("return_to");
  if (typeof rawReturnTo === "string") returnTo = sanitizeProjectReturnTo(rawReturnTo);
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createProjectService(client).deleteProject(deleteProjectInputFromForm(formData));
    revalidatePath("/projects");
    revalidatePath("/activity");
    void receipt;
  } catch (error) {
    if (error instanceof ProjectServiceError) return projectActionErrorState(error);
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
  redirect(returnTo);
}

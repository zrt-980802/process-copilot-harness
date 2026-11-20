import { inject, onBeforeUnmount, watch, type InjectionKey, type Ref } from "vue";
import { request as rawRequest, ApiClientError } from "./api";
import { experiencePolicy, type ExperienceSnapshot } from "./experience-policy";

export interface ExperienceContext {
  snapshot: Ref<ExperienceSnapshot>;
  signal(): AbortSignal;
  fail(error: unknown): void;
}
export const experienceKey: InjectionKey<ExperienceContext> = Symbol("current-experience");

export function useExperience(project: () => string = () => "") {
  const context = inject(experienceKey);
  if (!context) throw new Error("Current experience context is required");
  let controller = new AbortController();
  watch(project, () => { controller.abort(); controller = new AbortController(); }, { flush: "sync" });
  onBeforeUnmount(() => controller.abort());
  async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
    const snapshot = context!.snapshot.value;
    const required = path.includes("/catalog") ? "catalog" : path.includes("project-data") ? "project-data"
      : path.includes("capability-chain") ? "chain" : path.includes("/approvals") ? "approvals"
        : path.includes("/tools") || path.includes("write-requests") || path.includes("/reconcile") ? "tools" : undefined;
    const external = !!project() || required !== undefined;
    if (required && !experiencePolicy(snapshot).allowedProjectRequests.includes(required)) {
      throw new ApiClientError(403, "PC_EXPERIENCE_SCOPE_UNAVAILABLE", "当前范围没有该项能力", false);
    }
    const localSignal = controller.signal;
    const signal = AbortSignal.any([localSignal, ...(init.signal ? [init.signal] : []), ...(external ? [context!.signal()] : [])]);
    try {
      const result = await rawRequest<T>(path, token, { ...init, signal });
      signal.throwIfAborted();
      if (external && snapshot.generation !== context!.snapshot.value.generation) throw new DOMException("Experience replaced", "AbortError");
      return result;
    } catch (error) {
      if (external && !signal.aborted && snapshot.generation === context!.snapshot.value.generation
        && error instanceof ApiClientError && (error.status === 403 || error.code.includes("PROVIDER") || error.code.includes("AUTHORIZATION"))) {
        context!.fail(error);
      }
      throw error;
    }
  }
  return { request, snapshot: context.snapshot };
}

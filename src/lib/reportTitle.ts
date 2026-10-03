import type { Plan } from '../types';

/**
 * The plan as per-plan exports should title it: "project — plan" (e.g. "פרויקט חרצית 7 — דירה 12").
 * Per-plan exports print and file-name `plan.name`, so callers hand them this copy; only the name
 * differs and nothing is saved.
 */
export function planForReport(plan: Plan, projectName: string | undefined): Plan {
  const project = projectName?.trim();
  return project ? { ...plan, name: `${project} - ${plan.name}` } : plan;
}

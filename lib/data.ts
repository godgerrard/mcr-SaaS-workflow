import { createClient } from "@/lib/supabase/client";

export { applyChange } from "@/lib/reducer.mjs";
export type { RealtimeChange } from "@/lib/reducer";

export type Project = {
  id: string; title: string; client: string | null; status: string;
  current_stage: string | null; budget_allocated: number; deadline: string | null;
  stage_tasks: { id: string; stage: string; status: string; data: Record<string, unknown> }[];
  budget_entries: { amount: number }[];
};

export type Profile = { user_id: string; display_name: string; email: string };

export type Invite = {
  id: string; email: string; role: string; stage: string | null; created_at: string;
};

// Detail page shape: full rows (org_id + approvals) for the single-project view.
export type ProjectDetailRow = Omit<Project, "budget_entries"> & {
  org_id: string;
  budget_entries: { id: string; category: string; amount: number; created_at: string }[];
  approvals: { id: string; reviewer: string; decision: string; notes: string | null; created_at: string }[];
};

export async function fetchRundown(): Promise<Project[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*, stage_tasks(*), budget_entries(amount)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Project[];
}

export function burnRate(p: Project): number | null {
  if (!p.budget_allocated) return null;
  const spent = p.budget_entries.reduce((s, e) => s + Number(e.amount), 0);
  return spent / Number(p.budget_allocated);
}

export function daysToDeadline(p: Project): number | null {
  if (!p.deadline) return null;
  return Math.ceil((new Date(p.deadline).getTime() - Date.now()) / 86400000);
}

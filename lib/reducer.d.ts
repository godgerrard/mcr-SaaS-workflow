import type { Project } from "@/lib/data";

export type RealtimeChange = {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

export function applyChange(projects: Project[], change: RealtimeChange): Project[];

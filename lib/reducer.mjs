// Pure realtime-payload reducer. Plain .mjs (no side-effect imports, no browser APIs)
// so it can be imported directly by scripts/test-reducer.mjs under plain node,
// and re-exported by lib/data.ts for the app. Single source of truth — do not duplicate.

export function applyChange(projects, change) {
  const { table, eventType, new: row } = change;

  if (table === "projects") {
    if (eventType === "DELETE") return projects;
    const existing = projects.find((p) => p.id === row.id);
    // spread existing first so any caller-specific sub-arrays not present on the
    // raw column payload (stage_tasks, budget_entries, approvals) survive the merge.
    const merged = {
      ...existing,
      ...row,
      stage_tasks: existing?.stage_tasks ?? [],
      budget_entries: existing?.budget_entries ?? [],
      approvals: existing?.approvals ?? [],
    };
    if (existing) {
      return projects.map((p) => (p.id === row.id ? merged : p));
    }
    return [...projects, merged];
  }

  if (table === "stage_tasks") {
    if (eventType === "DELETE") return projects;
    const parent = projects.find((p) => p.id === row.project_id);
    if (!parent) return projects;
    const exists = parent.stage_tasks.some((t) => t.id === row.id);
    const nextTasks = exists
      ? parent.stage_tasks.map((t) => (t.id === row.id ? row : t))
      : [...parent.stage_tasks, row];
    return projects.map((p) => (p.id === parent.id ? { ...p, stage_tasks: nextTasks } : p));
  }

  if (table === "budget_entries") {
    if (eventType !== "INSERT") return projects;
    const parent = projects.find((p) => p.id === row.project_id);
    if (!parent) return projects;
    return projects.map((p) =>
      p.id === parent.id ? { ...p, budget_entries: [...p.budget_entries, row] } : p
    );
  }

  return projects;
}

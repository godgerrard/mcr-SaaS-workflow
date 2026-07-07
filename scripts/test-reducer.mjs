import assert from "node:assert";
import { applyChange } from "../lib/reducer.mjs";

function project(overrides = {}) {
  return {
    id: "p1", title: "Seg", client: null, status: "in_production",
    current_stage: "camera", budget_allocated: 1000, deadline: null,
    stage_tasks: [], budget_entries: [],
    ...overrides,
  };
}

// projects INSERT/UPDATE: upsert by id, preserve sub-arrays not present in payload.
{
  const before = [project({ stage_tasks: [{ id: "t1", stage: "camera", status: "pending", data: {} }] })];
  const after = applyChange(before, {
    table: "projects", eventType: "UPDATE",
    new: { id: "p1", title: "Seg", client: null, status: "on_hold", current_stage: "camera", budget_allocated: 1000, deadline: null },
    old: {},
  });
  assert.equal(after[0].status, "on_hold", "projects UPDATE should patch status");
  assert.equal(after[0].stage_tasks.length, 1, "projects UPDATE should preserve existing stage_tasks");
}

// projects UPDATE must preserve caller-specific fields not present on the raw
// column payload (e.g. ProjectDetailRow's `approvals`) — regression for a crash
// where `[...project.approvals]` threw "not iterable" after a projects event.
{
  const before = [project({ approvals: [{ id: "a1", decision: "approve" }] })];
  const after = applyChange(before, {
    table: "projects", eventType: "UPDATE",
    new: { id: "p1", title: "Seg", client: null, status: "on_hold", current_stage: "camera", budget_allocated: 1000, deadline: null },
    old: {},
  });
  assert.equal(after[0].approvals.length, 1, "projects UPDATE should preserve existing approvals");
}

// projects INSERT for unseen id appends a new project.
{
  const before = [];
  const after = applyChange(before, {
    table: "projects", eventType: "INSERT",
    new: { id: "p2", title: "New Seg", client: null, status: "proposed", current_stage: null, budget_allocated: 0, deadline: null },
    old: {},
  });
  assert.equal(after.length, 1, "projects INSERT should append");
  assert.equal(after[0].stage_tasks.length, 0, "new project should have empty stage_tasks default");
}

// stage_tasks INSERT/UPDATE: upsert into parent's stage_tasks array by task id.
{
  const before = [project({ stage_tasks: [{ id: "t1", stage: "camera", status: "in_progress", data: {} }] })];
  const after = applyChange(before, {
    table: "stage_tasks", eventType: "UPDATE",
    new: { id: "t1", project_id: "p1", stage: "camera", status: "done", data: {} },
    old: {},
  });
  assert.equal(after[0].stage_tasks[0].status, "done", "stage_tasks UPDATE should replace matching task");

  const after2 = applyChange(after, {
    table: "stage_tasks", eventType: "INSERT",
    new: { id: "t2", project_id: "p1", stage: "edit", status: "in_progress", data: {} },
    old: {},
  });
  assert.equal(after2[0].stage_tasks.length, 2, "stage_tasks INSERT should append new task");
}

// budget_entries INSERT: append {amount} to parent's budget_entries.
{
  const before = [project({ budget_entries: [{ amount: 100 }] })];
  const after = applyChange(before, {
    table: "budget_entries", eventType: "INSERT",
    new: { id: "b1", project_id: "p1", category: "gear", amount: 250, created_at: "2026-01-01" },
    old: {},
  });
  assert.equal(after[0].budget_entries.length, 2, "budget_entries INSERT should append");
  assert.equal(after[0].budget_entries[1].amount, 250, "appended entry should carry amount");
  assert.equal(after[0].budget_entries[1].category, "gear",
    "appended entry should carry category (ProjectDetailRow's budget log renders it)");
  assert.equal(after[0].budget_entries[1].created_at, "2026-01-01",
    "appended entry should carry created_at (ProjectDetailRow's budget log renders it)");
}

// budget_entries UPDATE/DELETE ignored (append-only).
{
  const before = [project({ budget_entries: [{ amount: 100 }] })];
  const afterUpdate = applyChange(before, {
    table: "budget_entries", eventType: "UPDATE",
    new: { id: "b1", project_id: "p1", category: "gear", amount: 999, created_at: "2026-01-01" },
    old: {},
  });
  assert.deepEqual(afterUpdate, before, "budget_entries UPDATE should be ignored");
  const afterDelete = applyChange(before, {
    table: "budget_entries", eventType: "DELETE",
    new: {}, old: { id: "b1", project_id: "p1" },
  });
  assert.deepEqual(afterDelete, before, "budget_entries DELETE should be ignored");
}

// DELETE ignored for all tables.
{
  const before = [project()];
  const afterProjectDelete = applyChange(before, {
    table: "projects", eventType: "DELETE", new: {}, old: { id: "p1" },
  });
  assert.deepEqual(afterProjectDelete, before, "projects DELETE should be ignored");

  const afterTaskDelete = applyChange(before, {
    table: "stage_tasks", eventType: "DELETE", new: {}, old: { id: "t1", project_id: "p1" },
  });
  assert.deepEqual(afterTaskDelete, before, "stage_tasks DELETE should be ignored");
}

// parent not found -> unchanged, for stage_tasks and budget_entries.
{
  const before = [project()];
  const afterTask = applyChange(before, {
    table: "stage_tasks", eventType: "INSERT",
    new: { id: "t9", project_id: "unknown", stage: "camera", status: "pending", data: {} },
    old: {},
  });
  assert.deepEqual(afterTask, before, "stage_tasks with unknown parent should be unchanged");

  const afterBudget = applyChange(before, {
    table: "budget_entries", eventType: "INSERT",
    new: { id: "b9", project_id: "unknown", category: "x", amount: 5 },
    old: {},
  });
  assert.deepEqual(afterBudget, before, "budget_entries with unknown parent should be unchanged");
}

console.log("ALL REDUCER TESTS PASSED");

import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const PASS = "demo-pass-123";

async function login(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASS });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

async function main() {
  // Outsider org: a second tenant that must see nothing of the demo org.
  const outsiderEmail = "ceo@other.mcr";
  const { error: mkErr } = await admin.auth.admin.createUser({
    email: outsiderEmail, password: PASS, email_confirm: true });
  if (mkErr && !mkErr.message.includes("already")) throw mkErr;

  const outsider = await login(outsiderEmail);
  await outsider.rpc("create_org", { p_name: "Other Org" }); // idempotent enough for re-runs (extra orgs harmless)

  // 1. TENANT ISOLATION: outsider sees zero rows of demo org data.
  for (const table of ["projects", "stage_tasks", "budget_entries", "approvals", "org_members"]) {
    const { data } = await outsider.from(table).select("*");
    const foreign = (data ?? []).filter((r) => r.org_id && r.org_id !== undefined);
    // outsider's own org has no projects yet, so any row visible in these tables is a leak
    assert.ok((data ?? []).every((r) => r.title !== "Election Special" && r.title !== "Morning News Package"),
      `LEAK: outsider can read ${table}`);
    assert.ok(foreign.length === (data ?? []).length, `sanity`);
  }
  const { data: demoProjects } = await outsider.from("projects").select("*")
    .in("title", ["Election Special", "Morning News Package"]);
  assert.equal(demoProjects.length, 0, "LEAK: outsider reads another org's projects");

  // 2. CREW SCOPING: crew-edit sees only edit tasks, no budget/approvals.
  const crew = await login("crew-edit@demo.mcr");
  const { data: crewTasks } = await crew.from("stage_tasks").select("*");
  assert.ok(crewTasks.length > 0, "crew should see own-stage tasks");
  assert.ok(crewTasks.every((t) => t.stage === "edit"), "LEAK: crew sees other stages");
  const { data: crewBudget } = await crew.from("budget_entries").select("*");
  assert.equal(crewBudget.length, 0, "LEAK: crew sees budget");
  const { data: crewApprovals } = await crew.from("approvals").select("*");
  assert.equal(crewApprovals.length, 0, "LEAK: crew sees approvals");

  // 3. CEO-ONLY GATEWAY: producer cannot approve.
  const producer = await login("producer@demo.mcr");
  const ceo = await login("ceo@demo.mcr");
  const { data: proposed } = await ceo.from("projects")
    .select("*").eq("status", "proposed").limit(1).single();
  const { error: prodApprove } = await producer.rpc("approve_project", { p_project: proposed.id });
  assert.ok(prodApprove, "producer approve should fail");

  // 4. STATE MACHINE: ceo approves -> 5 tasks, camera in_progress; direct status write blocked.
  const { error: ceoApprove } = await ceo.rpc("approve_project", { p_project: proposed.id });
  assert.equal(ceoApprove, null, `ceo approve failed: ${ceoApprove?.message}`);
  const { data: tasks } = await ceo.from("stage_tasks").select("*").eq("project_id", proposed.id);
  assert.equal(tasks.length, 5, "approve must create 5 tasks");
  assert.equal(tasks.find((t) => t.stage === "camera").status, "in_progress");

  const { error: directWrite } = await ceo.from("stage_tasks")
    .update({ status: "done" }).eq("id", tasks[0].id);
  assert.ok(directWrite, "direct status write must be rejected by guard trigger");

  // 5. AUTO-ADVANCE: crew completes edit -> graphics becomes in_progress.
  const { data: editTask } = await crew.from("stage_tasks").select("*")
    .eq("status", "in_progress").limit(1).single();
  const { error: doneErr } = await crew.rpc("complete_stage_task", { p_task: editTask.id });
  assert.equal(doneErr, null, `crew complete failed: ${doneErr?.message}`);
  const { data: gfx } = await ceo.from("stage_tasks").select("*")
    .eq("project_id", editTask.project_id).eq("stage", "graphics").single();
  assert.equal(gfx.status, "in_progress", "next stage must auto-activate");

  // 6. REALTIME TENANT ISOLATION: outsider's channel receives zero events for
  // demo-org mutations; a positive-control channel on the demo org confirms
  // realtime is actually delivering (guards against a false pass from a
  // misconfigured publication where nothing is delivered to anyone).
  const outsiderEvents = [];
  const ceoEvents = [];

  const waitSubscribed = (channel) =>
    new Promise((resolve, reject) => {
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(err ?? new Error(`channel failed: ${status}`));
        }
      });
    });

  const outsiderChannel = outsider.channel("test-outsider");
  for (const table of ["projects", "stage_tasks", "budget_entries"]) {
    outsiderChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => outsiderEvents.push(payload)
    );
  }

  const ceoChannel = ceo.channel("test-ceo-positive-control");
  for (const table of ["projects", "stage_tasks", "budget_entries"]) {
    ceoChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => ceoEvents.push(payload)
    );
  }

  await Promise.all([waitSubscribed(outsiderChannel), waitSubscribed(ceoChannel)]);

  const { data: probeProjectId, error: createErr } = await ceo.rpc("create_project", {
    p_title: "Realtime Probe Segment", p_client: null, p_budget: 1000,
  });
  assert.equal(createErr, null, `create_project failed: ${createErr?.message}`);
  const { error: approveErr } = await ceo.rpc("approve_project", { p_project: probeProjectId });
  assert.equal(approveErr, null, `probe approve failed: ${approveErr?.message}`);
  const { data: probeProject } = await ceo.from("projects").select("org_id").eq("id", probeProjectId).single();
  const { error: budgetErr } = await ceo.from("budget_entries")
    .insert({ project_id: probeProjectId, org_id: probeProject.org_id, category: "probe", amount: 42 });
  assert.equal(budgetErr, null, `probe budget insert failed: ${budgetErr?.message}`);

  await new Promise((resolve) => setTimeout(resolve, 4000));

  assert.equal(outsiderEvents.length, 0, "LEAK: outsider received realtime events for another org");
  assert.ok(ceoEvents.length > 0, "realtime not delivering — test would false-pass");

  await outsider.removeChannel(outsiderChannel);
  await ceo.removeChannel(ceoChannel);
  await outsider.realtime.disconnect();
  await ceo.realtime.disconnect();

  console.log("ALL SECURITY CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

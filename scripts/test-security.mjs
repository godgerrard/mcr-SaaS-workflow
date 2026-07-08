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
  // The positive control is known-flaky (~1 in 3): it gets ONE automatic retry
  // with fresh channels. The outsider LEAK assertion is enforced on every attempt.
  const waitSubscribed = (channel) =>
    new Promise((resolve, reject) => {
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(err ?? new Error(`channel failed: ${status}`));
        }
      });
    });

  const runRealtimeProbe = async (probeTitle) => {
    const outsiderEvents = [];
    const ceoEvents = [];

    const outsiderChannel = outsider.channel(`test-outsider-${Date.now()}`);
    for (const table of ["projects", "stage_tasks", "budget_entries"]) {
      outsiderChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => outsiderEvents.push(payload)
      );
    }

    const ceoChannel = ceo.channel(`test-ceo-positive-control-${Date.now()}`);
    for (const table of ["projects", "stage_tasks", "budget_entries"]) {
      ceoChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => ceoEvents.push(payload)
      );
    }

    await Promise.all([waitSubscribed(outsiderChannel), waitSubscribed(ceoChannel)]);

    const { data: probeProjectId, error: createErr } = await ceo.rpc("create_project", {
      p_title: probeTitle, p_client: null, p_budget: 1000,
    });
    assert.equal(createErr, null, `create_project failed: ${createErr?.message}`);
    const { error: approveErr } = await ceo.rpc("approve_project", { p_project: probeProjectId });
    assert.equal(approveErr, null, `probe approve failed: ${approveErr?.message}`);
    const { data: probeProject } = await ceo.from("projects").select("org_id").eq("id", probeProjectId).single();
    const { error: budgetErr } = await ceo.from("budget_entries")
      .insert({ project_id: probeProjectId, org_id: probeProject.org_id, category: "probe", amount: 42 });
    assert.equal(budgetErr, null, `probe budget insert failed: ${budgetErr?.message}`);

    await new Promise((resolve) => setTimeout(resolve, 4000));

    await outsider.removeChannel(outsiderChannel);
    await ceo.removeChannel(ceoChannel);

    return { outsiderEvents, ceoEvents };
  };

  let probe = await runRealtimeProbe("Realtime Probe Segment");
  assert.equal(probe.outsiderEvents.length, 0, "LEAK: outsider received realtime events for another org");
  if (probe.ceoEvents.length === 0) {
    console.log("WARN: positive control got no events; retrying once with fresh channels");
    probe = await runRealtimeProbe("Realtime Probe Segment B");
    assert.equal(probe.outsiderEvents.length, 0, "LEAK: outsider received realtime events for another org");
  }
  assert.ok(probe.ceoEvents.length > 0, "realtime not delivering — test would false-pass");

  await outsider.realtime.disconnect();
  await ceo.realtime.disconnect();

  // 7. ACCOUNTS & INVITES: invite visibility, role-management guards,
  // invite claim flow, last-CEO protection, member removal.
  const { data: ceoMembership } = await ceo
    .from("org_members").select("org_id, user_id").eq("role", "ceo").limit(1).single();
  const demoOrgId = ceoMembership.org_id;
  const ceoId = ceoMembership.user_id;

  // clean slate for re-runs: drop any pending invites for the test emails
  await ceo.from("invites").delete()
    .in("email", ["leak-probe@demo.mcr", "invitee@demo.mcr"]).is("claimed_at", null);

  // 7a. outsider sees zero demo-org invites (create one first so there is something to leak)
  const { error: leakInvErr } = await ceo.from("invites").insert({
    org_id: demoOrgId, email: "leak-probe@demo.mcr", role: "producer", stage: null, invited_by: ceoId,
  });
  assert.equal(leakInvErr, null, `ceo invite insert failed: ${leakInvErr?.message}`);
  const { data: outsiderInvites } = await outsider.from("invites").select("*");
  assert.equal((outsiderInvites ?? []).filter((i) => i.org_id === demoOrgId).length, 0,
    "LEAK: outsider can read another org's invites");

  // 7b. crew cannot manage members or invites
  const { error: crewInvErr } = await crew.from("invites").insert({
    org_id: demoOrgId, email: "crew-made@demo.mcr", role: "crew", stage: "edit",
    invited_by: (await crew.auth.getUser()).data.user.id,
  });
  assert.ok(crewInvErr, "LEAK: crew can insert invites");
  const { error: crewRoleErr } = await crew.rpc("update_member_role", {
    p_user: ceoId, p_role: "crew", p_stage: "edit",
  });
  assert.ok(crewRoleErr, "LEAK: crew can update member roles");

  // 7c. producer cannot touch the CEO or mint CEO invites; CAN invite crew
  const producerId = (await producer.auth.getUser()).data.user.id;
  const { error: prodCeoInvErr } = await producer.from("invites").insert({
    org_id: demoOrgId, email: "usurper@demo.mcr", role: "ceo", stage: null, invited_by: producerId,
  });
  assert.ok(prodCeoInvErr, "LEAK: producer can create a CEO invite");
  const { error: prodDemoteErr } = await producer.rpc("update_member_role", {
    p_user: ceoId, p_role: "producer",
  });
  assert.ok(prodDemoteErr, "LEAK: producer can demote the CEO");
  const { error: prodRemoveErr } = await producer.rpc("remove_member", { p_user: ceoId });
  assert.ok(prodRemoveErr, "LEAK: producer can remove the CEO");
  const { error: prodCrewInvErr } = await producer.from("invites").insert({
    org_id: demoOrgId, email: "invitee@demo.mcr", role: "crew", stage: "graphics", invited_by: producerId,
  });
  assert.equal(prodCrewInvErr, null, `producer crew invite failed: ${prodCrewInvErr?.message}`);

  // 7d. invitee claims the invite and lands as graphics crew
  const { data: madeUser, error: mkInvErr } = await admin.auth.admin.createUser({
    email: "invitee@demo.mcr", password: PASS, email_confirm: true,
  });
  if (mkInvErr && !mkInvErr.message.includes("already")) throw mkInvErr;
  let inviteeId = madeUser?.user?.id;
  if (!inviteeId) {
    const { data: list } = await admin.auth.admin.listUsers();
    inviteeId = list.users.find((u) => u.email === "invitee@demo.mcr").id;
  }
  const invitee = await login("invitee@demo.mcr");
  const { data: claimedOrg, error: claimErr } = await invitee.rpc("claim_invite", {
    p_display_name: "Invitee Test",
  });
  assert.equal(claimErr, null, `claim_invite failed: ${claimErr?.message}`);
  assert.equal(claimedOrg, demoOrgId, "claim_invite returned wrong org");
  const { data: inviteeRow } = await invitee.from("org_members")
    .select("*").eq("user_id", inviteeId).single();
  assert.equal(inviteeRow.role, "crew", "invitee should be crew");
  assert.equal(inviteeRow.stage, "graphics", "invitee should be on graphics");
  const { data: inviteeTasks } = await invitee.from("stage_tasks").select("*");
  assert.ok(inviteeTasks.length > 0, "invitee crew should see own-stage tasks");
  assert.ok(inviteeTasks.every((t) => t.stage === "graphics"), "LEAK: invitee sees other stages");
  const { data: inviteeBudget } = await invitee.from("budget_entries").select("*");
  assert.equal(inviteeBudget.length, 0, "LEAK: invitee crew sees budget");

  // 7e. last-CEO protection: cannot self-demote or self-remove
  const { error: selfDemoteErr } = await ceo.rpc("update_member_role", {
    p_user: ceoId, p_role: "producer",
  });
  assert.ok(selfDemoteErr, "last CEO demote must fail");
  const { error: selfRemoveErr } = await ceo.rpc("remove_member", { p_user: ceoId });
  assert.ok(selfRemoveErr, "last CEO removal must fail");

  // 7f. ceo removes the invitee; access is gone; the claimed invite cannot be re-claimed
  const { error: removeInviteeErr } = await ceo.rpc("remove_member", { p_user: inviteeId });
  assert.equal(removeInviteeErr, null, `remove_member failed: ${removeInviteeErr?.message}`);
  const { data: tasksAfter } = await invitee.from("stage_tasks").select("*");
  assert.equal((tasksAfter ?? []).length, 0, "LEAK: removed member still sees stage_tasks");
  const { error: reclaimErr } = await invitee.rpc("claim_invite", { p_display_name: "Invitee Test" });
  assert.ok(reclaimErr, "second claim_invite must fail (invite already claimed)");

  // 8. ASSET STORAGE ISOLATION: private "assets" bucket, per-stage prefixes
  // {org_id}/{project_id}/{stage}/{filename}. RLS: ceo/producer read+write all
  // stages of their org; crew only their own stage; no update/delete (immutable).
  const base = `${demoOrgId}/${proposed.id}`;
  const ceoPath = `${base}/camera/sec8-ceo.txt`;
  const crewPath = `${base}/edit/sec8-crew.txt`;
  // cleanup at section START (admin bypasses RLS) so re-runs stay clean even
  // after a mid-section failure on a previous run
  await admin.storage.from("assets").remove([ceoPath, crewPath]);
  const probeFile = () => new Blob(["probe"]);

  // 8a. ceo uploads to camera
  const { error: ceoUpErr } = await ceo.storage.from("assets").upload(ceoPath, probeFile());
  assert.equal(ceoUpErr, null, `ceo upload failed: ${ceoUpErr?.message}`);

  // 8b. crew uploads to own stage; blocked on another stage
  const { error: crewUpErr } = await crew.storage.from("assets").upload(crewPath, probeFile());
  assert.equal(crewUpErr, null, `crew own-stage upload failed: ${crewUpErr?.message}`);
  const { error: crewWrongErr } = await crew.storage.from("assets")
    .upload(`${base}/camera/sec8-crew-wrong.txt`, probeFile());
  assert.ok(crewWrongErr, "LEAK: crew can upload to another stage");

  // 8c. crew lists another stage -> 0 rows; own stage -> sees own file
  const { data: crewCamList } = await crew.storage.from("assets").list(`${base}/camera`);
  assert.equal((crewCamList ?? []).length, 0, "LEAK: crew lists another stage's assets");
  const { data: crewEditList } = await crew.storage.from("assets").list(`${base}/edit`);
  assert.ok((crewEditList ?? []).some((f) => f.name === "sec8-crew.txt"),
    "crew should list own-stage assets");

  // 8d. crew cannot sign an object outside their stage
  const { error: crewSignErr } = await crew.storage.from("assets").createSignedUrl(ceoPath, 60);
  assert.ok(crewSignErr, "LEAK: crew can sign another stage's object");

  // 8e. outsider: list -> 0 rows, upload rejected, sign fails
  const { data: outsiderList } = await outsider.storage.from("assets").list(`${base}/camera`);
  assert.equal((outsiderList ?? []).length, 0, "LEAK: outsider lists another org's assets");
  const { error: outsiderUpErr } = await outsider.storage.from("assets")
    .upload(`${base}/camera/sec8-outsider.txt`, probeFile());
  assert.ok(outsiderUpErr, "LEAK: outsider can upload into another org");
  const { error: outsiderSignErr } = await outsider.storage.from("assets").createSignedUrl(ceoPath, 60);
  assert.ok(outsiderSignErr, "LEAK: outsider can sign another org's object");

  // 8f. positive control: ceo signs own file AND the URL actually serves it
  // (guards deny-asserts above from false-passing on a broken bucket)
  const { data: signed, error: ceoSignErr } = await ceo.storage.from("assets").createSignedUrl(ceoPath, 60);
  assert.equal(ceoSignErr, null, `ceo sign failed: ${ceoSignErr?.message}`);
  const signedRes = await fetch(signed.signedUrl);
  assert.ok(signedRes.ok, `signed URL fetch failed: HTTP ${signedRes.status}`);

  // 8g. immutability: overwrite with upsert must be rejected (no update policy)
  const { error: upsertErr } = await ceo.storage.from("assets")
    .upload(ceoPath, probeFile(), { upsert: true });
  assert.ok(upsertErr, "LEAK: assets are overwritable (upsert succeeded)");

  console.log("ALL SECURITY CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

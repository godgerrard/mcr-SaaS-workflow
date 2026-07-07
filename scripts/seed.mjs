import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PASS = "demo-pass-123"; // test-harness only; product UI has no password form

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASS, email_confirm: true,
  });
  if (error && !error.message.includes("already")) throw error;
  if (data?.user) return data.user.id;
  const { data: list } = await admin.auth.admin.listUsers();
  return list.users.find((u) => u.email === email).id;
}

async function main() {
  const ceo = await makeUser("ceo@demo.mcr");
  const producer = await makeUser("producer@demo.mcr");
  const crewEdit = await makeUser("crew-edit@demo.mcr");

  // org via service role (bypasses RLS; same shape create_org produces)
  const { data: org, error: orgErr } = await admin
    .from("orgs").insert({ name: "Demo Broadcast Co" }).select().single();
  if (orgErr) throw orgErr;

  const { error: memErr } = await admin.from("org_members").insert([
    { user_id: ceo, org_id: org.id, role: "ceo" },
    { user_id: producer, org_id: org.id, role: "producer" },
    { user_id: crewEdit, org_id: org.id, role: "crew", stage: "edit" },
  ]);
  if (memErr) throw memErr;

  await admin.from("projects").insert({
    org_id: org.id, title: "Morning News Package", client: "Channel One",
    budget_allocated: 50000,
    deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  });

  const { data: p2 } = await admin.from("projects").insert({
    org_id: org.id, title: "Election Special", client: "Channel One",
    budget_allocated: 120000, status: "in_production", current_stage: "edit",
    deadline: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  }).select().single();

  const stages = ["camera", "edit", "graphics", "sound", "final_qc"];
  await admin.from("stage_tasks").insert(stages.map((s) => ({
    org_id: org.id, project_id: p2.id, stage: s,
    status: s === "camera" ? "done" : s === "edit" ? "in_progress" : "pending",
    data: s === "camera" ? { rawContentSize: "480GB", contentDuration: "6h20m" } : {},
  })));

  await admin.from("budget_entries").insert([
    { org_id: org.id, project_id: p2.id, category: "crew", amount: 18000 },
    { org_id: org.id, project_id: p2.id, category: "equipment", amount: 9500 },
  ]);

  console.log("seeded:", org.id);
}

main().catch((e) => { console.error(e); process.exit(1); });

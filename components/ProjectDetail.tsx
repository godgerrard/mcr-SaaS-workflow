"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SignalChain, { completeTask } from "@/components/SignalChain";
import { STAGES, STAGE_LABEL, STATUS_META } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { burnRate, daysToDeadline, applyChange, type ProjectDetailRow } from "@/lib/data";
import type { RealtimeChannel } from "@supabase/supabase-js";

function AddBudgetEntryForm({
  projectId,
  orgId,
  onAdded,
}: {
  projectId: string;
  orgId: string;
  onAdded: () => void;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const supabase = createClient();

  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category.trim() || !amount) return;
    setFormError(null);
    const { error } = await supabase.from("budget_entries").insert({
      project_id: projectId, org_id: orgId, category, amount: Number(amount),
    });
    if (error) { setFormError(error.message); return; }
    setCategory("");
    setAmount("");
    onAdded();
  };

  return (
    <form className="segment-slip" onSubmit={submit}>
      <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
      <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button className="btn btn-primary" type="submit">Add entry</button>
      {formError && <p className="error">{formError}</p>}
    </form>
  );
}

function StageAssets({
  orgId,
  projectId,
  stage,
}: {
  orgId: string;
  projectId: string;
  stage: string;
}) {
  const [files, setFiles] = useState<{ name: string; created_at: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const prefix = `${orgId}/${projectId}/${stage}`;

  const refresh = async () => {
    const { data } = await supabase.storage.from("assets").list(prefix);
    setFiles(data ?? []);
  };

  useEffect(() => {
    supabase.storage.from("assets").list(prefix).then(({ data }) => setFiles(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const { error: upErr } = await supabase.storage.from("assets").upload(`${prefix}/${file.name}`, file);
    if (upErr) setError(upErr.message);
    else refresh();
  };

  const download = async (name: string) => {
    setError(null);
    const { data, error: signErr } = await supabase.storage
      .from("assets")
      .createSignedUrl(`${prefix}/${name}`, 60);
    if (signErr) setError(signErr.message);
    else window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="rundown" style={{ marginBottom: 14 }}>
      <div className="stage-data" style={{ marginTop: 0 }}>
        <span>{STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}</span>
      </div>
      {files.map((f) => (
        <div key={f.name} className="row-main" onClick={() => download(f.name)}>
          <span>{f.name}</span>
          <span>{f.created_at ? new Date(f.created_at).toLocaleString("en-GB") : "—"}</span>
        </div>
      ))}
      {files.length === 0 && <div className="empty-state">No assets yet.</div>}
      {error && <div className="error">{error}</div>}
      <div className="segment-slip">
        <input type="file" onChange={onUpload} />
      </div>
    </div>
  );
}

export default function ProjectDetail({
  project: initial,
  role,
  myStage,
}: {
  project: ProjectDetailRow;
  role: string;
  myStage: string | null;
}) {
  const [project, setProject] = useState<ProjectDetailRow>(initial);
  const [pulseStage, setPulseStage] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});
  const supabase = createClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    supabase.from("profiles").select("user_id, display_name").then(({ data }) => {
      if (data) setReviewerNames(Object.fromEntries(data.map((p) => [p.user_id, p.display_name])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetchApprovals = async () => {
    const { data } = await supabase.from("approvals").select("*").eq("project_id", project.id);
    if (data) setProject((p) => ({ ...p, approvals: data as ProjectDetailRow["approvals"] }));
  };

  const refetchProject = async () => {
    const { data } = await supabase
      .from("projects")
      .select("*, stage_tasks(*), budget_entries(*), approvals(*)")
      .eq("id", project.id)
      .maybeSingle();
    if (data) setProject(data as ProjectDetailRow);
  };

  useEffect(() => {
    const filter = { filter: `project_id=eq.${project.id}` };
    const channel = supabase
      .channel(`project-${project.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${project.id}` },
        (payload) => {
          const prevStatus = project.status;
          const newRow = payload.new as { status?: string } | undefined;
          setProject((p) => (applyChange([p], payload)[0] as ProjectDetailRow) ?? p);
          if (newRow?.status && newRow.status !== prevStatus) refetchApprovals();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stage_tasks", ...filter },
        (payload) => setProject((p) => (applyChange([p], payload)[0] as ProjectDetailRow) ?? p)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "budget_entries", ...filter },
        (payload) => setProject((p) => (applyChange([p], payload)[0] as ProjectDetailRow) ?? p)
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const decide = async (decision: "approve" | "reject" | "hold") => {
    setActionError(null);
    const p_notes = notes.trim() || null;
    const { error } =
      decision === "approve"
        ? await supabase.rpc("approve_project", { p_project: project.id })
        : decision === "reject"
          ? await supabase.rpc("reject_project", { p_project: project.id, p_notes })
          : await supabase.rpc("hold_project", { p_project: project.id, p_notes });
    if (error) { setActionError(error.message); return; }
    setNotes("");
    await refetchApprovals();
  };

  const handleAdvance = async (task: ProjectDetailRow["stage_tasks"][number]) => {
    setActionError(null);
    const { error } = await completeTask(task);
    if (error) { setActionError(error.message); return; }
    setPulseStage(task.stage);
    setTimeout(() => setPulseStage(null), 650);
  };

  const meta = STATUS_META[project.status] ?? { label: project.status, tally: "off" };
  const spent = project.budget_entries.reduce((s, e) => s + Number(e.amount), 0);
  const rate = burnRate(project);
  const days = daysToDeadline(project);
  const approvalsByNewest = [...project.approvals].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="app">
      <div className="masthead">
        <div className="masthead-id">
          <div className="colorbars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div>
            <h1>{project.title}</h1>
            <div className="subline">{project.client ?? "NO CLIENT"}</div>
          </div>
        </div>
        <Link href="/" className="btn">Back to rundown</Link>
      </div>

      <div className="row-detail" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div className={`status-pill ${project.status}`}>{meta.label}</div>
        <span>Burn: {rate == null ? "—" : `${Math.round(rate * 100)}%`}</span>
        <span>Deadline: {days == null ? "—" : days < 0 ? `T+${Math.abs(days)}D` : `T-${days}D`}</span>
      </div>

      {role === "ceo" && ["proposed", "on_hold"].includes(project.status) && (
        <div className="gateway-console">
          <span className="label">CEO Approval Gateway</span>
          <button className="btn btn-primary" onClick={() => decide("approve")}>Approve</button>
          <button className="btn" onClick={() => decide("hold")}>Hold</button>
          <button className="btn btn-danger" onClick={() => decide("reject")}>Reject</button>
          <input
            placeholder="Reason (sent with Hold/Reject)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}
      {actionError && <p className="error">{actionError}</p>}

      {project.stage_tasks.length > 0 && (
        <SignalChain
          project={project}
          tasks={project.stage_tasks}
          onAdvance={handleAdvance}
          pulseStage={pulseStage}
          role={role}
          myStage={myStage}
        />
      )}

      <h2>Assets</h2>
      {STAGES.map((stage) => (
        <StageAssets key={stage} orgId={project.org_id} projectId={project.id} stage={stage} />
      ))}

      <h2>Budget log</h2>
      <div className="rundown">
        {project.budget_entries.map((entry) => (
          <div key={entry.id} className="row-main">
            <span>{entry.category}</span>
            <span>${Number(entry.amount).toLocaleString()}</span>
            <span>{new Date(entry.created_at).toLocaleString("en-GB")}</span>
          </div>
        ))}
        {project.budget_entries.length === 0 && <div className="empty-state">No budget entries yet.</div>}
        <div>Total spent: ${spent.toLocaleString()} / ${Number(project.budget_allocated).toLocaleString()}</div>
      </div>
      {role !== "crew" && (
        <AddBudgetEntryForm projectId={project.id} orgId={project.org_id} onAdded={refetchProject} />
      )}

      <h2>Approval history</h2>
      <div className="rundown">
        {approvalsByNewest.map((a) => (
          <div key={a.id} className="row-main">
            <span>{a.decision}</span>
            <span>{reviewerNames[a.reviewer] ?? a.reviewer.slice(0, 8)}</span>
            <span>{a.notes ?? "—"}</span>
            <span>{new Date(a.created_at).toLocaleString("en-GB")}</span>
          </div>
        ))}
        {approvalsByNewest.length === 0 && <div className="empty-state">No approval decisions yet.</div>}
      </div>
    </div>
  );
}

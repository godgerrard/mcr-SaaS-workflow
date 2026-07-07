"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SignalChain, { completeTask } from "@/components/SignalChain";
import { STATUS_META } from "@/lib/stages";
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category.trim() || !amount) return;
    await supabase.from("budget_entries").insert({
      project_id: projectId, org_id: orgId, category, amount: Number(amount),
    });
    setCategory("");
    setAmount("");
    onAdded();
  };

  return (
    <form className="segment-slip" onSubmit={submit}>
      <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
      <input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button className="btn btn-primary" type="submit">Add entry</button>
    </form>
  );
}

export default function ProjectDetail({
  project: initial,
  role,
}: {
  project: ProjectDetailRow;
  role: string;
}) {
  const [project, setProject] = useState<ProjectDetailRow>(initial);
  const [pulseStage, setPulseStage] = useState<string | null>(null);
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
    if (decision === "approve") await supabase.rpc("approve_project", { p_project: project.id });
    if (decision === "reject") await supabase.rpc("reject_project", { p_project: project.id, p_notes: null });
    if (decision === "hold") await supabase.rpc("hold_project", { p_project: project.id, p_notes: null });
    await refetchApprovals();
  };

  const handleAdvance = async (task: ProjectDetailRow["stage_tasks"][number]) => {
    await completeTask(task);
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

      {["proposed", "on_hold"].includes(project.status) && (
        <div className="gateway-console">
          <span className="label">CEO Approval Gateway</span>
          <button className="btn btn-primary" onClick={() => decide("approve")}>Approve</button>
          <button className="btn" onClick={() => decide("hold")}>Hold</button>
          <button className="btn btn-danger" onClick={() => decide("reject")}>Reject</button>
        </div>
      )}

      {project.stage_tasks.length > 0 && (
        <SignalChain
          project={project}
          tasks={project.stage_tasks}
          onAdvance={handleAdvance}
          pulseStage={pulseStage}
        />
      )}

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

"use client";
import { useState } from "react";
import SignalChain, { completeTask } from "@/components/SignalChain";
import { STATUS_META } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { burnRate, daysToDeadline, type Project } from "@/lib/data";

function Vu({ burnRate, spent, allocated }: { burnRate: number | null; spent: number; allocated: number }) {
  if (burnRate == null) return <span className="vu-label">—</span>;
  const pct = Math.min(burnRate * 100, 100);
  const zone = burnRate > 0.9 ? "zone-red" : burnRate > 0.7 ? "zone-amber" : "zone-green";
  return (
    <div className="vu" title={`$${spent.toLocaleString()} / $${allocated.toLocaleString()}`}>
      <div className="vu-track">
        <div className={`vu-fill ${zone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="vu-label">{Math.round(burnRate * 100)}%</span>
    </div>
  );
}

function Deadline({ days }: { days: number | null }) {
  if (days == null) return <span className="deadline">—</span>;
  const overdue = days < 0;
  const soon = days >= 0 && days <= 3;
  return (
    <span className={`deadline ${overdue ? "overdue" : soon ? "soon" : ""}`}>
      {overdue ? `T+${Math.abs(days)}D` : `T-${days}D`}
    </span>
  );
}

export default function RundownRow({
  project,
  index,
  onAction,
}: {
  project: Project;
  index: number;
  onAction: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pulseStage, setPulseStage] = useState<string | null>(null);
  const meta = STATUS_META[project.status] ?? { label: project.status, tally: "off" };
  const supabase = createClient();

  const decide = async (decision: "approve" | "reject" | "hold", e: React.MouseEvent) => {
    e.stopPropagation();
    if (decision === "approve") await supabase.rpc("approve_project", { p_project: project.id });
    if (decision === "reject") await supabase.rpc("reject_project", { p_project: project.id, p_notes: null });
    if (decision === "hold") await supabase.rpc("hold_project", { p_project: project.id, p_notes: null });
    onAction();
  };

  const handleAdvance = async (task: Project["stage_tasks"][number]) => {
    await completeTask(task);
    setPulseStage(task.stage);
    setTimeout(() => setPulseStage(null), 650);
    onAction();
  };

  const spent = project.budget_entries.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="row" style={{ "--row-index": index } as React.CSSProperties}>
      <div className="row-main" onClick={() => setOpen((o) => !o)}>
        <div className={`tally ${meta.tally !== "off" ? `lit-${meta.tally}` : ""}`} />
        <div className="seg-no">{String(index + 1).padStart(2, "0")}</div>
        <div className="row-title">
          <div className="name">{project.title}</div>
          {project.client && <div className="client">{project.client}</div>}
        </div>
        <div className={`status-pill ${project.status}`}>{meta.label}</div>
        <Vu burnRate={burnRate(project)} spent={spent} allocated={project.budget_allocated} />
        <Deadline days={daysToDeadline(project)} />
        <div className="chevron">{open ? "▾" : "▸"}</div>
      </div>

      {open && (
        <div className="row-detail">
          {["proposed", "on_hold"].includes(project.status) && (
            <div className="gateway-console">
              <span className="label">CEO Approval Gateway</span>
              <button className="btn btn-primary" onClick={(e) => decide("approve", e)}>
                Approve
              </button>
              <button className="btn" onClick={(e) => decide("hold", e)}>
                Hold
              </button>
              <button className="btn btn-danger" onClick={(e) => decide("reject", e)}>
                Reject
              </button>
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
        </div>
      )}
    </div>
  );
}

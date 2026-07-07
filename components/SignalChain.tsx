"use client";
import React from "react";
import { STAGES, STAGE_LABEL } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/data";

type Task = Project["stage_tasks"][number];

function formatTaskData(stage: string, data: Record<string, unknown>) {
  if (stage === "camera") {
    return [
      data.rawContentSize && ["Raw size", data.rawContentSize],
      data.contentDuration && ["Duration", data.contentDuration],
    ].filter(Boolean) as [string, unknown][];
  }
  if (stage === "edit") {
    return [
      data.cutDuration && ["Cut", data.cutDuration],
      data.animationRequired != null && ["Animation", data.animationRequired ? "required" : "no"],
    ].filter(Boolean) as [string, unknown][];
  }
  if (stage === "sound") {
    return ([data.mastered != null && ["Mastered", data.mastered ? "yes" : "no"]].filter(
      Boolean
    )) as [string, unknown][];
  }
  return [];
}

export default function SignalChain({
  tasks,
  onAdvance,
  pulseStage,
}: {
  project: Project;
  tasks: Task[];
  onAdvance: (task: Task) => void;
  pulseStage: string | null;
}) {
  return (
    <div className="chain">
      {STAGES.map((stage, i) => {
        const task = tasks.find((t) => t.stage === stage);
        const status = task?.status ?? "pending";
        const details = task ? formatTaskData(stage, task.data) : [];
        return (
          <React.Fragment key={stage}>
            <div className="chain-node">
              <div className={`lamp ${status}`}>
                <div className="bulb" />
                <div className="stage-label">{STAGE_LABEL[stage]}</div>
              </div>
              {task && status === "in_progress" && (
                <button className="lamp-action" onClick={() => onAdvance(task)}>
                  Mark done
                </button>
              )}
              {details.length > 0 && (
                <div className="stage-data" style={{ marginTop: 0, gap: 8, flexDirection: "column" }}>
                  {details.map(([k, v]) => (
                    <span key={k}>
                      {k}: <b>{String(v)}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {i < STAGES.length - 1 && (
              <div className="connector">
                {pulseStage === stage && <div className="pulse" key={Date.now()} />}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export async function completeTask(task: Task) {
  const supabase = createClient();
  return supabase.rpc("complete_stage_task", { p_task: task.id });
}

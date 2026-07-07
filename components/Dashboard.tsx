"use client";
import { useEffect, useState, useCallback } from "react";
import RundownRow from "@/components/RundownRow";
import { fetchRundown, type Project } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      {now.toLocaleTimeString("en-GB")}
      <span className="date">
        {now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
      </span>
    </div>
  );
}

function NewSegmentForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [budget, setBudget] = useState("");
  const supabase = createClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await supabase.rpc("create_project", {
      p_title: title,
      p_client: client || null,
      p_budget: Number(budget) || 0,
    });
    setTitle("");
    setClient("");
    setBudget("");
    setOpen(false);
    onCreated();
  };

  if (!open) {
    return (
      <button className="log-toggle" onClick={() => setOpen(true)}>
        + Log new segment
      </button>
    );
  }

  return (
    <form className="segment-slip" onSubmit={submit}>
      <input name="title" placeholder="Segment title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <input name="client" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
      <input name="budget" type="number" placeholder="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
      <button className="btn btn-primary" type="submit">Submit</button>
      <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

export default function Dashboard({ role }: { role: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    try {
      setProjects(await fetchRundown());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    // ponytail: polling stays until Phase 2 Realtime
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const signOut = async () => {
    await supabase.auth.signOut();
    location.href = "/login";
  };

  return (
    <div className="app">
      <div className="masthead">
        <div className="masthead-id">
          <div className="colorbars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div>
            <h1>Master Control</h1>
            <div className="subline">BROADCAST PRODUCTION RUNDOWN</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Clock />
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {role !== "crew" && <NewSegmentForm onCreated={load} />}
      {error && <p className="error">SIGNAL LOST — {error}</p>}

      <div className="rundown-head">
        <span /><span>SEG</span><span>TITLE</span><span>STATUS</span><span>BURN</span><span>DEADLINE</span>
      </div>

      {projects.length === 0 && !error && (
        <div className="empty-state">No segments in the rundown. Log one to begin.</div>
      )}

      <div className="rundown">
        {projects.map((p, i) => (
          <RundownRow key={p.id} project={p} index={i} onAction={load} />
        ))}
      </div>
    </div>
  );
}

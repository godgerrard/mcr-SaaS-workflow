"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import RundownRow from "@/components/RundownRow";
import { fetchRundown, applyChange, type Project } from "@/lib/data";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  const wasErrored = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await fetchRundown());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let orgId: string | null = null;

    (async () => {
      load();
      const { data: membership } = await supabase
        .from("org_members").select("org_id").limit(1).maybeSingle();
      if (cancelled) return;
      orgId = membership?.org_id ?? null;

      const filter = orgId ? { filter: `org_id=eq.${orgId}` } : {};
      const channel = supabase
        .channel("dashboard-rundown")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "projects", ...filter },
          (payload) => setProjects((prev) => applyChange(prev, payload))
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "stage_tasks", ...filter },
          (payload) => setProjects((prev) => applyChange(prev, payload))
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "budget_entries", ...filter },
          (payload) => setProjects((prev) => applyChange(prev, payload))
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && wasErrored.current) {
            wasErrored.current = false;
            load(); // reconnect refetch
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            wasErrored.current = true;
          }
        });

      if (cancelled) {
        supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

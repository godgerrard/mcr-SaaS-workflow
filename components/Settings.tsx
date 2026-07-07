"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/stages";
import type { Invite, Profile } from "@/lib/data";

type Member = { user_id: string; role: string; stage: string | null };

function MemberRow({
  member,
  profile,
  canManage,
  onChanged,
  onError,
}: {
  member: Member;
  profile: Profile | undefined;
  canManage: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [pendingCrew, setPendingCrew] = useState(false);
  const supabase = createClient();
  const name = profile?.display_name || profile?.email || member.user_id.slice(0, 8);

  const setRole = async (role: string) => {
    if (role === "crew" && member.role !== "crew") {
      setPendingCrew(true); // crew needs a stage; wait for the stage pick
      return;
    }
    const { error } = await supabase.rpc("update_member_role", {
      p_user: member.user_id, p_role: role,
    });
    if (error) onError(error.message);
    else onChanged();
  };

  const setStage = async (stage: string) => {
    const { error } = await supabase.rpc("update_member_role", {
      p_user: member.user_id, p_role: "crew", p_stage: stage,
    });
    if (error) onError(error.message);
    else {
      setPendingCrew(false);
      onChanged();
    }
  };

  const remove = async () => {
    const { error } = await supabase.rpc("remove_member", { p_user: member.user_id });
    if (error) onError(error.message);
    else onChanged();
  };

  return (
    <div className="row-main" style={{ gridTemplateColumns: "1.6fr 140px 140px 96px", cursor: "default" }}>
      <span>{name}</span>
      <span>
        {canManage ? (
          <select value={pendingCrew ? "crew" : member.role} onChange={(e) => setRole(e.target.value)}>
            <option value="ceo">ceo</option>
            <option value="producer">producer</option>
            <option value="crew">crew</option>
          </select>
        ) : (
          member.role
        )}
      </span>
      <span>
        {canManage && (pendingCrew || member.role === "crew") ? (
          <select value={pendingCrew ? "" : member.stage ?? ""} onChange={(e) => setStage(e.target.value)}>
            {pendingCrew && <option value="">pick a stage…</option>}
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        ) : (
          member.stage ? STAGE_LABEL[member.stage as Stage] ?? member.stage : "—"
        )}
      </span>
      {canManage && (
        <button className="btn btn-danger" onClick={remove}>Remove</button>
      )}
    </div>
  );
}

function InviteForm({ onDone }: { onDone: (msg: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("crew");
  const [stage, setStage] = useState<string>("camera");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role, stage: role === "crew" ? stage : undefined }),
    });
    const body = await res.json();
    if (!res.ok) onDone(body.error ?? "invite failed");
    else {
      setEmail("");
      onDone(body.emailSent ? "Invite sent." : body.message ?? "Invite created.");
    }
  };

  return (
    <form className="segment-slip" onSubmit={submit}>
      <input type="email" required placeholder="colleague@station.tv"
        value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2 }} />
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="ceo">ceo</option>
        <option value="producer">producer</option>
        <option value="crew">crew</option>
      </select>
      {role === "crew" && (
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_LABEL[s]}</option>
          ))}
        </select>
      )}
      <button className="btn btn-primary" type="submit">Send invite</button>
    </form>
  );
}

export default function Settings({ role }: { role: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [invites, setInvites] = useState<Invite[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const supabase = createClient();
  const canManage = role === "ceo" || role === "producer";

  const load = useCallback(async () => {
    const [{ data: mems }, { data: profs }, { data: invs }] = await Promise.all([
      supabase.from("org_members").select("user_id, role, stage"),
      supabase.from("profiles").select("user_id, display_name, email"),
      supabase.from("invites").select("*").is("claimed_at", null),
    ]);
    setMembers((mems as Member[]) ?? []);
    setProfiles(Object.fromEntries(((profs as Profile[]) ?? []).map((p) => [p.user_id, p])));
    setInvites((invs as Invite[]) ?? []); // crew get no rows under RLS
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  const revoke = async (id: string) => {
    const { error } = await supabase.from("invites").delete().eq("id", id);
    if (error) setMessage(error.message);
    else load();
  };

  return (
    <div className="app">
      <div className="masthead">
        <div className="masthead-id">
          <div className="colorbars">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div>
            <h1>Settings</h1>
            <div className="subline">ORGANIZATION &amp; CREW</div>
          </div>
        </div>
        <Link href="/" className="btn">Back to rundown</Link>
      </div>

      {message && <p className="error">{message}</p>}

      <h2>Members</h2>
      <div className="rundown">
        {members.map((m) => (
          <MemberRow key={m.user_id} member={m} profile={profiles[m.user_id]}
            canManage={canManage} onChanged={load} onError={setMessage} />
        ))}
        {members.length === 0 && <div className="empty-state">Loading members…</div>}
      </div>

      {canManage && (
        <>
          <h2>Pending invites</h2>
          <div className="rundown">
            {invites.map((inv) => (
              <div key={inv.id} className="row-main"
                style={{ gridTemplateColumns: "1.6fr 140px 140px 96px", cursor: "default" }}>
                <span>{inv.email}</span>
                <span>{inv.role}</span>
                <span>{inv.stage ? STAGE_LABEL[inv.stage as Stage] ?? inv.stage : "—"}</span>
                <button className="btn" onClick={() => revoke(inv.id)}>Revoke</button>
              </div>
            ))}
            {invites.length === 0 && <div className="empty-state">No pending invites.</div>}
          </div>
          <InviteForm onDone={(msg) => { setMessage(msg); load(); }} />
        </>
      )}
    </div>
  );
}

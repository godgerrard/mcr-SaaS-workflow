"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STAGE_LABEL, type Stage } from "@/lib/stages";

type PendingInvite = { org_id: string; org_name: string; role: string; stage: Stage | null };

export default function Onboarding() {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.rpc("my_pending_invite").then(({ data }) => {
      setInvites(data ?? []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = async (orgId: string) => {
    const { error } = await supabase.rpc("claim_invite", {
      p_display_name: displayName || null,
      p_org: orgId,
    });
    if (error) setError(error.message);
    else router.push("/");
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc("create_org", {
      p_name: orgName, p_display_name: displayName || null,
    });
    if (error) setError(error.message);
    else router.push("/");
  };

  if (loading) return <main className="auth-page" />;

  if (invites.length > 0) {
    return (
      <main className="auth-page">
        <h1>You&apos;ve been invited</h1>
        <input required placeholder="Your display name"
          value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {invites.map((invite) => (
          <p key={invite.org_id}>
            Join {invite.org_name} as {invite.role}
            {invite.stage ? ` (${STAGE_LABEL[invite.stage]})` : ""}{" "}
            <button type="button" className="btn btn-primary" onClick={() => join(invite.org_id)}>
              Join
            </button>
          </p>
        ))}
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="auth-page">
      <h1>Create your organization</h1>
      <form onSubmit={create}>
        <input required placeholder="Your display name"
          value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input required placeholder="Organization name"
          value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        <button type="submit" className="btn btn-primary">Create org</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p>Joining an existing org? Ask your CEO for an invite.</p>
    </main>
  );
}

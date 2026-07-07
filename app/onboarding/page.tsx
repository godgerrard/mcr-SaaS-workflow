"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STAGE_LABEL, type Stage } from "@/lib/stages";

type PendingInvite = { org_name: string; role: string; stage: Stage | null };

export default function Onboarding() {
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.rpc("my_pending_invite").then(({ data }) => {
      setInvite(data?.[0] ?? null);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc("claim_invite", {
      p_display_name: displayName || null,
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

  if (invite) {
    return (
      <main className="auth-page">
        <h1>Join {invite.org_name}</h1>
        <p>
          You&apos;ve been invited to join {invite.org_name} as {invite.role}
          {invite.stage ? ` (${STAGE_LABEL[invite.stage]})` : ""}
        </p>
        <form onSubmit={join}>
          <input required placeholder="Your display name"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <button type="submit" className="btn btn-primary">Join</button>
          {error && <p className="error">{error}</p>}
        </form>
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

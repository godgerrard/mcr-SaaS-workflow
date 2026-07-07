"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Onboarding() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc("create_org", { p_name: name });
    if (error) setError(error.message);
    else router.push("/");
  };

  return (
    <main className="auth-page">
      <h1>Create your organization</h1>
      <form onSubmit={submit}>
        <input required placeholder="Organization name"
          value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary">Create org</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p>Joining an existing org? Ask your CEO for an invite (coming in a later phase).</p>
    </main>
  );
}

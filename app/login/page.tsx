"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
    else setSent(true);
  };

  const google = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });

  return (
    <main className="auth-page">
      <h1>MASTER CONTROL</h1>
      {sent ? (
        <p>Check your email for the sign-in link.</p>
      ) : (
        <form onSubmit={magicLink}>
          <input type="email" required placeholder="you@station.tv"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn btn-primary">Send magic link</button>
          <button type="button" className="btn" onClick={google}>Sign in with Google</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </main>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { email, role, stage } = await request.json();
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: membership } = await supabase
    .from("org_members").select("org_id").limit(1).maybeSingle();
  if (!membership) return NextResponse.json({ error: "no organization" }, { status: 403 });

  // RLS is the authz layer: a rejected insert means the caller may not invite this role.
  const { error } = await supabase.from("invites").insert({
    org_id: membership.org_id, email, role,
    stage: role === "crew" ? stage : null, invited_by: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  // Invite row exists; the email is best-effort (server-only admin client).
  // In production the service key is deliberately NOT deployed: the invitee
  // signs in at the app themselves and the invite is claimed at onboarding.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({
      ok: true, emailSent: false,
      message: "invite created — ask them to sign in at the app to claim it",
    });
  }
  const { origin } = new URL(request.url);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback`,
  });
  if (mailErr) {
    const message = mailErr.message.toLowerCase().includes("already")
      ? "user already registered — they can sign in and claim the invite"
      : mailErr.message;
    return NextResponse.json({ ok: true, emailSent: false, message });
  }
  return NextResponse.json({ ok: true, emailSent: true });
}

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("org_members").select("org_id, role").limit(1).maybeSingle();
  if (!membership) redirect("/onboarding");
  return <Dashboard role={membership.role} />;
}

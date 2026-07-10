import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import Settings from "@/components/Settings";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase
    .from("org_members").select("org_id, role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) redirect("/onboarding");
  return <Settings role={membership.role} />;
}

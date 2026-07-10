import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import ProjectDetail from "@/components/ProjectDetail";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("org_members").select("org_id, role, stage").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) redirect("/onboarding");

  const { data: project } = await supabase
    .from("projects")
    .select("*, stage_tasks(*), budget_entries(*), approvals(*)")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  return <ProjectDetail project={project} role={membership.role} myStage={membership.stage} />;
}

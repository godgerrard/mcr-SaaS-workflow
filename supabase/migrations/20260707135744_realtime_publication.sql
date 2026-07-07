-- Phase 2: enable Supabase Realtime on the three tables the dashboard renders.
-- RLS already governs which change events each subscriber receives.
-- REPLICA IDENTITY FULL so RLS is evaluated against the full row on UPDATE/DELETE
-- (default identity only carries the PK, which would let UPDATE/DELETE events leak).
alter table projects replica identity full;
alter table stage_tasks replica identity full;
alter table budget_entries replica identity full;

alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table stage_tasks;
alter publication supabase_realtime add table budget_entries;

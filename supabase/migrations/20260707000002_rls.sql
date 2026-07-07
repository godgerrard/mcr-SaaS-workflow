create schema if not exists app;

-- security definer so policies on org_members don't recurse
create or replace function app.my_role(p_org uuid) returns org_role
language sql stable security definer set search_path = public as $$
  select role from org_members where user_id = auth.uid() and org_id = p_org
$$;

create or replace function app.my_stage(p_org uuid) returns stage
language sql stable security definer set search_path = public as $$
  select stage from org_members where user_id = auth.uid() and org_id = p_org
$$;

alter table orgs enable row level security;
alter table org_members enable row level security;
alter table projects enable row level security;
alter table approvals enable row level security;
alter table stage_tasks enable row level security;
alter table budget_entries enable row level security;

-- orgs: members can read their own org. No direct insert/update/delete (create_org RPC only).
create policy orgs_select on orgs for select
  using (app.my_role(id) is not null);

-- org_members: members can see the member list of their own orgs.
create policy members_select on org_members for select
  using (app.my_role(org_id) is not null);

-- projects: all members read; ceo/producer insert/update.
create policy projects_select on projects for select
  using (app.my_role(org_id) is not null);
create policy projects_insert on projects for insert
  with check (app.my_role(org_id) in ('ceo','producer'));
create policy projects_update on projects for update
  using (app.my_role(org_id) in ('ceo','producer'));

-- approvals: ceo/producer read; ceo insert (via RPC).
create policy approvals_select on approvals for select
  using (app.my_role(org_id) in ('ceo','producer'));
create policy approvals_insert on approvals for insert
  with check (app.my_role(org_id) = 'ceo');

-- stage_tasks: ceo/producer all rows; crew only their stage. ceo inserts (via approve RPC).
create policy tasks_select on stage_tasks for select
  using (
    app.my_role(org_id) in ('ceo','producer')
    or (app.my_role(org_id) = 'crew' and stage = app.my_stage(org_id))
  );
create policy tasks_insert on stage_tasks for insert
  with check (app.my_role(org_id) = 'ceo');
create policy tasks_update on stage_tasks for update
  using (
    app.my_role(org_id) in ('ceo','producer')
    or (app.my_role(org_id) = 'crew' and stage = app.my_stage(org_id))
  );

-- budget_entries: ceo/producer only (crew has zero visibility).
create policy budget_select on budget_entries for select
  using (app.my_role(org_id) in ('ceo','producer'));
create policy budget_insert on budget_entries for insert
  with check (app.my_role(org_id) in ('ceo','producer'));

-- Guard: status/current_stage changes only inside RPC functions.
create or replace function app.guard_status_writes() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.in_rpc', true), '') <> '1' then
    if tg_table_name = 'projects'
       and (new.status is distinct from old.status
            or new.current_stage is distinct from old.current_stage) then
      raise exception 'status transitions only via RPC functions';
    end if;
    if tg_table_name = 'stage_tasks'
       and new.status is distinct from old.status then
      raise exception 'status transitions only via RPC functions';
    end if;
  end if;
  return new;
end $$;

create trigger guard_project_status before update on projects
  for each row execute function app.guard_status_writes();
create trigger guard_task_status before update on stage_tasks
  for each row execute function app.guard_status_writes();

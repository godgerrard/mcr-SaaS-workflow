-- create_org: the only way to create an org; definer so it can insert both rows.
create or replace function create_org(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into orgs (name) values (p_name) returning id into v_org;
  insert into org_members (user_id, org_id, role) values (auth.uid(), v_org, 'ceo');
  return v_org;
end $$;

-- caller's org (Phase 1: one org per user; invites arrive in Phase 4)
create or replace function app.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid() limit 1
$$;

create or replace function create_project(
  p_title text, p_client text default null,
  p_budget numeric default 0, p_deadline date default null
) returns uuid
language plpgsql security invoker as $$
declare v_org uuid := app.my_org(); v_id uuid;
begin
  if app.my_role(v_org) not in ('ceo','producer') then
    raise exception 'ceo or producer only';
  end if;
  insert into projects (org_id, title, client, budget_allocated, deadline)
  values (v_org, p_title, p_client, coalesce(p_budget, 0), p_deadline)
  returning id into v_id;
  return v_id;
end $$;

create or replace function approve_project(p_project uuid) returns void
language plpgsql security invoker as $$
declare v_org uuid;
begin
  select org_id into v_org from projects
    where id = p_project and status in ('proposed','on_hold');
  if v_org is null then raise exception 'project not found or not reviewable'; end if;
  if app.my_role(v_org) <> 'ceo' then raise exception 'ceo only'; end if;
  perform set_config('app.in_rpc', '1', true);
  insert into approvals (org_id, project_id, reviewer, decision)
    values (v_org, p_project, auth.uid(), 'approve');
  update projects set status = 'in_production', current_stage = 'camera'
    where id = p_project;
  insert into stage_tasks (org_id, project_id, stage, status)
    select v_org, p_project, s,
           case when s = 'camera' then 'in_progress' else 'pending' end::task_status
    from unnest(enum_range(null::stage)) s;
end $$;

create or replace function reject_project(p_project uuid, p_notes text default null) returns void
language plpgsql security invoker as $$
declare v_org uuid;
begin
  select org_id into v_org from projects
    where id = p_project and status in ('proposed','on_hold');
  if v_org is null then raise exception 'project not found or not reviewable'; end if;
  if app.my_role(v_org) <> 'ceo' then raise exception 'ceo only'; end if;
  perform set_config('app.in_rpc', '1', true);
  insert into approvals (org_id, project_id, reviewer, decision, notes)
    values (v_org, p_project, auth.uid(), 'reject', p_notes);
  update projects set status = 'rejected' where id = p_project;
end $$;

create or replace function hold_project(p_project uuid, p_notes text default null) returns void
language plpgsql security invoker as $$
declare v_org uuid;
begin
  select org_id into v_org from projects where id = p_project and status = 'proposed';
  if v_org is null then raise exception 'project not found or not proposed'; end if;
  if app.my_role(v_org) <> 'ceo' then raise exception 'ceo only'; end if;
  perform set_config('app.in_rpc', '1', true);
  insert into approvals (org_id, project_id, reviewer, decision, notes)
    values (v_org, p_project, auth.uid(), 'hold', p_notes);
  update projects set status = 'on_hold' where id = p_project;
end $$;

-- security definer version (per plan: use this one, not the invoker draft).
create or replace function complete_stage_task(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v stage_tasks%rowtype; v_next stage; v_role org_role;
begin
  select * into v from stage_tasks where id = p_task;
  if v.id is null then raise exception 'task not found'; end if;
  v_role := app.my_role(v.org_id);
  if v_role is null then raise exception 'task not found'; end if; -- not a member: same error, no info leak
  if v_role = 'crew' and v.stage is distinct from app.my_stage(v.org_id) then
    raise exception 'crew can only complete their own stage';
  end if;
  if v.status <> 'in_progress' then raise exception 'task is not in progress'; end if;
  select s into v_next
    from unnest(enum_range(v.stage, null)) with ordinality t(s, i) where i = 2;
  perform set_config('app.in_rpc', '1', true);
  update stage_tasks set status = 'done', updated_at = now() where id = p_task;
  if v_next is null then
    update projects set status = 'complete', current_stage = null where id = v.project_id;
  else
    update stage_tasks set status = 'in_progress', updated_at = now()
      where project_id = v.project_id and stage = v_next;
    update projects set current_stage = v_next where id = v.project_id;
  end if;
end $$;

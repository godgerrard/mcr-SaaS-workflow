-- Phase 4: accounts & roles — profiles, invites, member-management RPCs

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role org_role not null,
  stage stage, -- required iff role = 'crew'
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check ((role = 'crew') = (stage is not null))
);
create unique index invites_one_pending_per_email on invites (lower(email)) where claimed_at is null;
create index on invites (org_id);

alter table profiles enable row level security;
alter table invites enable row level security;

-- helper: does p_user share an org with the caller? (definer: avoids RLS recursion on org_members)
create or replace function app.same_org(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members a join org_members b using (org_id)
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;
grant execute on function app.same_org(uuid) to authenticated, anon;

-- profiles: own row + fellow org members readable; own row writable.
create policy profiles_select on profiles for select
  using (user_id = auth.uid() or app.same_org(user_id));
create policy profiles_insert on profiles for insert
  with check (user_id = auth.uid());
create policy profiles_update on profiles for update
  using (user_id = auth.uid());

-- invites: ceo/producer of the org manage them; producer cannot create CEO invites.
create policy invites_select on invites for select
  using (app.my_role(org_id) in ('ceo','producer'));
create policy invites_insert on invites for insert
  with check (
    invited_by = auth.uid()
    and (app.my_role(org_id) = 'ceo'
         or (app.my_role(org_id) = 'producer' and role <> 'ceo'))
  );
create policy invites_delete on invites for delete
  using (app.my_role(org_id) in ('ceo','producer') and claimed_at is null);

-- create_org gains a display-name param; single org per user now enforced.
-- (drop old signature: PostgREST can't disambiguate overloads)
drop function if exists create_org(text);
create function create_org(p_name text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'already in an organization';
  end if;
  insert into orgs (name) values (p_name) returning id into v_org;
  insert into org_members (user_id, org_id, role) values (auth.uid(), v_org, 'ceo');
  if p_display_name is not null then
    insert into profiles (user_id, display_name, email)
    values (auth.uid(), p_display_name, coalesce(auth.email(), ''))
    on conflict (user_id) do update set display_name = excluded.display_name;
  end if;
  return v_org;
end $$;

-- addressee's view of their own pending invite (definer: invitee can't read invites/orgs)
create function my_pending_invite()
returns table (org_name text, role org_role, stage stage)
language sql stable security definer set search_path = public as $$
  select o.name, i.role, i.stage
  from invites i join orgs o on o.id = i.org_id
  where lower(i.email) = lower(auth.email()) and i.claimed_at is null
$$;

create function claim_invite(p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'already in an organization';
  end if;
  select * into v from invites
    where lower(email) = lower(auth.email()) and claimed_at is null;
  if v.id is null then raise exception 'no pending invite for this email'; end if;
  insert into org_members (user_id, org_id, role, stage)
    values (auth.uid(), v.org_id, v.role, v.stage);
  insert into profiles (user_id, display_name, email)
    values (auth.uid(), coalesce(p_display_name, split_part(auth.email(), '@', 1)), auth.email())
    on conflict (user_id) do update set display_name = excluded.display_name;
  update invites set claimed_at = now() where id = v.id;
  return v.org_id;
end $$;

create function update_member_role(p_user uuid, p_role org_role, p_stage stage default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.my_org(); v_caller org_role; v_target org_role;
begin
  v_caller := app.my_role(v_org);
  if v_caller not in ('ceo','producer') then raise exception 'ceo or producer only'; end if;
  select role into v_target from org_members where user_id = p_user and org_id = v_org;
  if v_target is null then raise exception 'not a member of your org'; end if;
  if v_caller = 'producer' and (v_target = 'ceo' or p_role = 'ceo') then
    raise exception 'producers cannot manage CEO roles';
  end if;
  if v_target = 'ceo' and p_role <> 'ceo'
     and (select count(*) from org_members where org_id = v_org and role = 'ceo') = 1 then
    raise exception 'cannot demote the last CEO';
  end if;
  if p_role = 'crew' and p_stage is null then raise exception 'crew members need a stage'; end if;
  update org_members
    set role = p_role, stage = case when p_role = 'crew' then p_stage else null end
    where user_id = p_user and org_id = v_org;
end $$;

create function remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.my_org(); v_caller org_role; v_target org_role;
begin
  v_caller := app.my_role(v_org);
  if v_caller not in ('ceo','producer') then raise exception 'ceo or producer only'; end if;
  select role into v_target from org_members where user_id = p_user and org_id = v_org;
  if v_target is null then raise exception 'not a member of your org'; end if;
  if v_caller = 'producer' and v_target = 'ceo' then
    raise exception 'producers cannot remove a CEO';
  end if;
  if v_target = 'ceo'
     and (select count(*) from org_members where org_id = v_org and role = 'ceo') = 1 then
    raise exception 'cannot remove the last CEO';
  end if;
  delete from org_members where user_id = p_user and org_id = v_org;
end $$;

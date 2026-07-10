-- Phase 7: invite uniqueness scoped per org + deterministic multi-invite claim.
-- Before: one pending invite per email GLOBALLY — any org could squat a victim's
-- email and block/misdirect their real invite. Now: one pending invite per (email, org).

drop index invites_one_pending_per_email;
create unique index invites_one_pending_per_email_org
  on invites (lower(email), org_id) where claimed_at is null;

-- my_pending_invite now returns org_id (and all pending invites, oldest first)
-- so the UI can show every invite and claim a specific one.
drop function my_pending_invite();
create function my_pending_invite()
returns table (org_id uuid, org_name text, role org_role, stage stage)
language sql stable security definer set search_path = public as $$
  select i.org_id, o.name, i.role, i.stage
  from invites i join orgs o on o.id = i.org_id
  where lower(i.email) = lower(auth.email()) and i.claimed_at is null
  order by i.created_at
$$;

-- claim_invite takes an optional org: null keeps old behavior but deterministic
-- (oldest invite wins) instead of an arbitrary row.
drop function claim_invite(text);
create function claim_invite(p_display_name text default null, p_org uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from org_members where user_id = auth.uid()) then
    raise exception 'already in an organization';
  end if;
  select * into v from invites
    where lower(email) = lower(auth.email()) and claimed_at is null
      and (p_org is null or org_id = p_org)
    order by created_at limit 1;
  if v.id is null then raise exception 'no pending invite for this email'; end if;
  insert into org_members (user_id, org_id, role, stage)
    values (auth.uid(), v.org_id, v.role, v.stage);
  insert into profiles (user_id, display_name, email)
    values (auth.uid(), coalesce(p_display_name, split_part(auth.email(), '@', 1)), auth.email())
    on conflict (user_id) do update set display_name = excluded.display_name;
  update invites set claimed_at = now() where id = v.id;
  return v.org_id;
end $$;

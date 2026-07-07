create type org_role as enum ('ceo','producer','crew');
create type stage as enum ('camera','edit','graphics','sound','final_qc');
create type project_status as enum ('proposed','in_production','on_hold','rejected','complete');
create type task_status as enum ('pending','in_progress','done');

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table org_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  role org_role not null,
  stage stage, -- crew only; null crew sees no stage tasks
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  client text,
  budget_allocated numeric not null default 0,
  deadline date,
  status project_status not null default 'proposed',
  current_stage stage,
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  reviewer uuid not null references auth.users(id),
  decision text not null check (decision in ('approve','reject','hold')),
  notes text,
  created_at timestamptz not null default now()
);

create table stage_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  stage stage not null,
  status task_status not null default 'pending',
  assignee uuid references auth.users(id),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (project_id, stage)
);

create table budget_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  category text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create index on projects (org_id);
create index on stage_tasks (org_id, project_id);
create index on approvals (org_id, project_id);
create index on budget_entries (org_id, project_id);

-- Lead Hub database. Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 4000),
  priority text not null default '',
  category text not null default '',
  phone text not null default '',
  phone_type text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  instagram text not null default '',
  website text not null default '',
  status text not null default 'Not contacted',
  last_contacted date,
  reply_time text not null default '',
  notes text not null default '',
  address text not null default '',
  maps_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Added later: the WhatsApp message template of each project.
alter table public.projects add column if not exists message_template text not null default '';
-- Added later: the JemaiStudio mockup link of each lead (Mockup button).
alter table public.leads add column if not exists mockup_url text not null default '';

create index if not exists leads_project_idx on public.leads (project_id);
create index if not exists leads_user_idx on public.leads (user_id);
create index if not exists projects_user_idx on public.projects (user_id);

-- Row-level security: each signed-in user can only see and change their own rows.
-- This is what makes it safe for the app to carry the public "anon" key.
alter table public.projects enable row level security;
alter table public.leads enable row level security;

drop policy if exists "projects are private to their owner" on public.projects;
create policy "projects are private to their owner" on public.projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "leads are private to their owner" on public.leads;
create policy "leads are private to their owner" on public.leads
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

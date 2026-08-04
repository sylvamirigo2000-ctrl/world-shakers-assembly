-- ============================================================
-- Senior Pastor / Pastor phase — new Supabase tables
-- Run this once in the Supabase SQL editor before using
-- senior-pastor.html and pastor.html.
--
-- Existing tables reused (no changes needed):
--   members, events, announcements, audit_log,
--   leadership_requests (department = 'Pastoral Ministry'),
--   prayer_requests
-- ============================================================

-- Duties the Senior Pastor assigns to individual pastors
create table if not exists pastoral_assignments (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references members(id) on delete cascade,
  assigned_by uuid references members(id),
  title text not null,
  description text,
  due_date date,
  status text not null default 'assigned', -- assigned | confirmed | completed | declined
  created_at timestamptz not null default now()
);

-- Pastor's Daily Spiritual Tracker: prayer, Bible reading, book reading, evangelism
create table if not exists pastor_daily_logs (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references members(id) on delete cascade,
  log_date date not null,
  morning_prayer boolean default false,
  evening_prayer boolean default false,
  prayer_hours numeric default 0,
  bible_book text,
  bible_chapter text,
  bible_completed boolean default false,
  book_name text,
  book_pages integer default 0,
  book_progress integer default 0, -- percent, 0-100
  visited integer default 0,
  souls_won integer default 0,
  follow_ups integer default 0,
  notes text,
  created_at timestamptz not null default now()
);

-- Church visit log (hospital visits, home fellowship, counseling, etc.)
create table if not exists pastor_church_visits (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references members(id) on delete cascade,
  visit_date date not null,
  visited_name text not null,
  purpose text,
  notes text,
  created_at timestamptz not null default now()
);

-- Pastoral ministry reports submitted for Senior Pastor approval
create table if not exists pastoral_reports (
  id uuid primary key default gen_random_uuid(),
  pastor_id uuid references members(id) on delete cascade,
  period_type text not null, -- Daily | Weekly | Monthly | Yearly
  period_label text,
  summary text not null,
  status text not null default 'pending', -- pending | approved | rejected
  reviewed_by uuid references members(id),
  created_at timestamptz not null default now()
);

-- Bible Study topics posted by the Senior Pastor
create table if not exists bible_studies (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  scripture_reference text,
  notes text,
  posted_by uuid references members(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — mirrors the pattern used by the other
-- ministry tables already in this project (protocol_*, media_*,
-- song_*, etc.). Adjust to match your existing policy style if
-- it differs.
-- ============================================================
alter table pastoral_assignments enable row level security;
alter table pastor_daily_logs enable row level security;
alter table pastor_church_visits enable row level security;
alter table pastoral_reports enable row level security;
alter table bible_studies enable row level security;

-- Authenticated members can read; writes are checked in the app layer
-- via WSA / leadership_role the same way the rest of the panels do.
-- (Postgres has no "CREATE POLICY IF NOT EXISTS", so we drop first.)
drop policy if exists "pastoral_assignments_read" on pastoral_assignments;
create policy "pastoral_assignments_read" on pastoral_assignments for select using (auth.role() = 'authenticated');
drop policy if exists "pastoral_assignments_write" on pastoral_assignments;
create policy "pastoral_assignments_write" on pastoral_assignments for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "pastor_daily_logs_read" on pastor_daily_logs;
create policy "pastor_daily_logs_read" on pastor_daily_logs for select using (auth.role() = 'authenticated');
drop policy if exists "pastor_daily_logs_write" on pastor_daily_logs;
create policy "pastor_daily_logs_write" on pastor_daily_logs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "pastor_church_visits_read" on pastor_church_visits;
create policy "pastor_church_visits_read" on pastor_church_visits for select using (auth.role() = 'authenticated');
drop policy if exists "pastor_church_visits_write" on pastor_church_visits;
create policy "pastor_church_visits_write" on pastor_church_visits for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "pastoral_reports_read" on pastoral_reports;
create policy "pastoral_reports_read" on pastoral_reports for select using (auth.role() = 'authenticated');
drop policy if exists "pastoral_reports_write" on pastoral_reports;
create policy "pastoral_reports_write" on pastoral_reports for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "bible_studies_read" on bible_studies;
create policy "bible_studies_read" on bible_studies for select using (auth.role() = 'authenticated');
drop policy if exists "bible_studies_write" on bible_studies;
create policy "bible_studies_write" on bible_studies for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

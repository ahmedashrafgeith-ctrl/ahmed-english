-- ============================================================
-- Ahmed English - Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL > New query)
-- This enables account creation, student portal, and tutor dashboard.
-- ============================================================

-- CLEAR any older table versions missing the required columns.
-- Safe to run on a new project (these tables hold no real data yet).
drop table if exists public.homework cascade;
drop table if exists public.lesson_notes cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.profiles cascade;

-- 1) PROFILES - one row per auth user (student or tutor)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  role text check (role in ('student','tutor','admin')) default 'student',
  english_level text default 'Intermediate',
  learning_goal text default 'Improve spoken English confidence and fluency',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Users can read/update their own profile
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Tutor can view all student profiles (for the dashboard)
drop policy if exists "Tutor can view all profiles" on public.profiles;
create policy "Tutor can view all profiles"
  on public.profiles for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('tutor','admin'))
  );

-- 2) SUBSCRIPTIONS / PACKAGES
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade,
  package_name text,
  lessons_total int default 0,
  lessons_used int default 0,
  status text default 'active',
  created_at timestamptz default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "Users can view own subscription" on public.subscriptions;
create policy "Users can view own subscription"
  on public.subscriptions for select using (auth.uid() = student_id);
drop policy if exists "Tutor can view all subscriptions" on public.subscriptions;
create policy "Tutor can view all subscriptions"
  on public.subscriptions for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('tutor','admin'))
  );

-- 3) LESSON NOTES
create table if not exists public.lesson_notes (
  id uuid default gen_random_uuid() primary key,
  tutor_id uuid references public.profiles(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  title text,
  content text,
  created_at timestamptz default now()
);

alter table public.lesson_notes enable row level security;

drop policy if exists "Students can view own notes" on public.lesson_notes;
create policy "Students can view own notes"
  on public.lesson_notes for select using (auth.uid() = student_id);
drop policy if exists "Tutor can manage notes" on public.lesson_notes;
create policy "Tutor can manage notes"
  on public.lesson_notes for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('tutor','admin'))
  );

-- 4) HOMEWORK
create table if not exists public.homework (
  id uuid default gen_random_uuid() primary key,
  tutor_id uuid references public.profiles(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  title text,
  description text,
  due_date date,
  completed boolean default false,
  created_at timestamptz default now()
);

alter table public.homework enable row level security;

drop policy if exists "Students can view own homework" on public.homework;
create policy "Students can view own homework"
  on public.homework for select using (auth.uid() = student_id);
drop policy if exists "Tutor can manage homework" on public.homework;
create policy "Tutor can manage homework"
  on public.homework for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('tutor','admin'))
  );

-- Optional: create a demo tutor account reference (login normally)
-- Sign up in the app with Role = "Tutor" to create the tutor profile.


-- ============================================================
-- 4b) SITE SETTINGS (admin-controlled enrollment status)
-- Public reads a single row; only staff/admin can write it.
-- ============================================================
create table if not exists public.site_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.site_settings enable row level security;

-- Everyone (anon + logged in) can read settings so the public badge works
drop policy if exists "Anyone can read site settings" on public.site_settings;
create policy "Anyone can read site settings"
  on public.site_settings for select using (true);

-- Only admin can change settings
drop policy if exists "Admin can manage site settings" on public.site_settings;
create policy "Admin can manage site settings"
  on public.site_settings for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Default: accepting new students
insert into public.site_settings (key, value) values ('enrollment_status', 'open')
on conflict (key) do nothing;


-- ============================================================
-- 5) SET UP THE ADMIN ACCOUNT
-- Step 1: create the user in Dashboard > Authentication > Users > Add user
--   (email: ahmedashrafgeith@gmail.com, password: Ash123456@1, auto-confirm)
-- Step 2: run this block to set that user's profile role to ADMIN.
-- ============================================================

do $$
declare
  admin_id uuid;
begin
  select id into admin_id from auth.users where email = 'ahmedashrafgeith@gmail.com';
  if admin_id is null then
    raise exception 'Create the admin user first via Authentication > Users > Add user, then rerun this block.';
  end if;

  insert into public.profiles (id, email, full_name, role, english_level, learning_goal)
  values (admin_id, 'ahmedashrafgeith@gmail.com', 'Ahmed', 'admin', 'Native', 'Run the business and coach every student')
  on conflict (id) do update
    set role = 'admin', email = 'ahmedashrafgeith@gmail.com', full_name = 'Ahmed';
end $$;

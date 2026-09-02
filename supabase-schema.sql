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

-- Security-definer helper: checks the caller's role WITHOUT querying
-- public.profiles again (that sub-query was causing RLS infinite
-- recursion, error 42P17, which broke every profile read with a 500).
create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('tutor','admin')
  );
$$;

-- Admin-only helper (used for write-protected settings)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

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

-- Tutor/admin can view all student profiles (for the dashboard).
-- Uses the security-definer helper so the policy sub-query does not
-- recursively re-check itself on public.profiles.
drop policy if exists "Tutor can view all profiles" on public.profiles;
create policy "Tutor can view all profiles"
  on public.profiles for select using (public.is_staff_or_admin());

-- Admin can update ANY profile (used to change a user's account type
-- between student / tutor / admin from the admin panel). Uses the
-- security-definer helper so it does not recurse.
drop policy if exists "Admin can manage all profiles" on public.profiles;
create policy "Admin can manage all profiles"
  on public.profiles for update using (public.is_admin())
  with check (public.is_admin());

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
    public.is_staff_or_admin()
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
    public.is_staff_or_admin()
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
    public.is_staff_or_admin()
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
  on public.site_settings for all using (public.is_admin())
  with check (public.is_admin());

-- Default: accepting new students
insert into public.site_settings (key, value) values ('enrollment_status', 'open')
on conflict (key) do nothing;


-- ============================================================
-- 4c) AUTO-CREATE PROFILE ON EVERY SIGNUP (trigger, always student)
-- Ensures a profiles row always exists so login routing works.
-- This is the SAFE, corrected version of the old on_auth_user_created
-- trigger (which was broken and caused 500 "Database error saving new user").
-- Every signup becomes a STUDENT; staff/admin roles are granted only by
-- the admin (section 4d / the admin panel), never from signup metadata.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_name  text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), '');
begin
  insert into public.profiles (id, email, full_name, role, english_level, learning_goal)
  values (
    new.id,
    new.email,
    case when meta_name = '' then split_part(coalesce(new.email, 'student'), '@', 1) else meta_name end,
    'student',
    'Intermediate',
    'Improve spoken English confidence and fluency'
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    return new;  -- never block signup
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 4d) PROMOTE THE OWNER ACCOUNT TO ADMIN (idempotent, safe to rerun)
-- Create the user in Dashboard > Authentication first, then run.
-- ============================================================
do $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = 'ahmedashrafgeith@gmail.com';
  if v_id is not null then
    insert into public.profiles (id, email, full_name, role, english_level, learning_goal)
    values (v_id, 'ahmedashrafgeith@gmail.com', 'Ahmed', 'admin', 'Native', 'Run the business and coach every student')
    on conflict (id) do update
      set role = 'admin', full_name = 'Ahmed', email = 'ahmedashrafgeith@gmail.com';
  end if;
end $$;


-- ============================================================
-- 5) SET UP THE ADMIN ACCOUNT (manual fallback)
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


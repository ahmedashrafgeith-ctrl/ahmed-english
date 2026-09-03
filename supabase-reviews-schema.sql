-- ============================================================
-- TutorEnglishPro - Reviews Schema (Preply-style)
-- Students submit a star rating + text review. Only reviews the
-- owner APPROVES become publicly visible site-wide.
-- Run in the Supabase SQL Editor (Dashboard > SQL > New query).
-- ============================================================

create table if not exists public.reviews (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete set null,
  student_name text not null,
  rating int not null check (rating between 1 and 5),
  review text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  verified boolean not null default false,
  created_at timestamptz default now()
);

alter table public.reviews enable row level security;

-- Anyone (visitors + logged in) can READ approved reviews so the
-- public section can show them without requiring a login.
drop policy if exists "Anyone can read approved reviews" on public.reviews;
create policy "Anyone can read approved reviews"
  on public.reviews for select using (status = 'approved');

-- A logged-in student can submit (insert) their own review.
-- It always starts as 'pending' until the owner approves it.
drop policy if exists "Students can submit own review" on public.reviews;
create policy "Students can submit own review"
  on public.reviews for insert with check (auth.uid() = student_id);

-- Students can read their own review submissions (so they can see
-- "under review" / status) - but only their own.
drop policy if exists "Students can read own review" on public.reviews;
create policy "Students can read own review"
  on public.reviews for select using (auth.uid() = student_id);

-- Staff/admin can read all reviews and approve / reject them.
drop policy if exists "Staff can manage reviews" on public.reviews;
create policy "Staff can manage reviews"
  on public.reviews for all using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

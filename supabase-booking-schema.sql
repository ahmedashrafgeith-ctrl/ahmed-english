-- ============================================================
-- Ahmed English - Internal Booking System Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL > New query)
--
-- REQUIRES the MAIN schema (supabase-schema.sql) to have been run
-- FIRST, because the `bookings` table references public.profiles(id).
-- If you try to run this before profiles exists you will get a
-- misleading "syntax error at or near ';'" — that means the main
-- schema hasn't been applied yet. Run supabase-schema.sql first.
--
-- This file adds the `bookings` table + the consume/credit lesson
-- functions. It is idempotent (safe to rerun).
-- ============================================================

-- 5) BOOKINGS - one row per on-site lesson booking (synced to Cal.com)
create table if not exists public.bookings (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade,
  event_slug text,          -- cal.com event type slug (30min-trial/30min/60min)
  cal_uid text,             -- cal.com booking uid
  title text,
  start_at timestamptz,     -- booking start (UTC)
  end_at timestamptz,       -- booking end (UTC)
  duration_min int,
  status text default 'booked',            -- booked / cancelled
  consumed_lesson boolean default false,   -- did this booking use up 1 lesson?
  created_at timestamptz default now()
);

alter table public.bookings enable row level security;

-- Students can view their own bookings
drop policy if exists "Students can view own bookings" on public.bookings;
create policy "Students can view own bookings"
  on public.bookings for select using (auth.uid() = student_id);

-- Staff/admin can view all bookings (dashboard + admin)
drop policy if exists "Staff can view all bookings" on public.bookings;
create policy "Staff can view all bookings"
  on public.bookings for select using (public.is_staff_or_admin());

-- Students can update their own bookings (used to cancel a booking)
drop policy if exists "Students can update own bookings" on public.bookings;
create policy "Students can update own bookings"
  on public.bookings for update using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- Staff/admin can manage ANY booking (cancel, reschedule, adjust)
drop policy if exists "Staff can manage bookings" on public.bookings;
create policy "Staff can manage bookings"
  on public.bookings for all using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());


-- ============================================================
-- 5b) AUTO-CONSUME A LESSON WHEN A STUDENT BOOKS
-- Called by the `book-lesson` Edge Function AFTER it creates the
-- real Cal.com booking. This is a SECURITY DEFINER helper so the
-- Edge Function (service role) can atomically decrement a lesson.
-- ============================================================
create or replace function public.consume_lesson(p_student uuid)
returns integer   -- returns remaining lessons after decrement, or -1 if none left
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_used  int;
  v_left  int;
begin
  select coalesce(lessons_total, 0), coalesce(lessons_used, 0)
    into v_total, v_used
    from public.subscriptions
   where student_id = p_student and status = 'active'
   limit 1;

  -- No active subscription -> cannot consume (but still allow booking;
  -- lesson just isn't tracked). We return -1 to signal "no plan".
  if v_total is null then
    return -1;
  end if;

  if v_used >= v_total then
    return -1;   -- out of lessons (booking still allowed, admin can top up)
  end if;

  update public.subscriptions
     set lessons_used = lessons_used + 1
   where student_id = p_student and status = 'active';

  return v_used + 1;
end;
$$;


-- ============================================================
-- 5c) REFUND/CREDIT A LESSON WHEN A BOOKING IS CANCELLED
-- Public helper that credits back one lesson (guarded, never below 0).
-- ============================================================
create or replace function public.credit_lesson(p_student uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
     set lessons_used = greatest(lessons_used - 1, 0)
   where student_id = p_student and status = 'active';
end;
$$;

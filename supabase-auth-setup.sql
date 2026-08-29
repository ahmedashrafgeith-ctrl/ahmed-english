-- ============================================================
-- Ahmed English — AUTH / ACCOUNT SETUP (run AFTER creating users)
-- ============================================================
-- WHAT THIS DOES:
--   1. Auto-creates a profiles row on EVERY signup, always as 'student'.
--   2. Promotes ahmedashrafgeith@gmail.com to ADMIN (the only staff/admin).
--
-- Run order:
--   A) In Supabase Dashboard > Authentication > Users > Add user,
--      create this ONE account first (email/password, auto-confirm on):
--         - ahmedashrafgeith@gmail.com  (your owner/admin account)
--   B) Then open Dashboard > SQL Editor > New query, paste THIS file, Run.
-- ============================================================

-- ------------------------------------------------
-- 1) AUTO-CREATE PROFILE ON EVERY SIGNUP (always student)
-- ------------------------------------------------
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


-- ------------------------------------------------
-- 1b) ALLOW ADMIN TO CHANGE ANY USER'S ACCOUNT TYPE
--     (student <-> tutor <-> admin) from the admin panel.
--     This works because it uses the SECURITY DEFINER is_admin()
--     helper, so it does not recurse. Run once.
-- ------------------------------------------------
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

drop policy if exists "Admin can manage all profiles" on public.profiles;
create policy "Admin can manage all profiles"
  on public.profiles for update using (public.is_admin())
  with check (public.is_admin());


-- ------------------------------------------------
-- 2) PROMOTE OWNER -> ADMIN  (edit the email here)
-- ------------------------------------------------
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
    raise notice 'Promoted ahmedashrafgeith@gmail.com to ADMIN.';
  else
    raise notice 'NOTE: ahmedashrafgeith@gmail.com not found yet. Create it in Dashboard > Authentication > Users, then rerun.';
  end if;
end $$;

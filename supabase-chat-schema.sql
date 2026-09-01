-- ============================================================
-- Ahmed English - Live Chat Schema
-- Run AFTER supabase-schema.sql (needs profiles + is_staff_or_admin()).
-- Adds `chats` and `chat_messages` for the student <-> admin inbox.
-- Idempotent (safe to rerun).
-- ============================================================

create table if not exists public.chats (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  subject text,                          -- auto: first message preview
  status text default 'open',            -- open / closed
  unread_student int default 0,          -- replies the student hasn't opened
  unread_admin int default 0,            -- replies the admin hasn't opened
  last_message_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender text not null check (sender in ('student','admin')),
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

-- --- CHATS ---
-- Students can view their own chats
drop policy if exists "Chats: student own select" on public.chats;
create policy "Chats: student own select"
  on public.chats for select using (student_id = auth.uid() or public.is_staff_or_admin());

-- Students can open a chat (implied by insert)
drop policy if exists "Chats: student own insert" on public.chats;
create policy "Chats: student own insert"
  on public.chats for insert with check (student_id = auth.uid() or public.is_staff_or_admin());

-- Students / staff can update (status, counters, subject)
drop policy if exists "Chats: update by owner or staff" on public.chats;
create policy "Chats: update by owner or staff"
  on public.chats for update using (student_id = auth.uid() or public.is_staff_or_admin())
  with check (student_id = auth.uid() or public.is_staff_or_admin());

-- Staff/admin can delete a chat
drop policy if exists "Chats: staff delete" on public.chats;
create policy "Chats: staff delete"
  on public.chats for delete using (public.is_staff_or_admin());

-- --- CHAT_MESSAGES ---
-- View: owner of the chat, or staff/admin
drop policy if exists "Messages: select owner or staff" on public.chat_messages;
create policy "Messages: select owner or staff"
  on public.chat_messages for select using (
    exists (select 1 from public.chats c
             where c.id = chat_id
               and (c.student_id = auth.uid() or public.is_staff_or_admin()))
  );

-- Insert: the student on their own chat (sender='student'), or staff/admin (any sender)
drop policy if exists "Messages: insert owner or staff" on public.chat_messages;
create policy "Messages: insert owner or staff"
  on public.chat_messages for insert with check (
    (exists (select 1 from public.chats c
              where c.id = chat_id
                and (c.student_id = auth.uid() or public.is_staff_or_admin())))
    and (sender = 'student' or public.is_staff_or_admin())
  );

-- Update (mark read): owner or staff/admin
drop policy if exists "Messages: update owner or staff" on public.chat_messages;
create policy "Messages: update owner or staff"
  on public.chat_messages for update using (
    exists (select 1 from public.chats c
             where c.id = chat_id
               and (c.student_id = auth.uid() or public.is_staff_or_admin()))
  );

-- Staff/admin can delete any message
drop policy if exists "Messages: staff delete" on public.chat_messages;
create policy "Messages: staff delete"
  on public.chat_messages for delete using (public.is_staff_or_admin());
-- ============================================================
-- 4e) APP SECRETS - admin-only storage for API keys and tokens
--     Pipeboard MCP token, Groq / OpenRouter free-LLM keys, etc.
--     NEVER put secrets in website files, GitHub, or localStorage.
--     Only role=admin can read/write these rows.
-- ============================================================

create table if not exists public.app_secrets (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.app_secrets enable row level security;

-- Only admins can read keys (anon and ordinary users get nothing)
drop policy if exists "Admin can read app secrets" on public.app_secrets;
create policy "Admin can read app secrets"
  on public.app_secrets for select using (public.is_admin());

drop policy if exists "Admin can insert app secrets" on public.app_secrets;
create policy "Admin can insert app secrets"
  on public.app_secrets for insert with check (public.is_admin());

drop policy if exists "Admin can update app secrets" on public.app_secrets;
create policy "Admin can update app secrets"
  on public.app_secrets for update using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admin can delete app secrets" on public.app_secrets;
create policy "Admin can delete app secrets"
  on public.app_secrets for delete using (public.is_admin());

-- ============================================================
-- How to seed the keys (run in the Supabase SQL editor, NOT here in the repo):
--
--   insert into public.app_secrets (key, value) values
--     ('pipeboard_token', 'put-your-real-pipeboard-token-here'),
--     ('google_pipeboard_token', 'put-your-real-pipeboard-token-here'),
--     ('groq_key', 'put-your-real-groq-key-here'),
--     ('openrouter_key', 'put-your-real-openrouter-key-here')
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- Or paste the token/keys in the Ads Hub AI panel on admin.html - the page
-- saves them here the same way, and never writes them to files or localStorage.
-- ============================================================
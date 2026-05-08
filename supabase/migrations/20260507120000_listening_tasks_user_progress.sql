-- 1-hafta (kun 1–7) listening vazifalari + foydalanuvchi progressi.
-- Supabase: Run migration yoki SQL Editor orqali qo'llang.

create table if not exists public.listening_tasks (
  id uuid primary key default gen_random_uuid(),
  week_number int not null default 1,
  day_number int not null check (day_number >= 1 and day_number <= 30),
  youtube_id text not null,
  title text,
  created_at timestamptz not null default now(),
  unique (week_number, day_number)
);

create table if not exists public.user_listening_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_number int not null default 1,
  day_number int not null check (day_number >= 1 and day_number <= 30),
  listening_task_id uuid references public.listening_tasks (id) on delete set null,
  summary_text text,
  score int check (score >= 0 and score <= 100),
  feedback_uz text,
  errors_json jsonb default '[]'::jsonb,
  completed_at timestamptz not null default now(),
  unique (user_id, week_number, day_number)
);

create index if not exists idx_user_listening_progress_user
  on public.user_listening_progress (user_id);

create index if not exists idx_listening_tasks_week_day
  on public.listening_tasks (week_number, day_number);

-- 1-hafta: ma'lumot (YouTube IDlarni keyinroq o'zingiz almashtirishingiz mumkin)
insert into public.listening_tasks (week_number, day_number, youtube_id, title)
values
  (1, 1, 'pXRviuL6vMY', 'Hafta 1 — Listening day 1'),
  (1, 2, 'nDLkFIZzuqo', 'Hafta 1 — Listening day 2'),
  (1, 3, 'eGFtMsMWifc', 'Hafta 1 — Listening day 3'),
  (1, 4, 'mVqBnYrFoBM', 'Hafta 1 — Listening day 4'),
  (1, 5, 'VQHwzEgqaEQ', 'Hafta 1 — Listening day 5'),
  (1, 6, 'pXRviuL6vMY', 'Hafta 1 — Listening day 6'),
  (1, 7, 'nDLkFIZzuqo', 'Hafta 1 — Listening day 7')
on conflict (week_number, day_number) do update
set
  youtube_id = excluded.youtube_id,
  title = excluded.title;

alter table public.listening_tasks enable row level security;
alter table public.user_listening_progress enable row level security;

drop policy if exists "listening_tasks_select_auth" on public.listening_tasks;
create policy "listening_tasks_select_auth"
  on public.listening_tasks
  for select
  to authenticated
  using (true);

drop policy if exists "user_listening_progress_own" on public.user_listening_progress;
create policy "user_listening_progress_own"
  on public.user_listening_progress
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

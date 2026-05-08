-- Writing kunlik 3 ta alohida vazifa matnlari + foydalanuvchi javoblari (`user_submissions`)

alter table public.writing_tasks
  add column if not exists task_1_1 text;

alter table public.writing_tasks
  add column if not exists task_1_2 text;

alter table public.writing_tasks
  add column if not exists part_2 text;

create table if not exists public.user_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day_number int not null check (day_number >= 1 and day_number <= 30),
  level text not null default 'A2',
  task_key text not null check (task_key in ('task_1_1', 'task_1_2', 'part_2')),
  answer_text text,
  updated_at timestamptz not null default now(),
  unique (user_id, day_number, level, task_key)
);

create index if not exists idx_user_submissions_user_day_level
  on public.user_submissions (user_id, day_number, level);

alter table public.user_submissions enable row level security;

drop policy if exists "user_submissions_own_select" on public.user_submissions;
create policy "user_submissions_own_select"
  on public.user_submissions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_submissions_own_upsert" on public.user_submissions;
create policy "user_submissions_own_upsert"
  on public.user_submissions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_submissions_own_update" on public.user_submissions;
create policy "user_submissions_own_update"
  on public.user_submissions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

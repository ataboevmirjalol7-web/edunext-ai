-- Kunlik 3 ta writing javobi + AI feedback (bir qator / kun / daraja)

create table if not exists public.user_writing_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day_number int not null check (day_number >= 1 and day_number <= 30),
  level text not null default 'A2',
  task_1_1_answer text,
  task_1_2_answer text,
  part_2_answer text,
  ai_feedback_json jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, day_number, level)
);

create index if not exists idx_user_writing_submissions_user_day
  on public.user_writing_submissions (user_id, day_number, level);

alter table public.user_writing_submissions enable row level security;

drop policy if exists "user_writing_submissions_own_select" on public.user_writing_submissions;
create policy "user_writing_submissions_own_select"
  on public.user_writing_submissions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_writing_submissions_own_insert" on public.user_writing_submissions;
create policy "user_writing_submissions_own_insert"
  on public.user_writing_submissions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_writing_submissions_own_update" on public.user_writing_submissions;
create policy "user_writing_submissions_own_update"
  on public.user_writing_submissions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

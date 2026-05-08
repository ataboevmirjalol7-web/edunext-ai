-- Dashboard Reading: kunlik matn + savollar (JSON: part1, part2, part3)
create table if not exists public.reading_tasks (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'A2',
  day_number int not null check (day_number >= 1 and day_number <= 30),
  title text not null,
  passage text not null,
  questions jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  constraint reading_tasks_level_day_key unique (level, day_number)
);

create index if not exists idx_reading_tasks_level_day on public.reading_tasks (level, day_number);

alter table public.reading_tasks enable row level security;

drop policy if exists "reading_tasks_select_auth" on public.reading_tasks;
create policy "reading_tasks_select_auth"
  on public.reading_tasks
  for select
  to authenticated
  using (true);

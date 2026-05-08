-- Kunlik writing vazifalari (Dashboard A2)
create table if not exists public.writing_tasks (
  id uuid primary key default gen_random_uuid(),
  day_number int not null unique check (day_number >= 1 and day_number <= 30),
  title text not null,
  description text,
  level text not null default 'A2',
  created_at timestamptz not null default now()
);

-- 30 kun: mavzular (admin keyin o'zgartirishi mumkin)
insert into public.writing_tasks (day_number, title, description)
select
  n,
  (array[
    'The benefits of coffee',
    'Everyday English: making suggestions',
    'A place I want to visit',
    'My last weekend',
    'Plans for the future',
    'Food and healthy habits',
    'My favourite season of the year',
    'How I learn new words',
    'A good friend of mine',
    'Transport in my city',
    'My family',
    'A film or series I like',
    'The weather today',
    'Helping other people',
    'My first job or school memory',
    'Social media: good and bad',
    'Music I listen to',
    'A small success I am proud of',
    'Problems in my town',
    'Holidays and traditions',
    'A book I read',
    'Staying safe online',
    'My morning routine',
    'Saving money',
    'Technology at home',
    'Sports and exercise',
    'A difficult day',
    'Gifts and celebrations',
    'The environment',
    'My dream for the next year',
    'Saying thank you'
  ])[n],
  'Write 30–50 words in English (A2). Use clear sentences; present, past, and future where appropriate.'
from generate_series(1, 30) as n
on conflict (day_number) do update
set
  title = excluded.title,
  description = excluded.description;

create index if not exists idx_writing_tasks_day on public.writing_tasks (day_number);

alter table public.writing_tasks enable row level security;

drop policy if exists "writing_tasks_select_auth" on public.writing_tasks;
create policy "writing_tasks_select_auth"
  on public.writing_tasks
  for select
  to authenticated
  using (true);

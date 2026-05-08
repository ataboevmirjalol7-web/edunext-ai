-- Ko‘p daraja (A2 / B1): listening_tasks da `level` + `day_number` bo‘yicha qatorlar.
-- Eski `week_number` sxemasi bilan birga yashashi mumkin.

alter table public.listening_tasks
  add column if not exists level text not null default 'A2';

comment on column public.listening_tasks.level is
  'Yozma/tinglash darajasi: A2, B1, … (listening_tasks qatori).';

create index if not exists idx_listening_tasks_level_day
  on public.listening_tasks (level, day_number);

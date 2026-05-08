-- Optional reading context for Writing (e.g. manager letter) shown in highlighted box above tasks.

alter table public.writing_tasks
  add column if not exists context text;

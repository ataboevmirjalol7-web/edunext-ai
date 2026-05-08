-- Listening: ixtiyoriy `audio_url` + transcript + vocab_list (`listening_tasks`).
-- Eski YouTube qatorlari saqlanishi uchun `youtube_id` endi NULL bo'lishi mumkin.

alter table public.listening_tasks
  alter column youtube_id drop not null;

alter table public.listening_tasks
  add column if not exists audio_url text;

alter table public.listening_tasks
  add column if not exists transcript text;

alter table public.listening_tasks
  add column if not exists vocab_list jsonb not null default '[]'::jsonb;

comment on column public.listening_tasks.audio_url is
  'Public URL yoki `/audio/...` kabi lokal yo‘l — `<audio src>`';

comment on column public.listening_tasks.transcript is
  'Tinglash matni (transkript)';

comment on column public.listening_tasks.vocab_list is
  'JSON massiv: ["word1", "word2", ...]';

-- Diktat tugagach rasmiy matn PDF havolasi (yangi tabda ochiladi).

alter table public.listening_tasks
  add column if not exists transcript_pdf_url text;

comment on column public.listening_tasks.transcript_pdf_url is
  'Rasmiy transcript PDF — to‘liq HTTPS URL yoki Storage nisbiy yo‘l.';

-- Grammar fazali test: ixtiyoriy 20 ta MCQ (JSON massiv). Bo‘sh bo‘lsa frontend zaxira savollar ishlatadi.
alter table public.grammar_tasks
  add column if not exists questions jsonb;

comment on column public.grammar_tasks.questions is
  'MCQ massiv: [{ "id": 1, "stem": "...", "options": ["A","B","C","D"], "correctIndex": 0 }] yoki "correct": "A"';

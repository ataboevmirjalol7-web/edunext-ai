-- Dashboard Reading: anon kalit bilan kirgan foydalanuvchilar ham `reading_tasks` ni o‘qiy olsin
-- (asl migratsiya faqat `authenticated` uchun edi — RLS tufayli qator chiqmasligi mumkin edi).
drop policy if exists "reading_tasks_select_anon" on public.reading_tasks;
create policy "reading_tasks_select_anon"
  on public.reading_tasks
  for select
  to anon
  using (true);

-- Bazada eski versiyada `title` bo‘lmasa — qo‘shish va mavjud ma’lumotni saqlash
alter table public.writing_tasks add column if not exists title text;

-- Agar avval `topic` ustuni bo‘lsa (mahalliy fork), qiymatlarni ko‘chirish
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'writing_tasks' and column_name = 'topic'
  ) then
    update public.writing_tasks set title = coalesce(nullif(trim(title), ''), trim(topic::text)) where title is null or trim(title) = '';
  end if;
end $$;

-- title bo‘sh qator bo‘lsa — kun raqamidan default
update public.writing_tasks
set title = 'Writing · kun ' || day_number::text
where title is null or trim(title) = '';

alter table public.writing_tasks alter column title set not null;

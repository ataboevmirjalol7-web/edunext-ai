-- Dashboard: kurslar ro'yxati (Supabase orqali boshqariladi; namunaviy Java/Python/SQL kodda emas)
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  slug text unique,
  sort_order int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists courses_published_sort_idx
  on public.courses (is_published desc, sort_order asc);

alter table public.courses enable row level security;

drop policy if exists "courses_select_published" on public.courses;
create policy "courses_select_published"
  on public.courses for select
  using (is_published = true);

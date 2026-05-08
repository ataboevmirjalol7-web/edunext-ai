-- Foydalanuvchi bo'yicha so'z yodlanganligi (umumiy vocabulary_list qatorlarini o'zgartirmasdan)
create table if not exists public.vocabulary_user_progress (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    vocabulary_list_id uuid not null references public.vocabulary_list (id) on delete cascade,
    is_learned boolean not null default false,
    updated_at timestamptz default now(),
    unique (user_id, vocabulary_list_id)
);

create index if not exists vocabulary_user_progress_user_idx
  on public.vocabulary_user_progress (user_id);

alter table public.vocabulary_user_progress enable row level security;

drop policy if exists "vocabulary_user_progress_select_own" on public.vocabulary_user_progress;
create policy "vocabulary_user_progress_select_own"
  on public.vocabulary_user_progress for select
  using (auth.uid() = user_id);

drop policy if exists "vocabulary_user_progress_insert_own" on public.vocabulary_user_progress;
create policy "vocabulary_user_progress_insert_own"
  on public.vocabulary_user_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "vocabulary_user_progress_update_own" on public.vocabulary_user_progress;
create policy "vocabulary_user_progress_update_own"
  on public.vocabulary_user_progress for update
  using (auth.uid() = user_id);

drop policy if exists "vocabulary_user_progress_delete_own" on public.vocabulary_user_progress;
create policy "vocabulary_user_progress_delete_own"
  on public.vocabulary_user_progress for delete
  using (auth.uid() = user_id);

-- Profil: joriy o‘quv kuni (1–30)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_day INTEGER DEFAULT 1;

COMMENT ON COLUMN public.profiles.current_day IS 'A2→B1 roadmap: joriy kun (odatda 1–30).';

-- Lug‘at progressi (har bir so‘z uchun alohida qator)
CREATE TABLE IF NOT EXISTS public.user_vocabulary_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    word_id UUID NOT NULL REFERENCES public.vocabulary_list (id) ON DELETE CASCADE,
    is_learned BOOLEAN NOT NULL DEFAULT true,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, word_id)
);

CREATE INDEX IF NOT EXISTS user_vocabulary_progress_user_idx
  ON public.user_vocabulary_progress (user_id);

CREATE INDEX IF NOT EXISTS user_vocabulary_progress_word_idx
  ON public.user_vocabulary_progress (word_id);

COMMENT ON TABLE public.user_vocabulary_progress IS 'Foydalanuvchi bo‘yicha vocabulary_list so‘zlarini yodlanganligi.';

ALTER TABLE public.user_vocabulary_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_vocabulary_progress_select_own" ON public.user_vocabulary_progress;
CREATE POLICY "user_vocabulary_progress_select_own"
  ON public.user_vocabulary_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_vocabulary_progress_insert_own" ON public.user_vocabulary_progress;
CREATE POLICY "user_vocabulary_progress_insert_own"
  ON public.user_vocabulary_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_vocabulary_progress_update_own" ON public.user_vocabulary_progress;
CREATE POLICY "user_vocabulary_progress_update_own"
  ON public.user_vocabulary_progress FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_vocabulary_progress_delete_own" ON public.user_vocabulary_progress;
CREATE POLICY "user_vocabulary_progress_delete_own"
  ON public.user_vocabulary_progress FOR DELETE
  USING (auth.uid() = user_id);

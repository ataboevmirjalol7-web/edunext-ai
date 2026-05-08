-- Kunlik yakuniy A2 testlari (dashboard 2-soat rejimi)
CREATE TABLE IF NOT EXISTS public.daily_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number INT NOT NULL UNIQUE CHECK (day_number >= 1 AND day_number <= 30),
  title TEXT NOT NULL DEFAULT 'Daily A2 quiz',
  questions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_tests_day_number ON public.daily_tests (day_number);

COMMENT ON TABLE public.daily_tests IS 'A2 dashboard: kun yakunidagi qisqa test (questions.questions[{prompt,choices[],answer}]).';

ALTER TABLE public.daily_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_tests_select_auth" ON public.daily_tests;
CREATE POLICY "daily_tests_select_auth"
  ON public.daily_tests
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.daily_tests (day_number, title, questions)
SELECT
  d,
  'Kunlik A2 tekshiruv — kun ' || d,
  jsonb_build_object(
    'questions',
    jsonb_build_array(
      jsonb_build_object(
        'prompt',
        'He ___ tennis on Saturdays.',
        'choices',
        jsonb_build_array('plays', 'playing', 'play', 'is play'),
        'answer',
        0
      ),
      jsonb_build_object(
        'prompt',
        'I ___ breakfast early yesterday.',
        'choices',
        jsonb_build_array('had', 'have', 'having', 'have had'),
        'answer',
        0
      ),
      jsonb_build_object(
        'prompt',
        'They ___ to Paris next week.',
        'choices',
        jsonb_build_array('went', 'go', 'will go', 'going'),
        'answer',
        2
      ),
      jsonb_build_object(
        'prompt',
        'There ___ many students in class.',
        'choices',
        jsonb_build_array('was', 'were', 'is', 'been'),
        'answer',
        1
      ),
      jsonb_build_object(
        'prompt',
        'She can ___ two languages.',
        'choices',
        jsonb_build_array('speaks', 'speaking', 'speak', 'to spoke'),
        'answer',
        2
      ),
      jsonb_build_object(
        'prompt',
        'This room is ___ than that one.',
        'choices',
        jsonb_build_array('more big', 'bigger', 'most big', 'big more'),
        'answer',
        1
      )
    )
  )
FROM generate_series(1, 30) AS d
ON CONFLICT (day_number) DO UPDATE SET
  title = EXCLUDED.title,
  questions = EXCLUDED.questions;

-- EduNext-AI: vocabulary_list ga transcription va example_sentence ustunlari
-- + B1 darajasi (1-kun) uchun 20 ta akademik so'z seed
-- Bright Neon Edition Vocabulary kartochkalari uchun zarur ustunlar

ALTER TABLE public.vocabulary_list
  ADD COLUMN IF NOT EXISTS transcription text,
  ADD COLUMN IF NOT EXISTS example_sentence text;

COMMENT ON COLUMN public.vocabulary_list.transcription IS 'IPA transkripsiyasi, masalan /əˈtʃiːv/. NULL bo''lishi mumkin.';
COMMENT ON COLUMN public.vocabulary_list.example_sentence IS 'Lug''at uchun ingliz tilidagi misol gap (italic).';

-- B1 1-kun: agar mavjud bo'lsa qayta seed qilamiz (faqat user_id IS NULL bo'lganlar)
DELETE FROM public.vocabulary_list
  WHERE level = 'B1' AND day_number = 1 AND user_id IS NULL;

INSERT INTO public.vocabulary_list
  (day_number, word_order, word, translation, transcription, example_sentence, level, is_learned, user_id)
VALUES
  (1,  1, 'achieve',      'erishmoq',                    '/əˈtʃiːv/',     'She worked hard to achieve her goals.',                              'B1', false, null),
  (1,  2, 'opportunity',  'imkoniyat',                   '/ˌɒp.əˈtjuː.nə.ti/', 'This job is a great opportunity for me.',                       'B1', false, null),
  (1,  3, 'experience',   'tajriba',                     '/ɪkˈspɪə.ri.əns/',   'He has a lot of experience in teaching.',                       'B1', false, null),
  (1,  4, 'environment',  'atrof-muhit',                 '/ɪnˈvaɪ.rən.mənt/',  'We must protect the environment for future generations.',       'B1', false, null),
  (1,  5, 'community',    'jamoa',                       '/kəˈmjuː.nə.ti/',    'The local community organized a charity event.',                'B1', false, null),
  (1,  6, 'develop',      'rivojlantirmoq',              '/dɪˈvel.əp/',        'You should develop your speaking skills daily.',                'B1', false, null),
  (1,  7, 'improve',      'yaxshilamoq',                 '/ɪmˈpruːv/',         'Reading regularly will improve your vocabulary.',               'B1', false, null),
  (1,  8, 'consider',     'mulohaza qilmoq',             '/kənˈsɪd.ər/',       'Please consider my suggestion before deciding.',                'B1', false, null),
  (1,  9, 'recommend',    'tavsiya etmoq',               '/ˌrek.əˈmend/',      'I would recommend this book to anyone learning English.',       'B1', false, null),
  (1, 10, 'available',    'mavjud, foydalanish mumkin',  '/əˈveɪ.lə.bəl/',     'The new edition will be available next month.',                 'B1', false, null),
  (1, 11, 'reliable',     'ishonchli',                   '/rɪˈlaɪ.ə.bəl/',     'Public transport here is fast and reliable.',                   'B1', false, null),
  (1, 12, 'significant',  'ahamiyatli',                  '/sɪɡˈnɪf.ɪ.kənt/',   'There has been a significant change in the climate.',           'B1', false, null),
  (1, 13, 'estimate',     'taxmin qilmoq',               '/ˈes.tɪ.meɪt/',      'Experts estimate the population will double by 2050.',          'B1', false, null),
  (1, 14, 'prevent',      'oldini olmoq',                '/prɪˈvent/',         'Regular exercise helps prevent many diseases.',                 'B1', false, null),
  (1, 15, 'remarkable',   'diqqatga sazovor',            '/rɪˈmɑː.kə.bəl/',    'She made a remarkable recovery after the surgery.',             'B1', false, null),
  (1, 16, 'persuade',     'ko''ndirmoq',                 '/pəˈsweɪd/',         'I tried to persuade him to join the team.',                     'B1', false, null),
  (1, 17, 'evidence',     'dalil',                       '/ˈev.ɪ.dəns/',       'There is strong evidence that the plan will succeed.',          'B1', false, null),
  (1, 18, 'maintain',     'saqlab qolmoq',               '/meɪnˈteɪn/',        'It is important to maintain a healthy lifestyle.',              'B1', false, null),
  (1, 19, 'efficient',    'samarali',                    '/ɪˈfɪʃ.ənt/',        'Modern engines are more efficient than older ones.',            'B1', false, null),
  (1, 20, 'encourage',    'rag''batlantirmoq',           '/ɪnˈkʌr.ɪdʒ/',       'My teacher always encourages us to ask questions.',             'B1', false, null);

-- Indekslar (level + day_number + word_order bo'yicha tezkor tortish)
CREATE INDEX IF NOT EXISTS vocabulary_list_level_day_order_idx
  ON public.vocabulary_list (level, day_number, word_order);

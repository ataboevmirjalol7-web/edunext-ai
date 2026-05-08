-- B1: grammar_tasks (Destination B2 pdf sahifasi) + writing_tasks (CEFR B1, level = 'B1')
-- `writing_tasks`: kun raqami + daraja bo'yicha noyob (A2 va B1 bir xil kunda alohida)

alter table public.writing_tasks
  drop constraint if exists writing_tasks_day_number_key;

alter table public.writing_tasks
  drop constraint if exists writing_tasks_level_day_key;

alter table public.writing_tasks
  add constraint writing_tasks_level_day_key unique (level, day_number);

-- grammar_tasks: admin / analitika / keyingi dinamik UI uchun (dashboard hozircha studyPlan.js bilan sinxron)
create table if not exists public.grammar_tasks (
  id uuid primary key default gen_random_uuid(),
  tier text not null default 'B1',
  day_number int not null check (day_number >= 1 and day_number <= 30),
  grammar_label text not null,
  pdf_page int not null check (pdf_page >= 1),
  created_at timestamptz not null default now(),
  unique (tier, day_number)
);

create index if not exists idx_grammar_tasks_tier_day
  on public.grammar_tasks (tier, day_number);

alter table public.grammar_tasks enable row level security;

drop policy if exists "grammar_tasks_select_auth" on public.grammar_tasks;
create policy "grammar_tasks_select_auth"
  on public.grammar_tasks
  for select
  to authenticated
  using (true);

insert into public.grammar_tasks (tier, day_number, grammar_label, pdf_page)
values
  ('B1', 1, 'Unit 1: Present Simple, Present Continuous', 6),
  ('B1', 2, 'Unit 2: Past Simple, Past Continuous', 18),
  ('B1', 3, 'Unit 3: Vocabulary (Food and Drink)', 100),
  ('B1', 4, 'Unit 4: Present Perfect Simple & Continuous', 6),
  ('B1', 5, 'Unit 5: Past Perfect Simple & Continuous', 18),
  ('B1', 6, 'Unit 6: Vocabulary (Education & Learning)', 112),
  ('B1', 7, 'Review 1 (Units 1-6)', 90),
  ('B1', 8, 'Unit 7: Future forms', 30),
  ('B1', 9, 'Unit 8: Modals (Ability, Permission)', 78),
  ('B1', 10, 'Unit 9: Vocabulary (The Media)', 48),
  ('B1', 11, 'Unit 10: Modals (Certainty, Advice)', 78),
  ('B1', 12, 'Unit 11: Passive 1', 94),
  ('B1', 13, 'Unit 12: Vocabulary (People & Society)', 60),
  ('B1', 14, 'Review 2 (Units 7-12)', 118),
  ('B1', 15, 'Unit 13: Passive 2', 94),
  ('B1', 16, 'Unit 14: Conditionals 1 (Zero, 1st, 2nd)', 54),
  ('B1', 17, 'Unit 15: Vocabulary (Health & Fitness)', 84),
  ('B1', 18, 'Unit 16: Conditionals 2 (3rd, Mixed)', 54),
  ('B1', 19, 'Unit 17: Relative Clauses', 142),
  ('B1', 20, 'Unit 18: Vocabulary (Environment)', 118),
  ('B1', 21, 'Review 3 (Units 13-18)', 130),
  ('B1', 22, 'Unit 19: Reported Speech', 130),
  ('B1', 23, 'Unit 20: Reported Questions/Commands', 130),
  ('B1', 24, 'Unit 21: Vocabulary (Technology)', 36),
  ('B1', 25, 'Unit 22: Adjectives and Adverbs', 66),
  ('B1', 26, 'Unit 23: Nouns and Articles', 42),
  ('B1', 27, 'Unit 24: Vocabulary (Work & Business)', 172),
  ('B1', 28, 'Unit 25: Pronouns and Determiners', 166),
  ('B1', 29, 'Unit 26: Vocabulary (Travel)', 12),
  ('B1', 30, 'Final Grand Test — CEFR full practice (grammar review)', 178)
on conflict (tier, day_number) do update set
  grammar_label = excluded.grammar_label,
  pdf_page = excluded.pdf_page;

insert into public.writing_tasks (level, day_number, title, description) values
  ('B1', 1,
    'Day 1 — School Canteen (Suggestions)',
    'CEFR B1. Use the Day 1 «School Canteen» image pack. Write suggestions (functional language / polite requests). Length: 100–150 words; paragraph format.'),

  ('B1', 2,
    'Day 1 — School Canteen (Formal email)',
    'CEFR B1. Same scenario (School Canteen). Write a **formal email** to the school (complaint / request / suggestions). Include greeting, purpose, bullet points if needed, closing. About 120–160 words.'),

  ('B1', 3,
    'Day 1 — School Canteen (Part 2 Essay)',
    'CEFR B1. Part 2 style essay on the School Canteen theme (opinion, reasons, conclusion). 130–180 words.'),

  ('B1', 4,
    'Day 2 — City Library (Announcement)',
    'CEFR B1. Use Day 2 «City Library» visuals. Write a short **announcement** (notice) for the library board or website. 100–140 words; clear layout.'),

  ('B1', 5,
    'Day 2 — City Library (Part 2 Essay)',
    'CEFR B1. Essay responding to a prompt linked to the City Library scenario (benefits of libraries / events / studying). 130–180 words.'),

  ('B1', 6,
    'Day 7 — Modern School Library (Suggestions)',
    'CEFR B1. Use Day 7 «Modern School Library» pack. Write suggestions for improving the library (ideas, polite language). 100–150 words.'),

  ('B1', 7,
    'Day 7 — Modern School Library (Part 2 Essay)',
    'CEFR B1. Essay on the modern school library theme (opinion + examples). 130–180 words.'),

  ('B1', 8,
    'Day 8 — Community Centre (Classes)',
    'CEFR B1. Day 8 «Community Centre». Describe classes / timetable / benefits for local people. 110–160 words.'),

  ('B1', 9,
    'Day 8 — Community Centre (Part 2 Essay)',
    'CEFR B1. Essay on community learning / courses / volunteering. 130–180 words.'),

  ('B1', 10,
    'Day 10 — City Museum (Review)',
    'CEFR B1. Day 10 «City Museum». Write a **review** of an exhibition (imagined from the visuals). 110–160 words.'),

  ('B1', 11,
    'Day 10 — City Museum (Part 2 Essay)',
    'CEFR B1. Essay on museums / culture / local heritage. 130–180 words.'),

  ('B1', 12,
    'Day 4 — City Park (Renovations)',
    'CEFR B1. Day 4 «City Park». Describe renovation plans and ask for public input (informative + persuasive). 110–160 words.'),

  ('B1', 13,
    'Day 4 — City Park (Part 2 Essay)',
    'CEFR B1. Essay on green spaces / parks / environment in the city. 130–180 words.'),

  ('B1', 14,
    'Day 9 — School Uniform (Pros and cons)',
    'CEFR B1. Day 9 «School Uniform». Balanced argument (advantages vs disadvantages). 130–180 words.'),

  ('B1', 15,
    'Day 9 — School Uniform (Part 2 Essay)',
    'CEFR B1. Continue the uniform theme with a clear opinion essay. 130–180 words.'),

  ('B1', 16,
    'Day 3 — Fitness Club (Equipment)',
    'CEFR B1. Day 3 «Fitness Club». Describe facilities / safety / recommendations. 100–150 words.'),

  ('B1', 17,
    'Day 3 — Fitness Club (Part 2 Essay)',
    'CEFR B1. Essay on health / sport / habits. 130–180 words.'),

  ('B1', 18,
    'Day 5 — School Sports Day (Activities)',
    'CEFR B1. Day 5 «School Sports Day». Report-style text about activities and results. 110–160 words.'),

  ('B1', 19,
    'Day 5 — School Sports Day (Part 2 Essay)',
    'CEFR B1. Essay on sport at school / teamwork / fair play. 130–180 words.'),

  ('B1', 20,
    'Global Warming (free topic)',
    'CEFR B1. Cause–effect + suggestions. Respond as Part 2 essay (130–180 words).'),

  ('B1', 21,
    'Day 6 — Local Cafe (Dishes)',
    'CEFR B1. Day 6 «Local Cafe». Describe dishes / service / recommendation. 100–150 words.'),

  ('B1', 22,
    'Day 6 — Local Cafe (Part 2 Essay)',
    'CEFR B1. Essay: eating out / local food / healthy choices. 130–180 words.'),

  ('B1', 23,
    'Interview practice (Reported speech focus)',
    'CEFR B1. Write a **dialogue** or interview extract, then 2–3 sentences practising reported speech (what they said / asked). Total 120–170 words.'),

  ('B1', 24,
    'Digital Era (free topic)',
    'CEFR B1. Essay on technology in daily life (benefits, risks, conclusion). 130–180 words.'),

  ('B1', 25,
    'Product review',
    'CEFR B1. Write a **review** of a gadget or app (imagined). 110–160 words.'),

  ('B1', 26,
    'Travel blog',
    'CEFR B1. Blog entry about a short trip (past tense + description). 120–170 words.'),

  ('B1', 27,
    'Job application letter',
    'CEFR B1. Formal **letter of application** (letter of motivation). 140–190 words.'),

  ('B1', 28,
    'Formal report',
    'CEFR B1. Short **report** for a school/company (introduction, findings, recommendations). 140–190 words.'),

  ('B1', 29,
    'Holiday experience',
    'CEFR B1. Narrative + description of a holiday / trip. 120–170 words.'),

  ('B1', 30,
    'Final CEFR full practice',
    'CEFR B1 **mock exam** style: pick one Part 2 essay prompt that combines several earlier themes; plan + write 150–200 words with clear paragraphs.')
on conflict (level, day_number) do update set
  title = excluded.title,
  description = excluded.description;

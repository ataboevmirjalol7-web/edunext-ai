-- Avtomatik generatsiya — `node scripts/genReadingTasksSeed.mjs`

insert into public.reading_tasks (level, day_number, title, passage, questions, description)
values (
  'A2',
  1,
  $t$Timed Reading · A2 · Kutubxona · Kun 1$t$,
  $pass$SCHOOL LIBRARY NEWS — SPRING PROJECT

Our school library is launching a six‑week reading challenge for all students. Participation is voluntary, but form tutors will remind classes each Monday. The aim is not competition between individuals; instead, groups earn points for finishing short articles and writing one reflective sentence in English.

The timetable might seem strict: Year 7 students should begin with band A texts, while older students may select band B or C. However, the librarian emphasises that levels are advisory. If a student finds a text too easy, they may switch upward after a quick conversation at the issue desk. No fee is charged for borrowing additional booklets during the project.

Some parents have asked whether digital devices will replace physical books. The official answer is no: tablets are available for accessibility, but paper copies remain the default because annotation is easier for many learners. The library has not yet decided to purchase new e‑readers for every classroom; that decision would require a separate budget meeting.

Students who complete every weekly task receive a certificate. Those who miss a week can still rejoin, but their group cannot claim the top prize. This rule has generated debate online: a few students argue it punishes illness, while staff respond that flexibility would make tracking progress impossible with current staffing.

Finally, volunteers are needed to help shelve returns on Friday afternoons. The library does not guarantee training before the first session, so newcomers should expect short on‑the‑job guidance rather than formal workshops—applicants who expect detailed manuals might be disappointed.$pass$,
  $qj${"part1":[{"id":1,"question":"The reading challenge is:","options":["Mandatory.","Voluntary with weekly reminders.","Only online.","Cancelled."],"correct":"B"},{"id":2,"question":"Band levels are described as:","options":["Fixed forever.","Advisory — may move up after a short talk.","Illegal to change.","Chosen by governors only."],"correct":"B"},{"id":3,"question":"About books vs tablets:","options":["E‑readers for every class.","Paper default partly because annotation suits many learners.","No tablets exist.","Devices banned entirely."],"correct":"B"},{"id":4,"question":"If a weekly task is missed:","options":["Cannot rejoin.","Group forfeits top prize.","Fees apply.","Certificate automatic."],"correct":"B"},{"id":5,"question":"Shelving volunteers should expect:","options":["No guidance.","Lengthy certifications first.","Short on‑the‑job help.","Payment per hour."],"correct":"C"}],"part2":[{"id":6,"question":"Individuals compete solo for ranking.","type":"T/F/NG","correct":"FALSE"},{"id":7,"question":"Older students may start with band B or C texts.","type":"T/F/NG","correct":"TRUE"},{"id":8,"question":"The library approved buying e‑readers for every classroom.","type":"T/F/NG","correct":"FALSE"},{"id":9,"question":"Missing a week means permanent exclusion.","type":"T/F/NG","correct":"FALSE"},{"id":10,"question":"The article states the square metres of shelving space.","type":"T/F/NG","correct":"NOT GIVEN"}],"part3":[{"id":11,"word":"voluntary","question":"\"Voluntary\" describes participation as:","options":["Required by law.","Chosen freely.","Secret.","Paid.","Banned."],"correct_match":"B"},{"id":12,"word":"reflective","question":"\"Reflective sentence\" implies writing that:","options":["Copies Wikipedia.","Thinks briefly about one's reading.","Is only slang.","Has no verbs.","Is left blank."],"correct_match":"B"},{"id":13,"word":"accessibility","question":"\"Accessibility\" regarding tablets hints at:","options":["Hiding cables.","Helping learners with different needs use materials.","Faster shelving.","Only Year 13.","Free pizza."],"correct_match":"B"},{"id":14,"word":"advisory","question":"\"Advisory levels\" suggests guidance is:","options":["Non‑binding suggestion rather than rigid law.","A police order.","A fine.","Invisible.","Only German."],"correct_match":"A"},{"id":15,"word":"sceptically","question":"\"Sceptically\" in online debate suggests students respond:","options":["With blind trust.","With doubt questioning the rule.","With silence.","With songs.","With grades only."],"correct_match":"B"}]}$qj$::jsonb,
  $d$Dashboard timed reading — seed (A2 kun 1)$d$
)
on conflict (level, day_number) do update set
  title = excluded.title,
  passage = excluded.passage,
  questions = excluded.questions,
  description = excluded.description;

insert into public.reading_tasks (level, day_number, title, passage, questions, description)
values (
  'B1',
  1,
  $t$Timed Reading · B1 · Kun 1$t$,
  $pass$URBAN GREEN SPACES AND WELL‑BEING

Many cities worldwide are experimenting with policies that increase vegetation cover, widen pavements for pedestrians and reduce car dominance in neighbourhoods. Critics argue such measures slow traffic and raise maintenance costs for local authorities. Advocates reply that measurable benefits outweigh these concerns if plans are grounded in reliable data.

Studies tracking residents before and after the creation of a new park repeatedly report reductions in reported stress levels, though questionnaires cannot prove causality on their own. Physiological proxies—such as heart‑rate variability after short walks among trees—provide complementary evidence without replacing long‑term longitudinal designs.

Economists investigate whether proximity to greenery affects productivity. Recent meta‑analyses synthesise heterogeneous studies; cautious reviewers stress that omitted variables—for example neighbourhood income—might confound correlations between exposure to parks and wages. Employers nevertheless promote walking meetings where safe routes exist, claiming informal collaboration improves.

Environmental scientists highlight another dimension: shading from street trees lowers surface temperatures during heatwaves. This issue is topical where concrete‑heavy districts suffer night‑time heat retention. Authorities may therefore prioritise species that maximise canopy coverage while resisting invasive pests—policy trade‑offs seldom appear in simplistic media narratives.

Residents themselves are not homogeneous. Seniors may prioritise benches and level paths; families might prioritise playgrounds. Consultation fatigue can emerge if questionnaires are circulated too frequently without subsequent visible action—a situation some neighbourhood forums describe sceptically despite official promises of responsiveness.

The passage does not adjudicate moral responsibility for historically unequal allocation of greenery between districts; scholars treat that separately. Readers should note that assertions about lifelong health impacts remain contested when exposures are reconstructed prospectively rather than sampled retrospectively across decades — the latter design is weaker for proving timing of benefits.$pass$,
  $qj${"part1":[{"id":1,"question":"According to paragraph 2, questionnaires about new parks:","options":["Prove that parks eliminate stress permanently.","Show lower reported stress yet cannot prove causality alone.","Replace the need for physiological measurements.","Were rejected by most researchers."],"correct":"B"},{"id":2,"question":"Cautious reviewers worry that correlations might be affected because:","options":["Parks shrink wages.","Omitted factors such as income may confuse the pattern.","Heatwaves distort surveys.","Meta‑analyses are illegal."],"correct":"B"},{"id":3,"question":"Walking meetings are mentioned as:","options":["A government law.","A practice employers claim aids informal teamwork.","A replacement for HR departments.","Proven harmful."],"correct":"B"},{"id":4,"question":"Trees are connected to:","options":["Hotter pavement at night.","Cooler surfaces during heatwaves.","Mandatory traffic speed.","Reducing questionnaires."],"correct":"B"},{"id":5,"question":"\"Consultation fatigue\" is linked to:","options":["Too few benches.","Frequent questionnaires without visible follow‑up.","Playgrounds.","Seniors rejecting paths."],"correct":"B"}],"part2":[{"id":6,"question":"Increasing greenery policies always silence critics completely.","type":"T/F/NG","correct":"FALSE"},{"id":7,"question":"Heart‑rate variability is offered as supplementary evidence besides surveys.","type":"T/F/NG","correct":"TRUE"},{"id":8,"question":"The text proves walking meetings raise wages.","type":"T/F/NG","correct":"FALSE"},{"id":9,"question":"Media narratives frequently explain subtle policy trade‑offs about species.","type":"T/F/NG","correct":"FALSE"},{"id":10,"question":"The passage settles moral debates about historically unequal green space.","type":"T/F/NG","correct":"FALSE"}],"part3":[{"id":11,"word":"meta‑analyses","question":"In \"...Recent meta‑analyses synthesise heterogeneous studies...\", closest meaning:","options":["Combining findings from multiple studies systematically.","A single patient's medical scan.","Random street interviews only.","Traffic speed measurements.","Painting park benches."],"correct_match":"A"},{"id":12,"word":"longitudinal","question":"\"Longitudinal designs\" implies research that:","options":["Measures once and stops.","Tracks the same phenomena or people over extended time.","Ignores statistics.","Only studies trees.","Excludes neighbourhoods."],"correct_match":"B"},{"id":13,"word":"confound","question":"\"Might confound correlations\" suggests an omitted variable might:","options":["Clarify all results.","Distort apparent cause‑effect.","Guarantee truth.","Delete parks.","Remove stress."],"correct_match":"B"},{"id":14,"word":"canopy","question":"\"Maximise canopy coverage\" refers chiefly to:","options":["Underground cables.","The leafy umbrella formed by branches.","Indoor gyms.","Car lanes.","Library loans."],"correct_match":"B"},{"id":15,"word":"sceptically","question":"\"Describe sceptically\" suggests residents view promises:","options":["Without doubt.","With doubt or questioning.","With legal contracts.","With silence only.","With joy."],"correct_match":"B"}]}$qj$::jsonb,
  $d$Dashboard timed reading — seed (B1 kun 1)$d$
)
on conflict (level, day_number) do update set
  title = excluded.title,
  passage = excluded.passage,
  questions = excluded.questions,
  description = excluded.description;



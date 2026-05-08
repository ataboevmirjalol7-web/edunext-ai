-- B1 · kun 1: kontekst + Task 1.1 / 1.2 / Part 2 alohida matnlar (dashboard o‘qishi uchun)

insert into public.writing_tasks (
  level,
  day_number,
  title,
  description,
  context,
  task_1_1,
  task_1_2,
  part_2
)
values (
  'B1',
  1,
  'Test 1 — School Canteen',
  'One scenario: the canteen manager asks for suggestions (meals, facilities, events). Three tasks: classmate email (~50 words), formal email to the manager (120–150), online-discussion post (180–200).',
  $ct$You are a student at your school, and the canteen manager sent you this message:

Dear Student,

We are planning to make some improvements in our school canteen and would like to hear your suggestions.

What new meals or snacks would you like us to include? What facilities or seating areas should we improve? What events could we organize to make lunchtimes more enjoyable?

Best wishes,
The Canteen Manager
$ct$,
  $t11$TASK 1.1 (write about 50 words)

Write a short email to your classmate. Tell them about the message from the canteen manager and ask what new meals, facilities, or events they think would make the canteen better.
$t11$,
  $t12$TASK 1.2 (aim for 120–150 words; allowed range in the app: 120–160)

Write an email to the canteen manager. Give your suggestions about new meals, improved facilities, and events that could make the canteen more enjoyable for students.
$t12$,
  $p2$PART 2 (aim for 180–200 words; allowed range: 175–215)

You are participating in an online discussion for students.

Should schools ban junk food completely? Post your response, giving reasons and examples.
$p2$
)
on conflict (level, day_number) do update set
  title = excluded.title,
  description = excluded.description,
  context = excluded.context,
  task_1_1 = excluded.task_1_1,
  task_1_2 = excluded.task_1_2,
  part_2 = excluded.part_2;

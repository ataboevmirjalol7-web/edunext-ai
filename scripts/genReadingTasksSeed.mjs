/**
 * Bir martalik: reading_tasks uchun seed SQL yozadi.
 * ishga tushirish: node scripts/genReadingTasksSeed.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTimedReadingExamPayload } from "../public/readingExamContent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dollarQuote(str, hint = "body") {
  let tag = hint.replace(/[^a-z]/gi, "") || "body";
  while (str.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${str}$${tag}$`;
}

function rowInsert(level, dayNum) {
  const p = getTimedReadingExamPayload(dayNum, level);
  const questions = { part1: p.part1, part2: p.part2, part3: p.part3 };
  const qjson = JSON.stringify(questions);

  return `
insert into public.reading_tasks (level, day_number, title, passage, questions, description)
values (
  '${level}',
  ${dayNum},
  ${dollarQuote(p.title, "t")},
  ${dollarQuote(p.passage, "pass")},
  ${dollarQuote(qjson, "qj")}::jsonb,
  ${dollarQuote(`Dashboard timed reading — seed (${level} kun ${dayNum})`, "d")}
)
on conflict (level, day_number) do update set
  title = excluded.title,
  passage = excluded.passage,
  questions = excluded.questions,
  description = excluded.description;
`.trim();
}

const out = [
  "-- Avtomatik generatsiya — `node scripts/genReadingTasksSeed.mjs`",
  rowInsert("A2", 1),
  rowInsert("B1", 1),
  "",
].join("\n\n");

const target = path.join(__dirname, "..", "supabase", "migrations", "20260205121000_reading_tasks_seed_a2_b1_day1.sql");
fs.writeFileSync(target, out + "\n", "utf8");
console.log("Wrote:", target);

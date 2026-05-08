-- Vocabulary: UUID, foydalanuvchi bo'lishi mumkin (user_id), o'qituvchi seedlari user_id = NULL
-- Eski jadval (boshqa sxema) bilan to'qnashmaslik uchun almashtiriladi.
-- word_order: kun ichidagi so'z tartibi (UI .order() uchun)

drop table if exists public.vocabulary_list cascade;

create table if not exists public.vocabulary_list (
    id uuid default gen_random_uuid() primary key,
    day_number integer not null,
    word_order smallint not null default 0,
    word text not null,
    translation text not null,
    level text default 'A2',
    is_learned boolean default false,
    user_id uuid references auth.users (id) on delete set null
);

create index if not exists vocabulary_list_day_level_idx
  on public.vocabulary_list (day_number, level);
create index if not exists vocabulary_list_user_id_idx
  on public.vocabulary_list (user_id);
create index if not exists vocabulary_list_day_order_idx
  on public.vocabulary_list (day_number, word_order);

alter table public.vocabulary_list enable row level security;

drop policy if exists "vocabulary_list_select_global" on public.vocabulary_list;
create policy "vocabulary_list_select_global"
  on public.vocabulary_list for select
  using (user_id is null or user_id = auth.uid());

-- 1–5 kun: har kuni 20 tadan (jami 100) — umumiy lug'at (user_id = NULL)
insert into public.vocabulary_list
  (day_number, word_order, word, translation, level, is_learned, user_id)
values
  -- 1-kun: Kundalik tartib
  (1, 1, 'Wake up', 'Uyg''onmoq', 'A2', false, null),
  (1, 2, 'Brush teeth', 'Tishni yuvmoq', 'A2', false, null),
  (1, 3, 'Get dressed', 'Kiynamoq', 'A2', false, null),
  (1, 4, 'Have breakfast', 'Nonushta qilmoq', 'A2', false, null),
  (1, 5, 'Leave home', 'Uydan chiqmoq', 'A2', false, null),
  (1, 6, 'Commute', 'Ishga yoki o''qishga qatnamoq', 'A2', false, null),
  (1, 7, 'Take a shower', 'Dush qabul qilmoq', 'A2', false, null),
  (1, 8, 'Have lunch', 'Tushlik qilmoq', 'A2', false, null),
  (1, 9, 'Finish work', 'Ishni tugatmoq', 'A2', false, null),
  (1, 10, 'Go shopping', 'Xarid qilmoq', 'A2', false, null),
  (1, 11, 'Cook dinner', 'Kechki ovqat pishirmoq', 'A2', false, null),
  (1, 12, 'Watch TV', 'Televizor ko''rish', 'A2', false, null),
  (1, 13, 'Read a book', 'Kitob o''qish', 'A2', false, null),
  (1, 14, 'Set the alarm', 'Budilnik o''rnatmoq', 'A2', false, null),
  (1, 15, 'Take a break', 'Dam olmoq', 'A2', false, null),
  (1, 16, 'Check email', 'Pochtani tekshirmoq', 'A2', false, null),
  (1, 17, 'Walk the dog', 'Itni sayr qildirmoq', 'A2', false, null),
  (1, 18, 'Do homework', 'Uy vazifasini bajarmoq', 'A2', false, null),
  (1, 19, 'Go to bed', 'Uxlashga yotmoq', 'A2', false, null),
  (1, 20, 'Good night', 'Hayirli tun', 'A2', false, null),

  -- 2-kun: Ovqat va pishirish
  (2, 1, 'Delicious', 'Mazali', 'A2', false, null),
  (2, 2, 'Healthy', 'Sog''lom', 'A2', false, null),
  (2, 3, 'Ingredients', 'Ingrediyentlar / masalliqlar', 'A2', false, null),
  (2, 4, 'Recipe', 'Retsept', 'A2', false, null),
  (2, 5, 'Boil', 'Qaynatmoq', 'A2', false, null),
  (2, 6, 'Fry', 'Qovurmoq', 'A2', false, null),
  (2, 7, 'Chop', 'Maydalamoq', 'A2', false, null),
  (2, 8, 'Peel', 'Po''stini aralashmoq', 'A2', false, null),
  (2, 9, 'Slice', 'Tilimlamoq', 'A2', false, null),
  (2, 10, 'Stir', 'Aralashtirmoq', 'A2', false, null),
  (2, 11, 'Oven', 'Duxovka', 'A2', false, null),
  (2, 12, 'Pan', 'Tova', 'A2', false, null),
  (2, 13, 'Spicy', 'Achchiq', 'A2', false, null),
  (2, 14, 'Bitter', 'Achchiq ta''m (yomon)', 'A2', false, null),
  (2, 15, 'Steam', 'Bug''da pishirmoq', 'A2', false, null),
  (2, 16, 'Grate', 'Graterdan o''tkazmoq', 'A2', false, null),
  (2, 17, 'Taste', 'Ta''m', 'A2', false, null),
  (2, 18, 'Serve', 'Taom tortmoq', 'A2', false, null),
  (2, 19, 'Leftovers', 'Qolgan taom', 'A2', false, null),
  (2, 20, 'Apron', 'Fartuk', 'A2', false, null),

  -- 3-kun: Maktab / o''qish
  (3, 1, 'Teacher', 'O''qituvchi', 'A2', false, null),
  (3, 2, 'Student', 'Talaba / o''quvchi', 'A2', false, null),
  (3, 3, 'Classroom', 'Sinf xonasi', 'A2', false, null),
  (3, 4, 'Exam', 'Imtihon', 'A2', false, null),
  (3, 5, 'Grade', 'Baho', 'A2', false, null),
  (3, 6, 'Library', 'Kutubxona', 'A2', false, null),
  (3, 7, 'Subject', 'Fan', 'A2', false, null),
  (3, 8, 'Homework', 'Uy vazifasi', 'A2', false, null),
  (3, 9, 'Notebook', 'Daftar', 'A2', false, null),
  (3, 10, 'Dictionary', 'Lug''at', 'A2', false, null),
  (3, 11, 'Break', 'Tanaffus', 'A2', false, null),
  (3, 12, 'Principal', 'Direktor', 'A2', false, null),
  (3, 13, 'Certificate', 'Sertifikat', 'A2', false, null),
  (3, 14, 'Lecture', 'Ma''ruza', 'A2', false, null),
  (3, 15, 'Seminar', 'Seminar', 'A2', false, null),
  (3, 16, 'Essay', 'Insho', 'A2', false, null),
  (3, 17, 'Eraser', 'O''chirg''ich', 'A2', false, null),
  (3, 18, 'Sharpener', 'Qalam tutqich', 'A2', false, null),
  (3, 19, 'Attendance', 'Davomat', 'A2', false, null),
  (3, 20, 'Schedule', 'Dars jadvali', 'A2', false, null),

  -- 4-kun: Sayohat
  (4, 1, 'Passport', 'Pasport', 'A2', false, null),
  (4, 2, 'Ticket', 'Chipta', 'A2', false, null),
  (4, 3, 'Luggage', 'Bagaj', 'A2', false, null),
  (4, 4, 'Airport', 'Aeroport', 'A2', false, null),
  (4, 5, 'Flight', 'Parvoz', 'A2', false, null),
  (4, 6, 'Delay', 'Kechikish', 'A2', false, null),
  (4, 7, 'Gate', 'Chiqish eshigi', 'A2', false, null),
  (4, 8, 'Boarding', 'Chipta tekshiruvi / chiqish', 'A2', false, null),
  (4, 9, 'Suitcase', 'Chamadon', 'A2', false, null),
  (4, 10, 'Customs', 'Bojxona', 'A2', false, null),
  (4, 11, 'Map', 'Xarita', 'A2', false, null),
  (4, 12, 'Hotel', 'Mehmonxona', 'A2', false, null),
  (4, 13, 'Reservation', 'Bron qilish', 'A2', false, null),
  (4, 14, 'Tourist', 'Sayyoh', 'A2', false, null),
  (4, 15, 'Guide', 'Gid', 'A2', false, null),
  (4, 16, 'Beach', 'Plyaj', 'A2', false, null),
  (4, 17, 'Souvenir', 'Suvenir', 'A2', false, null),
  (4, 18, 'Abroad', 'Chet elda', 'A2', false, null),
  (4, 19, 'Journey', 'Sayohat', 'A2', false, null),
  (4, 20, 'Platform', 'Perron', 'A2', false, null),

  -- 5-kun: Sog''liq
  (5, 1, 'Doctor', 'Shifokor', 'A2', false, null),
  (5, 2, 'Nurse', 'Hamshira', 'A2', false, null),
  (5, 3, 'Medicine', 'Dori', 'A2', false, null),
  (5, 4, 'Pain', 'Og''riq', 'A2', false, null),
  (5, 5, 'Fever', 'Harorat', 'A2', false, null),
  (5, 6, 'Cough', 'Yo''tal', 'A2', false, null),
  (5, 7, 'Headache', 'Bosh og''rig''i', 'A2', false, null),
  (5, 8, 'Hospital', 'Kasalxona', 'A2', false, null),
  (5, 9, 'Pharmacy', 'Dorixona', 'A2', false, null),
  (5, 10, 'Rest', 'Dam olish', 'A2', false, null),
  (5, 11, 'Exercise', 'Jismoniy mashq', 'A2', false, null),
  (5, 12, 'Diet', 'Parhez', 'A2', false, null),
  (5, 13, 'Allergy', 'Allergiya', 'A2', false, null),
  (5, 14, 'Appointment', 'Qabulga yozilish', 'A2', false, null),
  (5, 15, 'Prescription', 'Retsept (shifokor)', 'A2', false, null),
  (5, 16, 'Injury', 'Jarohat', 'A2', false, null),
  (5, 17, 'Virus', 'Virus', 'A2', false, null),
  (5, 18, 'Healthy', 'Sog''lom', 'A2', false, null),
  (5, 19, 'Sick', 'Kasal', 'A2', false, null),
  (5, 20, 'Bandage', 'Bint', 'A2', false, null);

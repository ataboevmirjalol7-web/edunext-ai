/**
 * A2: 30 kun × 20 so'z → supabase/migrations SQL fayl.
 * Ishlatish: node scripts/build_vocab_sql.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outSql = path.join(root, "supabase", "migrations", "20260503120000_vocabulary_list.sql");

/** Har bir blok: 20 qator, format en|uz */
function parseBlock(text, dayNum) {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 20) {
    throw new Error(`Kun ${dayNum}: 20 qator bo'lishi kerak, topildi ${lines.length}`);
  }
  return lines.map((line) => {
    const i = line.indexOf("|");
    if (i < 1) throw new Error(`Kun ${dayNum}: noto'g'ri qator: ${line}`);
    return {
      day_number: dayNum,
      word: line.slice(0, i).trim(),
      translation: line.slice(i + 1).trim(),
      level: "A2",
    };
  });
}

const DAYS_RAW = [
  // 1
  `hello|salom
goodbye|xayr
please|iltimos
thank you|rahmat
sorry|kechirasiz
excuse me|uzr
yes|ha
no|yo'q
maybe|balki
welcome|xush kelibsiz
see you|ko'rishguncha
good morning|hayirli tong
good night|hayirli tun
how are you|qandaysiz
fine|yahshi
nice to meet you|tanishganimdan xursandman
what is your name|ismingiz nima
my name is|mening ismim
where|qayerda
here|bu yerda`,

  // 2
  `mother|ona
father|ota
sister|singil
brother|aka
parents|ota-ona
family|oila
child|bola
baby|chaqaloq
grandfather|bobo
grandmother|buva
husband|er
wife|xotin
cousin|amakivachcha
uncle|amaki
aunt|xola
son|o'g'il
daughter|qiz
relative|qarindosh
married|uylangan
single|boydoq`,

  // 3
  `red|qizil
blue|ko'k
green|yashil
yellow|sariq
black|qora
white|oq
orange|apelsin rang
purple|binafsha
pink|pushti
brown|jigarrang
gray|kulrang
big|katta
small|kichik
long|uzun
short|qisqa
good|yahshi
bad|yomon
beautiful|chiroyli
new|yangi
old|eski`,

  // 4
  `dog|it
cat|mushuk
bird|qush
fish|baliq
horse|ot
cow|sigir
mouse|sichqon
rabbit|quyon
lion|arslon
tiger|yo'lbars
elephant|pil
bear|ayiq
snake|ilon
chicken|tovuq
duck|o'rdak
sheep|qo'y
monkey|maymun
animal|hayvon
zoo|zoopark
pet|uy hayvoni`,

  // 5
  `bread|non
rice|guruch
water|suv
milk|sut
tea|choy
coffee|qahva
juice|sharbat
meat|go'sht
egg|tuxum
apple|olma
banana|banan
orange|apelsin
vegetable|sabzavot
fruit|meva
sugar|shakar
salt|tuz
breakfast|nonushta
lunch|tushlik
dinner|kechki ovqat
hungry|och`,

  // 6
  `today|bugun
tomorrow|ertaga
yesterday|kecha
now|hozir
later|keyinroq
early|erta
late|kech
morning|ertalab
afternoon|peshin
evening|kechqurun
night|tun
week|hafta
month|oy
year|yil
Monday|dushanba
Friday|juma
Sunday|yakshanba
clock|soat
calendar|kalendar
birthday|tug'ilgan kun`,

  // 7
  `home|uy
school|maktab
hospital|kasalxona
shop|do'kon
park|park
station|stansiya
airport|aeroport
hotel|mehmonxona
bank|bank
library|kutubxona
museum|muzey
cinema|kino
restaurant|restoran
supermarket|supermarket
street|ko'cha
city|shahar
village|qishloq
map|xarita
bridge|ko'prik
office|idora`,

  // 8
  `car|mashina
bus|avtobus
train|poyezd
plane|samolyot
bike|velosiped
boat|qayiq
walk|yurish
drive|haydash
ticket|chipta
road|yo'l
traffic|transport harakati
trip|sayohat
passenger|yo'lovchi
driver|haydovchi
stop|bekat
fast|tez
slow|sekin
far|uzoq
near|yaqin
map|xarita`,

  // 9
  `shirt|ko'ylak
trousers|shim
dress|ko'ylak (ayol)
skirt|yubka
coat|palto
jacket|kurtka
shoes|oyoq kiyim
socks|paypoq
hat|shapka
gloves|qo'lqop
scarf|sharf
bag|sumka
glasses|ko'zoynak
uniform|forma
size|o'lcham
wear|kiyinish
buy|sotib olish
cheap|arzon
expensive|qimmat
colour|rang`,

  // 10
  `weather|ob-havo
sunny|quyoshli
rainy|yomg'irli
cloudy|bulutli
windy|shamolli
snow|qor
cold|sovuq
hot|issiq
warm|iliq
spring|bahor
summer|yoz
autumn|kuz
winter|qish
degree|gradus
forecast|prognoz
climate|iqlim
dry|quruq
wet|ho'l
storm|bo'ron
rain|yomg'ir`,

  // 11
  `sport|sport
football|futbol
basketball|basketbol
tennis|tennis
swimming|suzish
running|yugurish
team|jamoa
game|o'yin
win|yutmoq
lose|yutqazmoq
train|mashq qilmoq
match|o'yin
player|o'yinchi
coach|murabbiy
ball|to'p
hobby|qiziqish
fun|qiziqarli
race|poyga
goal|gol
rules|qoidalar`,

  // 12
  `job|ish
work|ishlash
boss|boshliq
colleague|hamkasb
salary|maosh
holiday|ta'til
meeting|yig'ilish
email|email
phone|telefon
computer|kompyuter
desk|stol
teacher|o'qituvchi
doctor|shifokor
nurse|hamshira
police|politsiya
seller|sotuvchi
student|o'quvchi
science|fan
project|loyiha
deadline|muddat`,

  // 13
  `one|bir
two|ikki
three|uch
four|to'rt
five|besh
six|olti
seven|yetti
eight|sakkiz
nine|to'qqiz
ten|o'n
first|birinchi
second|ikkinchi
third|uchinchi
half|yarim
money|pul
price|narx
percent|foiz
card|karta
cash|naqd
coin|tanga`,

  // 14
  `buy|sotib olish
sell|sotish
market|bozor
pay|to'lash
receipt|kvitansiya
discount|chegirma
customer|xaridor
open|ochiq
closed|yopiq
free|bepul
change|qaytim
cheap|arzon
expensive|qimmat
size|o'lcham
cost|narx
wallet|hamyon
offer|taklif
bill|hisob
sale|chegirma sotuv
shop assistant|sotuvchi`,

  // 15
  `speak|gapirish
listen|tinglash
read|o'qish
write|yozish
ask|so'ramoq
answer|javob bermoq
understand|tushunmoq
mean|demoq
repeat|takrorlash
translate|tarjima qilmoq
language|til
word|so'z
sentence|gap
conversation|suhbat
pronunciation|talaffuz
dictionary|lug'at
spell|harflab yozmoq
mistake|xato
correct|to'g'ri
practice|mashq`,

  // 16
  `happy|baxtli
sad|g'amgin
angry|jahldor
tired|charchagan
worried|xavotirli
excited|hayajonli
nervous|asabiy
calm|xotirjam
proud|faxrlanmoq
afraid|qo'rqmoq
surprise|hayrat
feel|hissedmoq
love|sevmoq
hope|umid
pain|og'riq
smile|tabassum
cry|yig'lamoq
relax|dam olmoq
stress|stress
kind|mehribon`,

  // 17
  `health|sog'liq
ill|kasal
medicine|dori
doctor|shifokor
hospital|kasalxona
better|yaxshiroq
fever|harorat
cough|yo'tal
headache|bosh og'rig'i
stomach|oshqozon
rest|dam olish
exercise|mashq
healthy|sog'lom
sick|kasal
pain|og'riq
dentist|tish shifokori
appointment|qabul
pharmacy|dorixona
vitamin|vitamin
sleep|uyqu`,

  // 18
  `learn|o'rganmoq
study|o'qimoq
exam|imtihon
test|test
homework|uy vazifasi
class|sinf
notebook|daftar
pencil|qalam
ruler|chizgich
blackboard|doska
subject|fan
question|savol
answer|javob
mark|baho
pass|o'tmoq
fail|yiqilmoq
course|kurs
degree|daraja
certificate|sertifikat
library|kutubxona`,

  // 19
  `internet|internet
website|sayt
password|parol
download|yuklab olish
upload|yuklash
file|fayl
screen|ekran
keyboard|klaviatura
mouse|sichqoncha
video|video
online|onlayn
offline|oflayn
app|ilova
wifi|Wi-Fi
battery|batareya
charger|zaryadlagich
click|bosmoq
save|saqlamoq
delete|o'chirmoq
search|qidiruv`,

  // 20
  `travel|sayohat
passport|pasport
visa|viza
luggage|bagaj
border|chegara
foreign|chet
abroad|chet el
tour|tur
guide|gid
beach|plyaj
mountain|tog'
island|orol
camera|fotoaparat
souvenir|sovga
map|xarita
ticket|chipta
hotel|mehmonxona
flight|parvoz
visitor|mehmon
reservation|bron`,

  // 21
  `kitchen|oshxona
bathroom|hammom
bedroom|yotoqxona
living room|mehmonxona
door|eshik
window|deraza
floor|qavat
roof|tom
shelf|jarf
table|stol
chair|stul
lamp|chiroq
key|kalit
rent|ijara
electricity|elektr
noise|shovqin
neighbour|qo'shn
flat|kvartira
stairs|zina
garden|bog'`,

  // 22
  `because|chunki
but|lekin
and|va
or|yoki
so|shuning uchun
if|agar
when|qachon
before|oldin
after|keyin
then|keyin
also|ham
very|juda
always|doim
never|hech qachon
sometimes|ba'zan
often|tez-teq
maybe|balki
both|ikkisi ham
another|boshqa
same|xuddi shu`,

  // 23
  `go|bormoq
come|kelmoq
leave|ketmoq
arrive|yetib kelmoq
stay|qolmoq
visit|tashrif buyurmoq
return|qaytmoq
fly|uchmoq
walk|yurmoq
run|yugurmoq
sit|o'tirmoq
stand|turmoq
open|ochmoq
close|yopmoq
start|boshlamoq
finish|tugatmoq
bring|olib kelmoq
take|olib ketmoq
put|qo'ymoq
wait|kutmoq`,

  // 24
  `cook|pishirmoq
cut|to'g'ramoq
boil|qaynatmoq
fry|qovurmoq
bake|pishirmoq (duxovkada)
taste|ta'm
delicious|mazali
sweet|shirin
sour|nordon
salty|tuzli
fresh|yangi
knife|picho
fork|vilka
spoon|qoshiq
plate|likop
recipe|retsept
oil|yog'
meal|taom
snack|yengil ovqat
dish|taom`,

  // 25
  `tree|daraxt
flower|gul
grass|o't
river|daryo
lake|ko'l
sea|dengiz
forest|o'rmon
sky|osmon
star|yulduz
moon|oy
earth|yer
plant|o'simlik
environment|atrof-muhit
air|havo
pollution|ifloslanish
protect|himoya qilmoq
animal|hayvon
bird|qush
nature|tabiat
weather|ob-havo`,

  // 26
  `music|musiqa
song|qo'shiq
film|film
photo|rasm
dance|raqs
book|kitob
story|hikoya
art|san'at
picture|rasm
draw|chizmoq
fun|qiziqarli
boring|zerikarli
free time|bo'sh vaqt
weekend|hafta oxiri
party|ziyofat
concert|konsert
instrument|asbob
theatre|teatr
museum|muzey
hobby|qiziqish`,

  // 27
  `people|odamlar
friend|do'st
neighbor|qo'shn
stranger|begona
young|yosh
old|qari
rich|boy
poor|kambag'al
help|yordam
culture|madaniyat
tradition|an'ana
law|qonun
right|huquq
polite|xushmuomala
rude|qo'pol
kind|mehribon
honest|halol
important|muhim
problem|muammo
community|jamiyat`,

  // 28
  `safe|xavfsiz
danger|xavf
fire|olov
accident|baxtsiz hodisa
emergency|favqulodda
warning|ogohlantirish
rule|qoida
helmet|kaska
seat belt|kamar
slow|sekinroq
careful|ehtiyotkor
help|yordam
call|qo'ng'iroq qilmoq
police|politsiya
hurt|jarohat
risk|risk
protect|himoya qilmoq
stairs|zina
crossing|o'tish joyi
traffic lights|svetafor`,

  // 29
  `plan|reja
dream|orzu
future|kelajak
hope|umid
goal|maqsad
success|muvaffaqiyat
fail|muvaffaqiyatsiz
maybe|balki
probably|ehtimol
must|kerak (majburiy)
should|kerak (maslahat)
would like|xohlardi
predict|bashorat qilmoq
prepare|tayyorlanmoq
decide|qaror qilmoq
choose|tanlamoq
try|urinmoq
believe|ishonmoq
remember|eslamoq
forget|unutmoq`,

  // 30
  `almost|deyarli
already|allaqachon
still|hali ham
again|yana
easy|oson
difficult|qiyin
possible|mumkin
impossible|mumkin emas
certainly|albatta
perhaps|balki
finally|nihoyat
suddenly|to'satdan
especially|ayniqsa
usually|odatda
recently|yaqinda
eventually|oxir-oqibat
clearly|aniq
probably|ehtimol
exactly|aynan
instead|o'rniga`,
];

const allRows = DAYS_RAW.flatMap((block, idx) => parseBlock(block, idx + 1));

function escSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const header = `-- EduNext-AI: A2 kunlik lug'at (30 kun × 20 so'z)
CREATE TABLE IF NOT EXISTS public.vocabulary_list (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_number integer NOT NULL CHECK (day_number >= 1 AND day_number <= 30),
  word text NOT NULL,
  translation text NOT NULL,
  level text NOT NULL DEFAULT 'A2'
);

CREATE INDEX IF NOT EXISTS vocabulary_list_day_level_idx
  ON public.vocabulary_list (day_number, level);

ALTER TABLE public.vocabulary_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vocabulary_list_select_public" ON public.vocabulary_list;
CREATE POLICY "vocabulary_list_select_public"
  ON public.vocabulary_list FOR SELECT
  USING (true);

TRUNCATE public.vocabulary_list;

`;

const values = allRows
  .map(
    (r) =>
      `(${r.day_number}, '${escSql(r.word)}', '${escSql(r.translation)}', '${escSql(r.level)}')`,
  )
  .join(",\n");

const sql = `${header}INSERT INTO public.vocabulary_list (day_number, word, translation, level) VALUES\n${values};\n`;

fs.mkdirSync(path.dirname(outSql), { recursive: true });
fs.writeFileSync(outSql, sql, "utf8");
console.log(`Yozildi: ${outSql} (${allRows.length} qator)`);

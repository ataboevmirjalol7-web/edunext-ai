-- `listening-audio` bucketida MP3 uchun: `createSignedUrl` va brauzer o‘qishi uchun SELECT ruxsati.
-- Bucketni Dashboard → Storage orqali yarating (nom: listening-audio), keyin migratsiyani qo‘llang.

drop policy if exists "listening_audio_authenticated_select" on storage.objects;

create policy "listening_audio_authenticated_select"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'listening-audio');

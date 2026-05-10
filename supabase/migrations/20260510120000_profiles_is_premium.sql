-- Premium obuna holati (24 soatdan keyingi taklif uchun)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

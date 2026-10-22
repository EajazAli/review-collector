-- Review Finder: Arabic business name and subtitle (optional per business).
-- Run once in Supabase -> SQL Editor. Safe to re-run.
alter table public.businesses add column if not exists name_ar    text not null default '';
alter table public.businesses add column if not exists tagline_ar text not null default '';

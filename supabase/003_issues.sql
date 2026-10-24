-- Review Finder: quick-pick issues on low ratings (food, service, staff, clean).
-- Run once in Supabase -> SQL Editor. Safe to re-run.
alter table public.reviews add column if not exists issues text[] not null default '{}';
alter table public.reviews drop constraint if exists reviews_issues_check;
alter table public.reviews add constraint reviews_issues_check
  check (issues <@ array['food','service','staff','clean','value']::text[]);

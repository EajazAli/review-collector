-- Review Finder: business type + 5th quick-pick issue ("poor value for money").
-- Run once in Supabase -> SQL Editor. Safe to re-run (also covers 003_issues.sql if it wasn't run).

-- What kind of business (issue chips are shown for restaurants / cafés only)
alter table public.businesses add column if not exists business_type text not null default 'restaurant';
alter table public.businesses drop constraint if exists businesses_type_check;
alter table public.businesses add constraint businesses_type_check
  check (business_type in ('restaurant','hotel','salon','clinic','retail','other'));

-- Quick-pick issues on low ratings, now with 'value'
alter table public.reviews add column if not exists issues text[] not null default '{}';
alter table public.reviews drop constraint if exists reviews_issues_check;
alter table public.reviews add constraint reviews_issues_check
  check (issues <@ array['food','service','staff','clean','value']::text[]);

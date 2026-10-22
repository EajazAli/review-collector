-- Review Finder by H&H Technology — Supabase schema
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

-- ───────────────────────── Tables ─────────────────────────

-- Super admins (H&H staff). Matched by login email.
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
insert into public.admins (email) values ('eajazali@gmail.com') on conflict do nothing;

create table if not exists public.businesses (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9-]{1,48}$'),
  name              text not null default '',
  tagline           text not null default '',
  logo              text not null default '',          -- public URL (Storage) or data: URL
  theme             jsonb not null default '{}'::jsonb,
  threshold         int  not null default 4 check (threshold between 1 and 5),
  google_review_url text not null default '',
  whatsapp          text[] not null default array['','']::text[],
  webhook_url       text not null default '',
  social            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Which login emails can manage which business (client logins).
create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  email       text not null check (email = lower(email)),
  created_at  timestamptz not null default now(),
  primary key (business_id, email)
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  rating      int  not null check (rating between 1 and 5),
  route       text not null check (route in ('google','private')),
  text        text not null default '' check (length(text) <= 2000),
  guest_name  text not null default '' check (length(guest_name) <= 120),
  guest_phone text not null default '' check (length(guest_phone) <= 40),
  images      text[] not null default '{}' check (cardinality(images) <= 4),  -- Storage paths in review-photos
  status      text not null default 'new' check (status in ('new','resolved')),
  created_at  timestamptz not null default now()
);
create index if not exists reviews_business_created on public.reviews (business_id, created_at desc);

-- ───────────────────────── Helpers ─────────────────────────

create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.email = public.current_email())
$$;

create or replace function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.business_members m where m.business_id = bid and m.email = public.current_email())
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();

-- Clients may edit their page but not move it (slug) — only admins can.
create or replace function public.guard_slug() returns trigger
language plpgsql as $$
begin
  if new.slug <> old.slug and not public.is_admin() then
    raise exception 'Only H&H admins can change the page link';
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard_slug on public.businesses;
create trigger businesses_guard_slug before update on public.businesses
  for each row execute function public.guard_slug();

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.admins           enable row level security;
alter table public.businesses       enable row level security;
alter table public.business_members enable row level security;
alter table public.reviews          enable row level security;

-- admins: a user may only see whether they themselves are an admin
drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (email = public.current_email());

-- businesses: the review page is public, so anyone can read a business
drop policy if exists biz_read on public.businesses;
create policy biz_read on public.businesses for select using (true);
drop policy if exists biz_insert on public.businesses;
create policy biz_insert on public.businesses for insert to authenticated with check (public.is_admin());
drop policy if exists biz_update on public.businesses;
create policy biz_update on public.businesses for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
drop policy if exists biz_delete on public.businesses;
create policy biz_delete on public.businesses for delete to authenticated using (public.is_admin());

-- business_members: admins manage; clients can see their own rows
drop policy if exists mem_read on public.business_members;
create policy mem_read on public.business_members for select to authenticated using (public.is_admin() or email = public.current_email());
drop policy if exists mem_write on public.business_members;
create policy mem_write on public.business_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- reviews: guests (anonymous) can submit; only the business's logins can read/update
drop policy if exists rev_insert on public.reviews;
create policy rev_insert on public.reviews for insert to anon, authenticated
  with check (status = 'new' and exists (select 1 from public.businesses b where b.id = business_id));
drop policy if exists rev_read on public.reviews;
create policy rev_read on public.reviews for select to authenticated using (public.is_member(business_id));
drop policy if exists rev_update on public.reviews;
create policy rev_update on public.reviews for update to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
drop policy if exists rev_delete on public.reviews;
create policy rev_delete on public.reviews for delete to authenticated using (public.is_admin());

-- ───────────────────────── Storage ─────────────────────────
-- logos: public bucket. review-photos: private; guests upload, owners view via signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Paths are "<business_id>/<file>"; the first folder decides who may write/read.
drop policy if exists logos_write on storage.objects;
create policy logos_write on storage.objects for all to authenticated
  using (bucket_id = 'logos' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'logos' and public.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists photos_upload on storage.objects;
create policy photos_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'review-photos'
    and exists (select 1 from public.businesses b where b.id::text = (storage.foldername(name))[1]));

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'review-photos' and public.is_member(((storage.foldername(name))[1])::uuid));

-- Arabic business name / subtitle (also in 002_arabic.sql)
alter table public.businesses add column if not exists name_ar    text not null default '';
alter table public.businesses add column if not exists tagline_ar text not null default '';

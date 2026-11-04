-- Review Finder: industry issue lists, recommend question, staff shout-outs, complaint deadlines.
-- Run once in Supabase -> SQL Editor, after 007_follow_up.sql. Safe to re-run.

-- Quick-pick issues now vary by business type
alter table public.reviews drop constraint if exists reviews_issues_check;
alter table public.reviews add constraint reviews_issues_check
  check (issues <@ array['food','service','staff','clean','value','room','checkin','wait','doctor','billing','booking','result','stock']::text[]);

-- "Would you recommend us?" and who the guest wants to thank
alter table public.reviews add column if not exists recommend text not null default '' check (recommend in ('', 'yes', 'maybe', 'no'));
alter table public.reviews add column if not exists shoutout  text not null default '' check (length(shoutout) <= 60);

-- Names guests can tap to thank (public, because the review page shows them)
alter table public.businesses add column if not exists staff text[] not null default '{}' check (cardinality(staff) <= 50);

-- Complaint handling: who owns it and by when
alter table public.reviews add column if not exists assigned_to text not null default '' check (length(assigned_to) <= 120);
alter table public.reviews add column if not exists assigned_at timestamptz;
alter table public.reviews add column if not exists due_at      timestamptz;

-- Guests can't assign a complaint when they submit it
drop policy if exists rev_insert on public.reviews;
create policy rev_insert on public.reviews for insert to anon, authenticated
  with check (status = 'new' and reply = '' and guest_verdict = '' and assigned_to = ''
    and exists (select 1 from public.businesses b where b.id = business_id));

-- Every private review starts with a 48-hour deadline, set by the database, not the guest's browser
create or replace function public.set_case_deadline() returns trigger
language plpgsql as $$
begin
  new.due_at = case when new.route = 'private' then now() + interval '48 hours' else null end;
  return new;
end $$;
drop trigger if exists reviews_case_deadline on public.reviews;
create trigger reviews_case_deadline before insert on public.reviews
  for each row execute function public.set_case_deadline();

create or replace function public.stamp_assigned_at() returns trigger
language plpgsql as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at = case when new.assigned_to = '' then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists reviews_assigned_at on public.reviews;
create trigger reviews_assigned_at before update on public.reviews
  for each row execute function public.stamp_assigned_at();

-- Existing private reviews get a deadline 48 hours after they arrived
update public.reviews set due_at = created_at + interval '48 hours'
 where route = 'private' and due_at is null;

-- The guest's page can show that someone has picked it up, without showing who
create or replace function public.get_ticket(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business', json_build_object('slug', b.slug, 'name', b.name, 'name_ar', b.name_ar, 'logo', b.logo, 'theme', b.theme),
    'rating', r.rating, 'issues', to_jsonb(r) -> 'issues', 'text', r.text, 'lang', r.lang,
    'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
    'reply', r.reply, 'replied_at', r.replied_at, 'guest_verdict', r.guest_verdict, 'verdict_at', r.verdict_at,
    'assigned_at', r.assigned_at)
  from public.reviews r join public.businesses b on b.id = r.business_id
  where length(coalesce(t, '')) >= 20 and r.ticket = t
$$;

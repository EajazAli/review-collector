-- Review Finder: close the loop with the guest.
-- A guest who sends private feedback gets a private status link (status.html?t=...).
-- The owner's reply shows there, and once it's handled the guest answers "Did we fix it?".
-- Run once in Supabase -> SQL Editor, after 006_cx_insights.sql. Safe to re-run.

alter table public.reviews add column if not exists ticket        text unique check (ticket is null or length(ticket) between 20 and 64);
alter table public.reviews add column if not exists reply         text not null default '' check (length(reply) <= 2000);
alter table public.reviews add column if not exists replied_at    timestamptz;
alter table public.reviews add column if not exists guest_verdict text not null default '' check (guest_verdict in ('', 'fixed', 'not_fixed'));
alter table public.reviews add column if not exists verdict_at    timestamptz;
alter table public.reviews add column if not exists resolved_at   timestamptz;

-- Guests can't pre-fill an owner reply or a verdict when they submit.
drop policy if exists rev_insert on public.reviews;
create policy rev_insert on public.reviews for insert to anon, authenticated
  with check (status = 'new' and reply = '' and guest_verdict = ''
    and exists (select 1 from public.businesses b where b.id = business_id));

-- Stamp reply time; only the guest (through rate_ticket) may set the verdict, so owners can't mark themselves "fixed".
create or replace function public.guard_follow_up() returns trigger
language plpgsql as $$
begin
  if new.reply is distinct from old.reply then
    new.replied_at = case when new.reply = '' then null else now() end;
  end if;
  if new.guest_verdict is distinct from old.guest_verdict
     and coalesce(current_setting('rf.guest_verdict', true), '') <> 'on' then
    raise exception 'Only the guest can answer "Did we fix it?"';
  end if;
  return new;
end $$;
drop trigger if exists reviews_follow_up on public.reviews;
create trigger reviews_follow_up before update on public.reviews
  for each row execute function public.guard_follow_up();

-- What the guest sees on their status page (no other guest's data, no phone numbers).
create or replace function public.get_ticket(t text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business', json_build_object('slug', b.slug, 'name', b.name, 'name_ar', b.name_ar, 'logo', b.logo, 'theme', b.theme),
    'rating', r.rating, 'issues', to_jsonb(r) -> 'issues', 'text', r.text, 'lang', r.lang,
    'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
    'reply', r.reply, 'replied_at', r.replied_at, 'guest_verdict', r.guest_verdict, 'verdict_at', r.verdict_at)
  from public.reviews r join public.businesses b on b.id = r.business_id
  where length(coalesce(t, '')) >= 20 and r.ticket = t
$$;

-- The guest's "Did we fix it?" answer. Allowed once the owner has replied or resolved it.
create or replace function public.rate_ticket(t text, v text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if v not in ('fixed', 'not_fixed') or length(coalesce(t, '')) < 20 then return false; end if;
  perform set_config('rf.guest_verdict', 'on', true);
  update public.reviews set guest_verdict = v, verdict_at = now()
   where ticket = t and (status = 'resolved' or reply <> '');
  return found;
end $$;

revoke all on function public.get_ticket(text) from public;
revoke all on function public.rate_ticket(text, text) from public;
grant execute on function public.get_ticket(text) to anon, authenticated;
grant execute on function public.rate_ticket(text, text) to anon, authenticated;

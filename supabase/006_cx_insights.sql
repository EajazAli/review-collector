-- Review Finder: CX Insights.
-- Run once in Supabase -> SQL Editor. Safe to re-run.

-- Guest language (en/ar) and when an issue was resolved (for "time to resolve").
alter table public.reviews add column if not exists lang text not null default '';
alter table public.reviews add column if not exists resolved_at timestamptz;

create or replace function public.stamp_resolved_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at = now();
  elsif new.status <> 'resolved' then
    new.resolved_at = null;
  end if;
  return new;
end $$;
drop trigger if exists reviews_resolved_at on public.reviews;
create trigger reviews_resolved_at before update on public.reviews
  for each row execute function public.stamp_resolved_at();

-- Anonymous benchmarks by business type, so an owner can compare against "restaurants in general"
-- without seeing any other business. A type is only reported when it has at least 3 businesses.
create or replace function public.cx_benchmarks(since timestamptz)
returns table (business_type text, businesses int, responses int, csat numeric, avg_rating numeric)
language sql stable security definer set search_path = public as $$
  select b.business_type,
         count(distinct b.id)::int,
         count(r.id)::int,
         round(100.0 * avg((r.rating >= 4)::int), 1),
         round(avg(r.rating)::numeric, 2)
  from public.reviews r
  join public.businesses b on b.id = r.business_id
  where r.created_at >= since
  group by b.business_type
  having count(distinct b.id) >= 3
$$;
revoke all on function public.cx_benchmarks(timestamptz) from public;
grant execute on function public.cx_benchmarks(timestamptz) to authenticated;

-- Review Finder: groups with multiple branches.
-- A group (brand) has many branches; each branch is a business with its own QR code and review page.
-- Group logins see every branch in the group (including branches added later), plus group-level analytics.
-- Run once in Supabase -> SQL Editor. Safe to re-run.

create table if not exists public.business_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '' check (length(name) <= 120),
  name_ar    text not null default '' check (length(name_ar) <= 120),
  created_at timestamptz not null default now()
);

alter table public.businesses add column if not exists group_id       uuid references public.business_groups(id) on delete set null;
alter table public.businesses add column if not exists branch_name    text not null default '' check (length(branch_name) <= 120);
alter table public.businesses add column if not exists branch_name_ar text not null default '' check (length(branch_name_ar) <= 120);
create index if not exists businesses_group on public.businesses (group_id);

-- Logins that manage a whole group.
create table if not exists public.group_members (
  group_id   uuid not null references public.business_groups(id) on delete cascade,
  email      text not null check (email = lower(email)),
  created_at timestamptz not null default now(),
  primary key (group_id, email)
);

create or replace function public.is_group_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.group_members g where g.group_id = gid and g.email = public.current_email())
$$;

-- A login manages a branch if it's linked to that branch OR to the branch's group.
-- Every existing policy (reviews, photos, logos, business edits) uses is_member, so this one change covers them all.
create or replace function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (select 1 from public.business_members m where m.business_id = bid and m.email = public.current_email())
    or exists (select 1 from public.businesses b join public.group_members g on g.group_id = b.group_id
               where b.id = bid and g.email = public.current_email())
$$;

-- Only H&H admins can move a branch between groups.
create or replace function public.guard_group() returns trigger
language plpgsql as $$
begin
  if new.group_id is distinct from old.group_id and not public.is_admin() then
    raise exception 'Only H&H admins can change the group';
  end if;
  return new;
end $$;
drop trigger if exists businesses_guard_group on public.businesses;
create trigger businesses_guard_group before update on public.businesses
  for each row execute function public.guard_group();

alter table public.business_groups enable row level security;
alter table public.group_members   enable row level security;

-- Group names: admins, group logins, and logins of any branch in the group can read them.
drop policy if exists grp_read on public.business_groups;
create policy grp_read on public.business_groups for select to authenticated using (
  public.is_group_member(id)
  or exists (select 1 from public.businesses b where b.group_id = business_groups.id and public.is_member(b.id)));
drop policy if exists grp_write on public.business_groups;
create policy grp_write on public.business_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists gm_read on public.group_members;
create policy gm_read on public.group_members for select to authenticated using (public.is_admin() or email = public.current_email());
drop policy if exists gm_write on public.group_members;
create policy gm_write on public.group_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Branches a login can manage (direct links + whole groups). Used by the dashboard.
create or replace function public.my_business_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select b.id from public.businesses b where public.is_member(b.id)
$$;
revoke all on function public.my_business_ids() from public;
grant execute on function public.my_business_ids() to authenticated;

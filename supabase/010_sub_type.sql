-- Review Finder: business category (sub-type) for the area benchmark.
-- Holds a Google Maps place type such as 'seafood_restaurant' or 'dental_clinic'. Empty means
-- "use the business's own category on Google". Safe to run more than once.

alter table public.businesses add column if not exists sub_type text not null default '';

do $$ begin
  alter table public.businesses add constraint businesses_sub_type_check
    check (sub_type = '' or sub_type ~ '^[a-z_]{3,40}$');
exception when duplicate_object then null; end $$;

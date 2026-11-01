-- Review Finder: Booking.com property page link (used for hotels).
-- Run once in Supabase -> SQL Editor. Safe to re-run.
alter table public.businesses add column if not exists booking_url text not null default '';

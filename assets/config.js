/* Review Finder — Supabase connection.
 * Supabase → Project Settings → API (or "Connect"):
 *   SUPABASE_URL      = Project URL            e.g. https://abcdxyz.supabase.co
 *   SUPABASE_ANON_KEY = anon / publishable key (safe to publish; RLS protects the data)
 * NEVER put the service_role / secret key here.
 */
window.RF_CONFIG = {
  SUPABASE_URL: 'https://dmyowzcesfdmvxnryumw.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_nzlgAFUoLj3XLwaUpfMkMQ_TtSe4biT',
  // Address printed QR codes point to (the guest review page lives here).
  PUBLIC_URL: 'https://eajazali.github.io/review-collector/',
};

// Review Finder: area benchmark.
// Finds businesses of the same kind near one of your businesses on Google Maps and returns their
// Google rating, number of reviews, distance and the few recent reviews Google shares, so the
// dashboard can show whether you are above the area average, on par or below.
// Runs on the server so the Google key is never in the browser. It reads the business with the
// signed-in user's own login, so database rules still decide which businesses they can compare.
//
// Secret (Supabase -> Edge Functions -> Secrets):
//   GOOGLE_PLACES_KEY   Google Maps Platform API key, restricted to "Places API (New)"
//
// Nothing from Google is stored: every comparison is fetched when the owner asks for it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_RE = /^[a-z_]{3,40}$/;
const PLACES = 'https://places.googleapis.com/v1';

// When no category is picked and Google doesn't give the business a primary type
const DEFAULT_TYPES: Record<string, string[]> = {
  restaurant: ['restaurant'],
  hotel: ['hotel'],
  salon: ['beauty_salon', 'hair_salon', 'barber_shop'],
  clinic: ['dental_clinic', 'doctor', 'hospital'],
  retail: ['clothing_store', 'electronics_store', 'supermarket'],
  other: [],
};

function placeIdFrom(v: string) {
  v = (v || '').trim();
  if (!v) return '';
  if (!/^https?:/i.test(v)) return v;
  try { return new URL(v).searchParams.get('placeid') || ''; } catch { return ''; }
}

function metres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

async function google(path: string, fields: string, init: RequestInit = {}) {
  const r = await fetch(`${PLACES}/${path}`, {
    ...init,
    headers: { 'X-Goog-Api-Key': env('GOOGLE_PLACES_KEY'), 'X-Goog-FieldMask': fields, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (r.ok) return { data: await r.json() };
  const t = await r.text();
  console.log('places error', r.status, t.slice(0, 300));
  if (r.status === 429) return { error: 'limit' };
  if (r.status === 403 || r.status === 401) return { error: 'key' };
  if (r.status === 400 && /type/i.test(t)) return { error: 'type' };
  if (r.status === 404 || (r.status === 400 && /place id|placeId|not found/i.test(t))) return { error: 'noplace' };
  return { error: 'engine' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!env('GOOGLE_PLACES_KEY')) return json({ error: 'off' });

  const base = env('SUPABASE_URL');
  const headers = { apikey: env('SUPABASE_ANON_KEY'), Authorization: req.headers.get('Authorization') || '' };
  const who = await fetch(`${base}/auth/v1/user`, { headers });
  if (!who.ok) return json({ error: 'auth' });

  try {
    const body = await req.json().catch(() => ({}));
    if (!UUID.test(body.business_id || '')) return json({ error: 'notfound' });
    const radius = Math.min(5000, Math.max(300, +body.radius || 1500));
    const lang = body.lang === 'ar' ? 'ar' : 'en';

    // The user's own login decides whether they may see this business.
    const r = await fetch(`${base}/rest/v1/businesses?id=eq.${body.business_id}&select=*`, { headers });
    const [b] = r.ok ? await r.json() : [];
    if (!b) return json({ error: 'notfound' });
    const placeId = placeIdFrom(b.google_review_url);
    if (!placeId) return json({ error: 'noplace' });

    const me = await google(`places/${encodeURIComponent(placeId)}?languageCode=${lang}`, 'id,displayName,location,rating,userRatingCount,primaryType,googleMapsUri');
    if (me.error) return json({ error: me.error });
    const home = me.data;
    if (!home?.location) return json({ error: 'noplace' });

    const picked = String(body.category || b.sub_type || '').trim();
    let types = TYPE_RE.test(picked) ? [picked] : home.primaryType ? [home.primaryType] : DEFAULT_TYPES[b.business_type] || [];
    const search = (t: string[]) => google('places:searchNearby',
      'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.primaryType,places.googleMapsUri,places.reviews',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(t.length ? { includedPrimaryTypes: t } : {}),
          maxResultCount: 20,
          rankPreference: 'DISTANCE',
          languageCode: lang,
          regionCode: 'SA',
          locationRestriction: { circle: { center: home.location, radius } },
        }),
      });
    let near = await search(types);
    // A category Google doesn't recognise: fall back to the business's own Google category
    if (near.error === 'type' && home.primaryType && types[0] !== home.primaryType) { types = [home.primaryType]; near = await search(types); }
    if (near.error) return json({ error: near.error });

    const places = (near.data?.places || [])
      .filter((p: { id: string }) => p.id !== home.id)
      .map((p: any) => ({
        name: p.displayName?.text || '',
        rating: p.rating ?? null,
        count: p.userRatingCount || 0,
        distance: p.location ? metres(home.location, p.location) : null,
        type: p.primaryType || '',
        url: p.googleMapsUri || '',
        reviews: (p.reviews || []).slice(0, 5).map((v: any) => ({
          rating: v.rating ?? null,
          text: (v.originalText?.text || v.text?.text || '').slice(0, 1200),
          lang: v.originalText?.languageCode || v.text?.languageCode || '',
          when: v.relativePublishTimeDescription || '',
          author: v.authorAttribution?.displayName || '',
          authorUrl: v.authorAttribution?.uri || '',
        })),
      }));

    return json({
      me: { name: home.displayName?.text || b.name, rating: home.rating ?? null, count: home.userRatingCount || 0, type: home.primaryType || '', url: home.googleMapsUri || '' },
      types, radius, places,
    });
  } catch (e) {
    console.log('area-benchmark failed', String(e).slice(0, 300));
    return json({ error: 'engine' });
  }
});

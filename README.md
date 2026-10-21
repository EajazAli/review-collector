# Review Finder by H&H Technology

Guests scan a QR code and rate their visit.
- **At or above the threshold** → "Post to Google!" Their text is copied and Google's review form opens.
- **Below the threshold** → "Send". The message and photos go privately to the owner (WhatsApp and inbox), so the business gets a second chance.

It is a plain static site with no build step, so it runs on GitHub Pages or Netlify as-is.

| File | What it is |
|---|---|
| `index.html` | Small landing page |
| `review.html?b=<slug>` | The guest page (what the QR code opens) |
| `admin.html` | Dashboard: businesses, logo, theme, threshold, Google link, WhatsApp, socials, QR, inbox, publish |
| `data/businesses.json` | The published businesses (exported from the dashboard) |
| `assets/` | CSS and JavaScript |

## Deploy on GitHub Pages
1. Create a new repository, e.g. `review-collector`, and upload everything in this folder.
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root** and save.
3. Your site is at `https://<your-username>.github.io/review-collector/`.
4. Open `…/admin.html` → **Publish** → paste that address in step 1 → Save.

**Netlify:** drag this folder onto app.netlify.com/drop, or connect the GitHub repo. No build command, publish directory `/`.

## Adding a business
1. In `admin.html`, click **New business** and fill in the name, logo, theme, threshold, Google link, WhatsApp numbers and socials. Then click **Save changes**.
2. Go to **Publish → Download businesses.json**.
3. In GitHub, open `data/` → **Add file → Upload files** → upload `businesses.json` → **Commit**.
4. Back on the business, download the **QR code** (PNG/SVG) or click **Print table card**.

Your edits are stored in this browser until you publish. Use the same browser for admin work, or Import the JSON on another computer.

## Getting the Google review link
In Google Business Profile, click **Ask for reviews** and copy the link (looks like `https://g.page/r/XXXX/review`). A Place ID (starts with `ChIJ`) also works.

> Google does not let any app post a review for a guest. That is why the page copies their text and opens Google's own review box, where they paste it and tap stars. This is the same flow every review tool uses.

## Client logins (Supabase)
Each business owner signs in at `login.html` and sees only their business: QR code, page customisation and reviews (with photos). H&H admins (emails in the `admins` table) see and manage everything.

**One-time setup**
1. Create a free project at supabase.com (region: closest to KSA, e.g. Frankfurt or Mumbai).
2. **SQL Editor → New query** → paste `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up" (only you create logins).
4. **Project Settings → API**: copy the **Project URL** and the **anon / publishable** key into `assets/config.js`. Never use the service_role/secret key.
5. **Authentication → Users → Add user → Create new user** with your own email (eajazali@gmail.com) and a password, tick **Auto Confirm User**. Sign in at `login.html`.
6. Dashboard → **Settings → Import from live site** copies the businesses from `data/businesses.json` into the database.

**Adding a client login**
1. Supabase → **Authentication → Users → Add user** → their email + a password → **Auto Confirm User**.
2. Dashboard → open their business → **Client logins** → add the same email → **Save changes**.
3. Send them `https://<your-site>/login.html` and their password. They can change it under Settings.

## Sending low ratings to WhatsApp (two contacts + backend)
A static site can't hold WhatsApp credentials safely, so delivery goes through a **webhook**:

1. In **Make.com** (or Zapier), create a scenario: **Webhooks → Custom webhook**. Copy its URL.
2. Paste the URL into the business's **Webhook URL** field, save and publish.
3. Add these steps after the webhook:
   - **WhatsApp Business Cloud → Send a message**: send to each number in `notify[]`, with text built from `rating`, `text`, `guestName` and `guestPhone`. Send `images[]` as media.
   - Optional: **Google Sheets → Add row** or email, so the owner has a record (the "backend").

The webhook receives JSON like this:
```json
{
  "id": "k3j9x2ab", "slug": "al-ameen", "rating": 2, "route": "private",
  "text": "Food was cold", "guestName": "Sara", "guestPhone": "+9665…",
  "images": ["data:image/jpeg;base64,…"], "createdAt": "2026-10-20T19:02:11Z",
  "business": { "slug": "al-ameen", "name": "Al Ameen" },
  "notify": ["+9665…", "+9665…"]
}
```
High ratings are also sent, with `"route": "google"`, so you can count them. Filter on `route` if you only want alerts for private ones.

**Without a webhook:** the guest's WhatsApp opens a chat to contact 1 with their message already typed. Photos can't be attached this way.

## Good to know
- `admin.html` has no password, because a static site can't protect it for real. Your data stays in your browser, so nobody else can change it, but don't link to the admin page publicly. When you add a backend (e.g. Supabase), put the admin behind a login.
- The dashboard inbox only shows feedback saved in the browser you're using (plus demo items). The real copies arrive through your webhook.
- Logos are resized to 320 px and guest photos to 1280 px to keep things fast.

## Run locally
Serve the folder with any static server (`npx serve .`) and open `/admin.html`. Opening the files directly with `file://` will not load `businesses.json`.

# StatsDashboard — Setup Guide

What this is: a password-free (Google Sign-In) admin page where Savannah (and up to 2 others she adds) can manually update the three About-page numbers, manage who has access, and configure reminder emails. It fully replaces the automated HAR scraper as the source of truth for those numbers.

Files in this delivery:
- `cloudflare-worker-dashboard/worker.js` — the backend (new Cloudflare Worker)
- `cloudflare-worker-dashboard/wrangler.jsonc` — its config
- `cloudflare-worker-dashboard/package.json` — one dependency (`jose`, for verifying Google's sign-in tokens)
- `stats-dashboard.html` — the admin page itself, goes in the root of the site repo

---

## 1. Google OAuth Client ID — DONE

Already set up under `cadencerealtyservices@gmail.com`: project "Cadence Stats Dashboard", OAuth consent screen in **Testing** mode, with `savannah@cadencerealtyservices.com`, `cadencerealtyservices@gmail.com`, and `bcreativewebservices@gmail.com` as test users (add the other 1–2 people whenever Savannah picks them — Google Cloud Console → this project → Google Auth Platform → Audience → Add users — no review needed, Testing mode allows up to 100).

The Client ID is already filled in below and in `wrangler.jsonc`:
```
456594241353-g6oqerc9kktuh9od2r8fiuhrgtru7lal.apps.googleusercontent.com
```
That's a public value, safe to have in the repo. (A client secret was also generated on that screen — it's not used anywhere in this setup and doesn't need to be saved or protected; this sign-in flow only needs the Client ID.)

## 2. Create the Cloudflare KV namespace

```bash
cd cloudflare-worker-dashboard
npm install
npx wrangler kv namespace create STATS_KV
```

That prints an `id` — paste it into `wrangler.jsonc` replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

## 3. Fill in the two public config values in `wrangler.jsonc`

- `GOOGLE_CLIENT_ID` → the value from step 1
- `ALLOWED_ORIGIN` → leave as `https://bcreativeservices.github.io` unless the domain changes

## 4. Set the secrets (never go in any file)

```bash
npx wrangler secret put PRIMARY_ADMIN_EMAIL
# → savannah@cadencerealtyservices.com

npx wrangler secret put BUSINESS_ADMIN_EMAIL
# → cadencerealtyservices@gmail.com
#   (the business's own shared account — permanent like Savannah's, shown in
#   the dashboard's user list, but not removable from there either. Doesn't
#   use up one of the 2 editable slots since it isn't a specific person.)

npx wrangler secret put HIDDEN_ADMIN_EMAIL
# → bcreativewebservices@gmail.com

npx wrangler secret put SESSION_SECRET
# → any long random string (e.g. generate one with: openssl rand -hex 32)

npx wrangler secret put RESEND_API_KEY
# → your Resend API key (rotate the one that was in chat before — see note below)

npx wrangler secret put REMINDER_FROM_EMAIL
# → optional; defaults to Resend's onboarding@resend.dev if you skip this.
#   To send from your own address (e.g. stats@cadencerealtyservices.com),
#   you'd need to verify that domain in Resend first.
```

**About that Resend key:** if you haven't already, revoke/regenerate the key that got pasted into our chat a while back (Resend dashboard → API Keys), then use the **new** one above. The old one should be treated as compromised since it's sitting in plaintext chat history.

## 5. Deploy the Worker

```bash
npx wrangler deploy
```

This prints the Worker's URL, something like:
```
https://cadence-stats-dashboard.<your-subdomain>.workers.dev
```

## 6. Point the dashboard page at the Worker

The Google Client ID is already filled in. In `stats-dashboard.html`, near the top of the `<script>` block, you just need to update:
```js
const WORKER_BASE_URL = "https://cadence-stats-dashboard.YOUR-SUBDOMAIN.workers.dev";
```
with the real Worker URL from step 5.

Then commit `stats-dashboard.html` into the root of the site repo (same level as `about.html`). **Don't link to it from any nav menu or sitemap** — it only needs to be reachable by direct URL/QR code, which is exactly what makes it "hidden."

## 7. Point `about.html` at the new Worker (replaces the old scraper tier)

Your current `about.html` fetch chain tries, in order: `/api/stats.php` → Cloudflare Worker (the old scraper one) → `data/stats.json` → hardcoded fallback.

Find the line where it calls the **old** Cloudflare Worker URL (the one ending in `cadence-stats.cadencerealty.workers.dev` or similar, from the scraper project) and swap it for the **new** dashboard Worker's public, read-only endpoint:

```
https://cadence-stats-dashboard.<your-subdomain>.workers.dev/api/stats
```

The response shape is the same field names you already have (`valueSold`, `propertiesSold`, `averagePrice`, `periodLabel`, `lastUpdated`), so the rest of the fetch chain and the count-up animation code shouldn't need any other changes. If you want, paste me the current `about.html` fetch block and I'll hand you back the exact few lines to change rather than doing this by eye.

## 8. Retire the old scraper's GitHub Action

It's currently failing loudly (red X) because HAR returned zero results on a recent run and the script treated that as fatal. Since this whole feature is being replaced, the simplest fix is to stop it from running rather than debug a scraper we don't need anymore:

In `.github/workflows/update-stats.yml`, remove (or comment out) the `schedule:` block so it only runs when you manually trigger it via `workflow_dispatch` (which should already be in there). That stops the automatic red-X failures without deleting any code — consistent with the earlier decision to leave the scraper dormant in the repo rather than delete it.

If you'd rather I do this one directly, send me the current contents of that file and I'll hand back the exact diff.

---

## What's intentionally NOT built

- **No password, anywhere.** Auth is 100% "Sign in with Google," checked against: Savannah's email (permanent), the business's shared `cadencerealtyservices@gmail.com` account (also permanent, shown but not removable), up to 2 emails Savannah manages herself from the dashboard, and your hidden CYA email (never shown in any UI or API response).
- **No self-service account requests / approval queue.** With only 5 possible accounts total, ever, that machinery wasn't worth the complexity — if someone new needs access, Savannah just types their email into one of her 2 open slots.
- **No separate "backdoor" auth path in the Worker.** There's nothing to recover, since access = being able to sign into one of the allowed Google accounts.

## Testing notes

The session-cookie signing/verification logic and the reminder "is it due yet" logic were tested directly (11 checks, all passing) — including a bug that testing caught and fixed: the original separator between email and expiry in the signed cookie was a literal `.`, which broke because email addresses themselves contain dots. Fixed by using `|` instead.

The dashboard page's client-side logic (populating fields from the Worker's responses, the add/edit/clear-a-user-slot flow, and that requests always send `credentials: "include"` so the cross-origin session cookie actually works) was tested against a mocked Worker with jsdom — 19 checks, all passing.

What hasn't been tested: the actual live Google sign-in flow and the real Resend email send, since both need real credentials that only exist once you complete steps 1–4 above. Once deployed, the one real end-to-end check worth doing is: sign in for real, save a number, refresh the page, confirm it's still there; and separately, temporarily set the reminder frequency to something you can trigger quickly to confirm an email actually lands in an inbox.

// ------------------------------------------------------------
// Cadence Realty — Live Stats Worker (Cloudflare Workers)
//
// Runs server-side, on-demand, whenever the About page's JS calls
// it — not on a fixed schedule. This is what makes "fresh the
// moment someone visits" possible at all: a static site (GitHub
// Pages) can't run code per-request, and a browser can't fetch
// HAR.com directly (CORS blocks it). This Worker is the missing
// server-side piece that does the fetch on HAR's behalf and hands
// the result back to the browser with permissive CORS headers.
//
// Same scraping/estimation logic as scripts/fetch-stats.js — see
// that file's header comment for the full "why mid-price-range
// average, not exact prices" explanation. Kept in sync manually;
// if one changes, check whether the other should too.
//
// CACHING: results are cached at Cloudflare's edge for 10 minutes
// (see CACHE_SECONDS below). Re-scraping HAR on literally every
// single visitor's page load would hammer HAR's servers and risk
// getting this Worker's IP rate-limited or blocked, breaking the
// feature for everyone. Ten minutes keeps this "fresh as people
// visit" without being disrespectful of HAR's infrastructure.
//
// DEPLOYMENT — see the accompanying setup notes for full steps.
// Quick version, using Wrangler (Cloudflare's CLI):
//   1. npm install -g wrangler
//   2. wrangler login
//   3. wrangler deploy cloudflare-worker/stats-worker.js --name cadence-stats
//   4. Wrangler prints a URL like https://cadence-stats.<you>.workers.dev
//      — that's what goes into about.html's fetch() call.
// ------------------------------------------------------------

const SOURCE_BASE_URL = "https://www.har.com/idx/mls/sold/listing";
const SOURCE_QUERY = "sitetype=aws&cid=736316&allmls=n&mlsorgid=1&isSiteIdx=1";
const TRAILING_DAYS = 365;
const MAX_PAGES = 25;
const CACHE_SECONDS = 600; // 10 minutes

// IMPORTANT: replace this with your site's real deployed origin
// before going live (e.g. "https://bcreativeservices.github.io" or
// a custom domain if one gets set up). Using "*" works but is
// looser than necessary now that we know the real origin.
const ALLOWED_ORIGIN = "https://bcreativeservices.github.io";

const ITEM_PATTERN =
    /Sold Date:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?\$([\d,]+)\s*-\s*\$([\d,]+)[\s\S]*?Represented:\s*(Seller|Buyer)[\s\S]*?(Sold|Rented)/g;

function stripTags(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ");
}

function parsePrice(str) {
    const n = parseInt(str.replace(/,/g, ""), 10);
    return Number.isNaN(n) ? null : n;
}

function parseDate(mmddyyyy) {
    const [month, day, year] = mmddyyyy.split("/").map(Number);
    return new Date(year, month - 1, day);
}

async function fetchPage(pageNum) {
    const url = `${SOURCE_BASE_URL}?${SOURCE_QUERY}&page=${pageNum}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }
    });

    if (!res.ok) {
        throw new Error(`Fetch failed on page ${pageNum}: ${res.status} ${res.statusText}`);
    }

    return stripTags(await res.text());
}

async function computeStats() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRAILING_DAYS);

    const soldMidpoints = [];
    let reachedCutoff = false;

    for (let pageNum = 1; pageNum <= MAX_PAGES && !reachedCutoff; pageNum++) {
        const text = await fetchPage(pageNum);
        const items = [...text.matchAll(ITEM_PATTERN)];

        if (items.length === 0) break;

        for (const [, dateStr, lowStr, highStr, , status] of items) {
            const soldDate = parseDate(dateStr);

            if (soldDate < cutoff) {
                reachedCutoff = true;
                continue;
            }

            if (status !== "Sold") continue;

            const low = parsePrice(lowStr);
            const high = parsePrice(highStr);
            if (low === null || high === null) continue;

            soldMidpoints.push((low + high) / 2);
        }
    }

    if (soldMidpoints.length === 0) {
        throw new Error("Found zero trailing-12-month sold transactions — source page layout may have changed.");
    }

    const valueSold = Math.round(soldMidpoints.reduce((sum, n) => sum + n, 0));
    const propertiesSold = soldMidpoints.length;
    const averagePrice = Math.round(valueSold / propertiesSold);

    return {
        valueSold,
        propertiesSold,
        averagePrice,
        periodLabel: "Trailing 12 months",
        methodology: "Mid-price range average",
        methodologyNote:
            "HAR does not publish exact closed sale prices publicly. Each sale's price is " +
            "estimated as the midpoint of HAR's published sold-price range, then summed/averaged.",
        source: `${SOURCE_BASE_URL}?${SOURCE_QUERY}`,
        lastUpdated: new Date().toISOString()
    };
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json"
    };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders() });
        }

        const cache = caches.default;
        const cacheKey = new Request(request.url, request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        try {
            const stats = await computeStats();
            const response = new Response(JSON.stringify(stats), {
                status: 200,
                headers: {
                    ...corsHeaders(),
                    "Cache-Control": `public, max-age=${CACHE_SECONDS}`
                }
            });

            ctx.waitUntil(cache.put(cacheKey, response.clone()));
            return response;
        } catch (err) {
            // Fail with a clear error rather than silently returning
            // stale or nonsense data — about.html falls back to its
            // own cached data/stats.json (updated daily) if this call
            // fails for any reason.
            return new Response(
                JSON.stringify({ error: err.message }),
                { status: 502, headers: corsHeaders() }
            );
        }
    }
};

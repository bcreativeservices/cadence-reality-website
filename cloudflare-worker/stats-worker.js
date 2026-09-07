// ------------------------------------------------------------
// Cadence Realty — Live Stats Worker (Cloudflare Workers, hardened)
//
// Same job as scripts/fetch-stats.js — see that file's header for
// the full "why mid-price-range average" and "why this is defensive
// about failure" explanations. Runs server-side, on-demand, whenever
// the About page's JS calls it.
//
// CACHING: two layers.
//   - A normal 10-minute cache on successful responses (so repeat
//     visitors within that window don't each trigger a fresh scrape
//     — considerate of HAR's servers, avoids rate-limiting risk).
//   - A separate, long-lived "last known good" cache (30 days) that
//     only updates on success and is never itself expired by time.
//     If a fresh scrape ever fails, this is served instead of an
//     error — a stale-but-real number beats a broken page. Only
//     returns an actual error if this has never once succeeded.
//
// KNOWN CAVEAT: HAR (or a WAF in front of it) appears to apply
// inconsistent, IP-pool-dependent bot protection — confirmed by a
// hard 403 from this exact Worker's IP range in testing. This
// resilience layer means visitors won't see that failure; the
// last-known-good number keeps showing until a scrape attempt gets
// through again. See scripts/fetch-stats.js for the same discussion.
//
// DEPLOYMENT:
//   1. npm install -g wrangler
//   2. wrangler login
//   3. From the cloudflare-worker folder: wrangler deploy
// ------------------------------------------------------------

const SOURCE_BASE_URL = "https://www.har.com/idx/mls/sold/listing";
const SOURCE_QUERY = "sitetype=aws&cid=736316&allmls=n&mlsorgid=1&isSiteIdx=1";
const TRAILING_DAYS = 365;
const MAX_PAGES = 25;
const CACHE_SECONDS = 600; // 10 minutes — normal freshness window
const FALLBACK_CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 days — "last known good" ceiling
const FETCH_TIMEOUT_MS = 20000;

const MIN_PLAUSIBLE_PRICE = 1000;
const MAX_PLAUSIBLE_PRICE = 50000000;
const MAX_PLAUSIBLE_PROPERTIES = 200;

// Replace with your site's real deployed origin before going live.
const ALLOWED_ORIGIN = "https://bcreativeservices.github.io";

const ITEM_PATTERN =
    /Sold Date:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?\$([\d,]+)\s*-\s*\$([\d,]+)[\s\S]*?Represented:\s*(Seller|Buyer)[\s\S]*?(Sold|Rented)[\s\S]*?MLS#\s*(\d+)/g;

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
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchPage(pageNum) {
    const url = `${SOURCE_BASE_URL}?${SOURCE_QUERY}&page=${pageNum}`;
    const res = await fetchWithTimeout(
        url,
        {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            }
        },
        FETCH_TIMEOUT_MS
    );

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} on page ${pageNum}`);
    }

    return stripTags(await res.text());
}

async function computeStats() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRAILING_DAYS);

    const soldMidpoints = [];
    const seenMlsNumbers = new Set();
    let reachedCutoff = false;
    let previousPageText = null;

    for (let pageNum = 1; pageNum <= MAX_PAGES && !reachedCutoff; pageNum++) {
        const text = await fetchPage(pageNum);

        if (text === previousPageText) break; // broken-pagination guard
        previousPageText = text;

        const items = [...text.matchAll(ITEM_PATTERN)];
        if (items.length === 0) break;

        for (const [, dateStr, lowStr, highStr, , status, mlsNum] of items) {
            if (seenMlsNumbers.has(mlsNum)) continue;
            seenMlsNumbers.add(mlsNum);

            const soldDate = parseDate(dateStr);
            if (soldDate === null) continue;

            if (soldDate < cutoff) {
                reachedCutoff = true;
                continue;
            }

            if (status !== "Sold") continue;

            const low = parsePrice(lowStr);
            const high = parsePrice(highStr);
            const isPlausible =
                low !== null && high !== null &&
                low <= high &&
                low >= MIN_PLAUSIBLE_PRICE && high <= MAX_PLAUSIBLE_PRICE;

            if (!isPlausible) continue;

            soldMidpoints.push((low + high) / 2);
        }
    }

    if (soldMidpoints.length === 0) {
        throw new Error("Found zero trailing-12-month sold transactions this run.");
    }

    if (soldMidpoints.length > MAX_PLAUSIBLE_PROPERTIES) {
        throw new Error(`Found ${soldMidpoints.length} sold transactions — implausibly high, refusing to publish.`);
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
        const fallbackKey = new Request(request.url + "#last-known-good", request);

        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        try {
            const stats = await computeStats();
            const body = JSON.stringify(stats);

            const response = new Response(body, {
                status: 200,
                headers: { ...corsHeaders(), "Cache-Control": `public, max-age=${CACHE_SECONDS}` }
            });
            const fallbackResponse = new Response(body, {
                status: 200,
                headers: { ...corsHeaders(), "Cache-Control": `public, max-age=${FALLBACK_CACHE_SECONDS}` }
            });

            ctx.waitUntil(cache.put(cacheKey, response.clone()));
            ctx.waitUntil(cache.put(fallbackKey, fallbackResponse.clone()));
            return response;
        } catch (err) {
            // Live fetch failed or returned implausible data — try the
            // long-lived fallback cache before giving up entirely.
            const fallback = await cache.match(fallbackKey);
            if (fallback) {
                return new Response(await fallback.text(), {
                    status: 200,
                    headers: corsHeaders()
                });
            }

            return new Response(
                JSON.stringify({ error: err.message }),
                { status: 502, headers: corsHeaders() }
            );
        }
    }
};

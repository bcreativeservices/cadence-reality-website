// ------------------------------------------------------------
// Cadence Realty — Stats Sync (HAR-direct version, hardened)
//
// Fetches Cadence Realty Services' own trailing-12-month sold
// transactions directly from HAR's public AWS IDX tool and computes
// Value of Real Estate Sold / Number of Properties Sold / Average
// Listing Price from them, writing the result to data/stats.json.
//
// WHY MID-PRICE-RANGE AVERAGE, NOT EXACT PRICES:
// HAR/HRIS does not publish exact closed sale prices publicly,
// anywhere — confirmed directly against three different HAR pages,
// including this exact AWS IDX tool scoped to Savannah Burns' own
// cid. Every one shows only a bucketed "Sold Price Range" (e.g.
// "$325,001 - $370,000"), never a single number. Exact prices exist
// only inside HAR's authenticated back-office member system, a
// different, non-embeddable product this script has no access to.
// So: each sale's price is estimated as the midpoint of its
// published range. Disclosed on the About page itself ("Mid-Price
// Range Average"), not presented as exact.
//
// WHY THIS IS DEFENSIVE ABOUT FAILURE:
// HAR (or a WAF in front of it) appears to have inconsistent,
// IP-pool-dependent bot protection — confirmed by three different
// outcomes across three attempts from two different cloud platforms
// (a hard 403 from Cloudflare Workers every time; a GitHub Actions
// run that got served empty/non-matching content; a later GitHub
// Actions run that got a hard 403). GitHub Actions runners come from
// a huge, constantly-rotating shared IP pool used by countless
// unrelated projects, so whether a given run gets through is largely
// down to which IP it happens to draw that day — not something this
// script can fix with headers or retries.
//
// So the design here is "best effort, never breaks": on ANY failure
// — blocked fetch, unexpected page structure, garbled data — this
// script logs a clear warning and exits successfully (code 0)
// WITHOUT touching data/stats.json, leaving the last real, valid
// result in place. The next scheduled run tries again. The site
// never shows an error or breaks; it just refreshes less often than
// "every single day" during any stretch where HAR happens to be
// blocking this particular IP pool.
//
// SOURCE: https://www.har.com/idx/mls/sold/listing?sitetype=aws&cid=736316&allmls=n&mlsorgid=1
// Mixes actual home SALES and RENTALS, each tagged "Sold" or
// "Rented" — only "Sold" counts. Sorted newest-first by sold date.
//
// Run manually with: node scripts/fetch-stats.js
// Run automatically by: .github/workflows/update-stats.yml (daily)
// ------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.har.com/idx/mls/sold/listing";
const QUERY = "sitetype=aws&cid=736316&allmls=n&mlsorgid=1&isSiteIdx=1";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "stats.json");

const TRAILING_DAYS = 365;
const MAX_PAGES = 25; // safety net against a runaway loop
const FETCH_TIMEOUT_MS = 20000;

// Sanity bounds — a single-office Houston brokerage this size has
// historically sold ~37 properties/year (the original known-good
// baseline). These are deliberately generous, not tightly tuned:
// they exist to catch "the page structure changed and we're now
// parsing garbage," not to second-guess a genuinely unusual year.
const MIN_PLAUSIBLE_PRICE = 1000;
const MAX_PLAUSIBLE_PRICE = 50000000;
const MAX_PLAUSIBLE_PROPERTIES = 200;

// Captures sold date, price range, represented role, status, and
// MLS number for one listing item. The MLS number isn't used for
// the math — it's a unique-ish anchor so duplicate/overlapping
// matches (e.g. if pagination ever double-serves a boundary item)
// can be caught and skipped rather than silently double-counted.
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [3000, 8000, 15000]; // between attempts 1→2, 2→3, 3→4

// Retries a blocked/failed fetch a few times with increasing delay
// before giving up on this page entirely. Observed evidence across
// multiple runs shows genuinely inconsistent results from the same
// source (one run got served empty content, another got a hard
// 403) — that inconsistency means retrying within the same run has
// a real chance of succeeding, not just waiting for the next
// scheduled run. This still fails soft (never throws past this
// function's caller treating it as a skip) if every attempt fails.
async function fetchPageWithRetry(pageNum) {
    let lastError;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
            return await fetchPageOnce(pageNum);
        } catch (err) {
            lastError = err;
            const isLastAttempt = attempt === RETRY_ATTEMPTS;
            console.warn(`Page ${pageNum}, attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${err.message}`);
            if (!isLastAttempt) {
                await sleep(RETRY_DELAYS_MS[attempt - 1]);
            }
        }
    }

    throw lastError;
}

async function fetchPageOnce(pageNum) {
    const url = `${BASE_URL}?${QUERY}&page=${pageNum}`;
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

// Does the actual scrape + compute. Throws on anything that means
// "couldn't get trustworthy data this time" — every throw here is
// caught by main() and treated as a soft, logged skip, never a hard
// failure. Nothing in here writes to disk; it only returns a result
// or throws.
async function computeStats() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRAILING_DAYS);

    const soldMidpoints = [];
    const seenMlsNumbers = new Set();
    let reachedCutoff = false;
    let skippedGarbled = 0;
    let skippedDuplicate = 0;
    let previousPageText = null;

    for (let pageNum = 1; pageNum <= MAX_PAGES && !reachedCutoff; pageNum++) {
        const text = await fetchPageWithRetry(pageNum);

        if (text === previousPageText) {
            // Defensive: if pagination is ever broken and HAR serves
            // the same content for consecutive page numbers, stop
            // rather than uselessly re-fetching up to MAX_PAGES times.
            // The dedup logic below would still prevent bad data even
            // without this, but there's no reason to keep hammering
            // HAR's servers once we can tell we're going in circles.
            console.warn(`Page ${pageNum} returned identical content to the previous page — stopping pagination early.`);
            break;
        }
        previousPageText = text;

        const items = [...text.matchAll(ITEM_PATTERN)];

        if (items.length === 0) break; // end of pagination, or nothing parseable

        for (const [, dateStr, lowStr, highStr, , status, mlsNum] of items) {
            if (seenMlsNumbers.has(mlsNum)) {
                skippedDuplicate++;
                continue;
            }
            seenMlsNumbers.add(mlsNum);

            const soldDate = parseDate(dateStr);
            if (soldDate === null) {
                skippedGarbled++;
                continue;
            }

            if (soldDate < cutoff) {
                // Sorted newest-first — everything after this is older
                // still. Finish this page's remaining items, fetch no more.
                reachedCutoff = true;
                continue;
            }

            if (status !== "Sold") continue; // exclude rentals, not an error

            const low = parsePrice(lowStr);
            const high = parsePrice(highStr);

            const isPlausible =
                low !== null && high !== null &&
                low <= high &&
                low >= MIN_PLAUSIBLE_PRICE && high <= MAX_PLAUSIBLE_PRICE;

            if (!isPlausible) {
                skippedGarbled++;
                continue;
            }

            soldMidpoints.push((low + high) / 2);
        }
    }

    if (skippedDuplicate > 0) {
        console.warn(`Skipped ${skippedDuplicate} duplicate MLS# match(es).`);
    }
    if (skippedGarbled > 0) {
        console.warn(`Skipped ${skippedGarbled} item(s) with unparseable/implausible data.`);
    }

    if (soldMidpoints.length === 0) {
        throw new Error(
            "Found zero trailing-12-month sold transactions. Either genuinely no sales in " +
            "the window, or the source page didn't return usable content this run."
        );
    }

    if (soldMidpoints.length > MAX_PLAUSIBLE_PROPERTIES) {
        throw new Error(
            `Found ${soldMidpoints.length} sold transactions, which is implausibly high — ` +
            `likely a parsing malfunction rather than real data. Refusing to publish.`
        );
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
        source: `${BASE_URL}?${QUERY}`,
        lastUpdated: new Date().toISOString()
    };
}

async function main() {
    let data;

    try {
        data = await computeStats();
    } catch (err) {
        // Soft failure — log clearly, touch nothing, exit successfully.
        // The GitHub Action will show green; data/stats.json keeps
        // whatever it already had from the last successful run.
        console.warn("Stats sync skipped this run:", err.message);
        console.warn("Leaving data/stats.json unchanged. Will retry on the next scheduled run.");
        return;
    }

    try {
        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
        console.log("Wrote", OUTPUT_PATH, data);
    } catch (err) {
        // A genuine failure (disk/permissions) — this one IS worth
        // failing loudly for, since it's not HAR's fault and won't
        // fix itself by waiting for tomorrow.
        console.error("Failed to write stats file:", err.message);
        process.exitCode = 1;
    }
}

main().catch((err) => {
    // Absolute last resort — should be unreachable given the try/catch
    // above, but guarantees nothing here can crash with an unhandled
    // rejection and produce a confusing raw stack trace in the logs.
    console.error("Unexpected error in stats sync:", err);
    process.exitCode = 1;
});

// ------------------------------------------------------------
// Cadence Realty — Stats Sync (HAR-direct version)
//
// Fetches Cadence Realty Services' own trailing-12-month sold
// transactions directly from HAR's public AWS IDX tool and computes
// Value of Real Estate Sold / Number of Properties Sold / Average
// Listing Price from them, writing the result to data/stats.json.
//
// WHY MID-PRICE-RANGE AVERAGE, NOT EXACT PRICES:
// HAR/HRIS does not publish exact closed sale prices publicly,
// anywhere — confirmed directly against three different HAR pages
// (a public listing detail page, the public brokerage sold list, and
// this exact AWS IDX tool scoped to Savannah Burns' own cid). Every
// one of them shows only a $0–40K-wide bucketed "Sold Price Range"
// (e.g. "$325,001 - $370,000"), never a single number. Exact prices
// only exist inside HAR's authenticated back-office member system,
// a completely different, non-embeddable product this script has no
// access to.
//
// So: this computes each sale's estimated price as the midpoint of
// its published range, then sums/counts/averages those — the same
// category of estimate as the "AVM Value" comparables HAR itself
// shows on every listing (CoreLogic, Black Knight, etc.). This is
// disclosed on the About page itself ("Mid-Price Range Average"),
// not presented as exact.
//
// SOURCE: https://www.har.com/idx/mls/sold/listing?sitetype=aws&cid=736316&allmls=n&mlsorgid=1
// This list mixes actual home SALES and RENTALS together, each
// tagged "Sold" or "Rented" — only "Sold" status items count toward
// these stats. Sorted newest-first by sold date, which this script
// relies on to know when to stop paginating.
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
const MAX_PAGES = 25; // safety net against a runaway loop, not an expected ceiling

// Matches one sold/rented item's block of text: sold date, price
// range, represented role, then the status word. Relies on that
// exact ordering holding across every item, which it does on every
// page checked so far. Non-greedy so each match stays within one
// item rather than spanning into the next.
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
    const url = `${BASE_URL}?${QUERY}&page=${pageNum}`;
    const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CadenceStatsSync/1.0)" }
    });

    if (!res.ok) {
        throw new Error(`Fetch failed on page ${pageNum}: ${res.status} ${res.statusText}`);
    }

    return stripTags(await res.text());
}

async function main() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRAILING_DAYS);

    const soldMidpoints = [];
    let reachedCutoff = false;

    for (let pageNum = 1; pageNum <= MAX_PAGES && !reachedCutoff; pageNum++) {
        const text = await fetchPage(pageNum);
        const items = [...text.matchAll(ITEM_PATTERN)];

        if (items.length === 0) {
            // No more items — either we've paginated past the end of
            // the list, or the page layout changed. Either way, stop.
            break;
        }

        for (const [, dateStr, lowStr, highStr, , status] of items) {
            const soldDate = parseDate(dateStr);

            if (soldDate < cutoff) {
                // Sorted newest-first, so once we hit anything older
                // than our window, everything after is older still.
                // Finish this page's remaining items, but fetch no more.
                reachedCutoff = true;
                continue;
            }

            if (status !== "Sold") continue; // exclude rentals

            const low = parsePrice(lowStr);
            const high = parsePrice(highStr);
            if (low === null || high === null) continue;

            soldMidpoints.push((low + high) / 2);
        }
    }

    if (soldMidpoints.length === 0) {
        throw new Error(
            "Found zero trailing-12-month sold transactions. Either Cadence genuinely had " +
            "no sales in the window (unlikely), or the page layout changed and this script's " +
            "regex pattern needs updating to match."
        );
    }

    const valueSold = Math.round(soldMidpoints.reduce((sum, n) => sum + n, 0));
    const propertiesSold = soldMidpoints.length;
    const averagePrice = Math.round(valueSold / propertiesSold);

    const data = {
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

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2) + "\n");
    console.log("Wrote", OUTPUT_PATH, data);
}

main().catch((err) => {
    console.error("Stats sync failed:", err.message);
    process.exit(1);
});

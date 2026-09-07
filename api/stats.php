<?php
// ------------------------------------------------------------
// Cadence Realty — Live Stats API (PHP version)
//
// Same job as cloudflare-worker/stats-worker.js, for whenever this
// site moves off GitHub Pages onto real PHP hosting (Namecheap,
// HostGator, or similar cPanel/LAMP shared hosting). Runs server-
// side, on the same server as the site itself — no CORS concerns
// (same-origin), no third-party account needed.
//
// See scripts/fetch-stats.js for the full "why mid-price-range
// average, not exact prices" explanation — same logic here.
//
// CACHING: results are cached to a local file for 10 minutes (see
// CACHE_SECONDS). Re-scraping HAR on every single visitor's page
// load would hammer HAR's servers and risk this server's IP getting
// rate-limited or blocked. If a live fetch ever fails while a
// previous cache file still exists, that last-known-good cache is
// served instead of an error — the page should never show broken
// data just because HAR was briefly unreachable.
//
// SETUP: upload this whole api/ folder to the site's PHP hosting.
// Make sure api/cache/ is writable by PHP (chmod 755 or 775 is
// usually enough on shared hosting). No configuration beyond that —
// about.html already knows to look for this at /api/stats.php.
// ------------------------------------------------------------

header("Content-Type: application/json");

const SOURCE_BASE_URL = "https://www.har.com/idx/mls/sold/listing";
const SOURCE_QUERY = "sitetype=aws&cid=736316&allmls=n&mlsorgid=1&isSiteIdx=1";
const TRAILING_DAYS = 365;
const MAX_PAGES = 25;
const CACHE_SECONDS = 600; // 10 minutes
const CACHE_FILE = __DIR__ . "/cache/stats-cache.json";

function fetch_page(int $pageNum): string {
    $url = SOURCE_BASE_URL . "?" . SOURCE_QUERY . "&page=" . $pageNum;

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, "Mozilla/5.0 (compatible; CadenceStatsAPI/1.0)");
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($html === false || $httpCode >= 400) {
        throw new Exception("Fetch failed on page $pageNum: HTTP $httpCode $error");
    }

    return strip_tags_and_normalize($html);
}

function strip_tags_and_normalize(string $html): string {
    $text = preg_replace('/<script[\s\S]*?<\/script>/i', ' ', $html);
    $text = preg_replace('/<style[\s\S]*?<\/style>/i', ' ', $text);
    $text = strip_tags($text);
    $text = str_replace('&amp;', '&', $text);
    $text = preg_replace('/\s+/', ' ', $text);
    return $text;
}

function compute_stats(): array {
    $cutoff = new DateTime();
    $cutoff->modify("-" . TRAILING_DAYS . " days");

    $soldMidpoints = [];
    $reachedCutoff = false;

    $pattern = '/Sold Date:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?\$([\d,]+)\s*-\s*\$([\d,]+)[\s\S]*?Represented:\s*(Seller|Buyer)[\s\S]*?(Sold|Rented)/';

    for ($pageNum = 1; $pageNum <= MAX_PAGES && !$reachedCutoff; $pageNum++) {
        $text = fetch_page($pageNum);

        preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);

        if (count($matches) === 0) break;

        foreach ($matches as $m) {
            $soldDate = DateTime::createFromFormat("m/d/Y", $m[1]);

            if ($soldDate < $cutoff) {
                $reachedCutoff = true;
                continue;
            }

            if ($m[5] !== "Sold") continue; // exclude rentals

            $low = (int) str_replace(",", "", $m[2]);
            $high = (int) str_replace(",", "", $m[3]);

            $soldMidpoints[] = ($low + $high) / 2;
        }
    }

    if (count($soldMidpoints) === 0) {
        throw new Exception("Found zero trailing-12-month sold transactions — source page layout may have changed.");
    }

    $valueSold = (int) round(array_sum($soldMidpoints));
    $propertiesSold = count($soldMidpoints);
    $averagePrice = (int) round($valueSold / $propertiesSold);

    return [
        "valueSold" => $valueSold,
        "propertiesSold" => $propertiesSold,
        "averagePrice" => $averagePrice,
        "periodLabel" => "Trailing 12 months",
        "methodology" => "Mid-price range average",
        "methodologyNote" => "HAR does not publish exact closed sale prices publicly. Each sale's price is estimated as the midpoint of HAR's published sold-price range, then summed/averaged.",
        "source" => SOURCE_BASE_URL . "?" . SOURCE_QUERY,
        "lastUpdated" => (new DateTime())->format(DateTime::ATOM)
    ];
}

function read_cache(): ?array {
    if (!file_exists(CACHE_FILE)) return null;
    $raw = file_get_contents(CACHE_FILE);
    $data = json_decode($raw, true);
    return $data ?: null;
}

function write_cache(array $data): void {
    $dir = dirname(CACHE_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    file_put_contents(CACHE_FILE, json_encode($data, JSON_PRETTY_PRINT));
}

// ------------------------------------------------------------

$cached = read_cache();

if ($cached && isset($cached["lastUpdated"])) {
    $age = time() - strtotime($cached["lastUpdated"]);
    if ($age < CACHE_SECONDS) {
        echo json_encode($cached);
        exit;
    }
}

try {
    $fresh = compute_stats();
    write_cache($fresh);
    echo json_encode($fresh);
} catch (Exception $e) {
    // Live fetch failed — serve the last known-good cache rather than
    // an error, if one exists at all, even if it's older than the
    // normal 10-minute window. A stale-but-real number beats a broken
    // page. Only return an actual error if there's truly nothing to
    // fall back on (e.g. this is the very first request ever made).
    if ($cached) {
        echo json_encode($cached);
    } else {
        http_response_code(502);
        echo json_encode(["error" => $e->getMessage()]);
    }
}

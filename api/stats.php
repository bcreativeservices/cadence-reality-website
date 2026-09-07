<?php
// ------------------------------------------------------------
// Cadence Realty — Live Stats API (PHP version, hardened)
//
// Same job as scripts/fetch-stats.js — see that file's header for
// the full "why mid-price-range average" and "why this is defensive
// about failure" explanations. For whenever this site moves off
// GitHub Pages onto real PHP hosting (Namecheap, HostGator, etc.).
// Runs server-side, same-origin, no CORS concerns, no third-party
// account needed.
//
// CACHING & FAILURE BEHAVIOR: results are cached to a local file for
// 10 minutes. If a live fetch ever fails or returns implausible data,
// the last known-good cache is served instead — silently, with no
// error surfaced to the visitor — and only actually errors out if
// there is truly no prior cache to fall back on (e.g. the very first
// request ever made, before any successful run).
//
// SETUP: upload this whole api/ folder to the site's PHP hosting.
// Make sure api/cache/ is writable by PHP (chmod 755 or 775 is
// usually enough on shared hosting). No other configuration needed.
// ------------------------------------------------------------

header("Content-Type: application/json");

// Best-effort — some hosts ignore this, but on ones that respect it,
// this gives enough headroom for the retry logic below (worst case
// ~18s per page) without hitting a default 30s script-kill limit.
@set_time_limit(60);

const SOURCE_BASE_URL = "https://www.har.com/idx/mls/sold/listing";
const SOURCE_QUERY = "sitetype=aws&cid=736316&allmls=n&mlsorgid=1&isSiteIdx=1";
const TRAILING_DAYS = 365;
const MAX_PAGES = 25;
const CACHE_SECONDS = 600; // 10 minutes
const CACHE_FILE = __DIR__ . "/cache/stats-cache.json";
const FETCH_TIMEOUT_SECONDS = 8; // short — see retry note below on why

const MIN_PLAUSIBLE_PRICE = 1000;
const MAX_PLAUSIBLE_PRICE = 50000000;
const MAX_PLAUSIBLE_PROPERTIES = 200;

function fetch_page(int $pageNum): string {
    $url = SOURCE_BASE_URL . "?" . SOURCE_QUERY . "&page=" . $pageNum;

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language: en-US,en;q=0.9"
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, FETCH_TIMEOUT_SECONDS);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($html === false || $httpCode >= 400) {
        throw new Exception("HTTP $httpCode $error on page $pageNum");
    }

    return strip_tags_and_normalize($html);
}

// Retries a couple of times with a short delay before giving up on
// this page. Kept deliberately brief (unlike the GitHub Action
// version's longer retry budget) — most shared PHP hosting kills
// scripts after ~30 seconds by default, so this stays well under
// that even in the worst case (2 attempts x 8s timeout + 2s delay
// = ~18s), leaving headroom for everything else the request does.
function fetch_page_with_retry(int $pageNum): string {
    $attempts = 2;
    $delaySeconds = 2;
    $lastException = null;

    for ($attempt = 1; $attempt <= $attempts; $attempt++) {
        try {
            return fetch_page($pageNum);
        } catch (Exception $e) {
            $lastException = $e;
            error_log("Cadence stats: page $pageNum attempt $attempt/$attempts failed: " . $e->getMessage());
            if ($attempt < $attempts) {
                sleep($delaySeconds);
            }
        }
    }

    throw $lastException;
}

function strip_tags_and_normalize(string $html): string {
    $text = preg_replace('/<script[\s\S]*?<\/script>/i', ' ', $html);
    $text = preg_replace('/<style[\s\S]*?<\/style>/i', ' ', $text);
    $text = strip_tags($text);
    $text = str_replace('&amp;', '&', $text);
    $text = preg_replace('/\s+/', ' ', $text);
    return $text;
}

// Throws on anything that means "couldn't get trustworthy data this
// time" — every throw here is caught by the caller and treated as a
// reason to fall back to the last cached result, never as a reason
// to show the visitor a broken page.
function compute_stats(): array {
    $cutoff = DateTime::createFromFormat("Y-m-d", date("Y-m-d"));
    $cutoff->modify("-" . TRAILING_DAYS . " days");

    $soldMidpoints = [];
    $seenMlsNumbers = [];
    $reachedCutoff = false;
    $skippedGarbled = 0;
    $skippedDuplicate = 0;
    $previousPageText = null;

    $pattern = '/Sold Date:\s*(\d{2}\/\d{2}\/\d{4})[\s\S]*?\$([\d,]+)\s*-\s*\$([\d,]+)[\s\S]*?Represented:\s*(Seller|Buyer)[\s\S]*?(Sold|Rented)[\s\S]*?MLS#\s*(\d+)/';

    for ($pageNum = 1; $pageNum <= MAX_PAGES && !$reachedCutoff; $pageNum++) {
        $text = fetch_page_with_retry($pageNum);

        if ($text === $previousPageText) {
            // Defensive: broken pagination serving the same content
            // repeatedly. Stop rather than hammering HAR needlessly.
            break;
        }
        $previousPageText = $text;

        preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);

        if (count($matches) === 0) break;

        foreach ($matches as $m) {
            $mlsNum = $m[6];
            if (isset($seenMlsNumbers[$mlsNum])) {
                $skippedDuplicate++;
                continue;
            }
            $seenMlsNumbers[$mlsNum] = true;

            $soldDate = DateTime::createFromFormat("m/d/Y", $m[1]);
            if ($soldDate === false) {
                $skippedGarbled++;
                continue;
            }

            if ($soldDate < $cutoff) {
                $reachedCutoff = true;
                continue;
            }

            if ($m[5] !== "Sold") continue; // exclude rentals, not an error

            $low = (int) str_replace(",", "", $m[2]);
            $high = (int) str_replace(",", "", $m[3]);

            $isPlausible = $low <= $high
                && $low >= MIN_PLAUSIBLE_PRICE
                && $high <= MAX_PLAUSIBLE_PRICE;

            if (!$isPlausible) {
                $skippedGarbled++;
                continue;
            }

            $soldMidpoints[] = ($low + $high) / 2;
        }
    }

    if ($skippedDuplicate > 0) {
        error_log("Cadence stats: skipped $skippedDuplicate duplicate MLS# match(es).");
    }
    if ($skippedGarbled > 0) {
        error_log("Cadence stats: skipped $skippedGarbled item(s) with unparseable/implausible data.");
    }

    if (count($soldMidpoints) === 0) {
        throw new Exception("Found zero trailing-12-month sold transactions this run.");
    }

    if (count($soldMidpoints) > MAX_PLAUSIBLE_PROPERTIES) {
        throw new Exception(
            "Found " . count($soldMidpoints) . " sold transactions, implausibly high — " .
            "likely a parsing malfunction. Refusing to publish."
        );
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
    // Live fetch failed or returned implausible data — serve the last
    // known-good cache if one exists, even if older than the normal
    // 10-minute window. A stale-but-real number beats a broken page.
    error_log("Cadence stats sync failed, falling back to cache: " . $e->getMessage());

    if ($cached) {
        echo json_encode($cached);
    } else {
        http_response_code(502);
        echo json_encode(["error" => "No data available yet and live fetch failed."]);
    }
}

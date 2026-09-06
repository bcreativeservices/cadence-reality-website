// ------------------------------------------------------------
// Cadence Realty — Predictive Property Search
// Replaces the old js/har-search.js, which opened a new tab to
// https://search.har.com/idx/doSearch.cfm with guessed, wrong-case
// parameter names (FULL_BED_NUM, ZIP_CODE, etc.) — that endpoint and
// those field names don't match HAR's real IDX system, which is why
// searches came back broken or empty.
//
// This version:
//   1. Uses the SAME LocationIQ autocomplete engine already proven
//      out on valuation.html (see js/address-search.js) — but with
//      addressdetails=1, so we get structured city/ZIP/street data
//      instead of just a display string.
//   2. Sends the visitor to HAR's real, confirmed endpoint —
//      https://www.har.com/idx/mls/search — using the real,
//      lower-case field names confirmed from an actual HAR search
//      (city, zip_code, streetaddress, bedroom_min, full_bath_min,
//      listing_price_min/max), pre-filling that form with whatever
//      the visitor entered here.
//   3. Navigates in the SAME tab (no window.open/new tab) — HAR's
//      page for this account (cid=736316) carries Cadence's own
//      header/branding, so this reads as a continuation of the site,
//      not a jarring hop to a third-party tool.
//
// NOTE — Property Type is intentionally NOT sent as a filter here.
// HAR's PROPERTY_CLASS_ID / propsubtype codes were never confirmed
// against a real, working search (the old code's 1/2/3/5 mapping was
// a guess) — sending an unconfirmed value risks silently zeroing out
// results again, the exact bug this rewrite fixes. Once real values
// are confirmed with HAR, that filter can be reintroduced below.
//
// Supports multiple independent instances on one page (e.g. the
// homepage hero AND the Buy search page each have their own).
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const LOCATIONIQ_TOKEN = "pk.59a376113c25f0cbeffd1581de2e2662";
    const HOUSTON_VIEWBOX = "-94.8,30.3,-96.0,29.3";
    const HAR_CID = "736316";
    const HAR_FORM_ENDPOINT = "https://www.har.com/idx/mls/search";

    function buildHarUrl({ streetaddress, city, zipCode, minPrice, maxPrice, beds, baths }) {
        const params = new URLSearchParams({
            sitetype: "aws",
            cid: HAR_CID,
            allmls: "y",
            for_sale: "1",
            mlsorgid: "1"
        });

        if (streetaddress) params.set("streetaddress", streetaddress);
        if (city) params.set("city", city);
        if (zipCode) params.set("zip_code", zipCode);
        if (minPrice) params.set("listing_price_min", minPrice);
        if (maxPrice) params.set("listing_price_max", maxPrice);
        if (beds) params.set("bedroom_min", beds);
        if (baths) params.set("full_bath_min", baths);
        params.set("sort", "listprice desc");

        return `${HAR_FORM_ENDPOINT}?${params.toString()}`;
    }

    // Pulls city / ZIP / street out of a LocationIQ result's
    // structured `address` object (requires addressdetails=1 on the
    // request). Falls back gracefully — any missing piece is just
    // left out of the HAR query rather than sent as "undefined".
    function extractLocationParts(place) {
        const addr = place && place.address ? place.address : {};
        const city = addr.city || addr.town || addr.village || addr.suburb || "";
        const zipCode = addr.postcode || "";
        const streetaddress = [addr.house_number, addr.road].filter(Boolean).join(" ");
        return { streetaddress, city, zipCode };
    }

    function attachInstance({ formId, inputId, suggestionsId, minPriceId, maxPriceId, bedsId, bathsId }) {
        const form = document.getElementById(formId);
        if (!form) return; // this page doesn't have this particular search instance

        const input = document.getElementById(inputId);
        const suggestionsList = document.getElementById(suggestionsId);
        const fieldWrap = input.closest(".hero-search-location") || input.parentElement;

        let debounceTimer = null;
        let currentResults = [];
        let activeIndex = -1;
        let selectedLocation = null; // { streetaddress, city, zipCode }

        function setLoading(isLoading) {
            if (fieldWrap) fieldWrap.classList.toggle("is-loading", isLoading);
        }

        function renderSuggestions(results) {
            currentResults = results;
            activeIndex = -1;
            suggestionsList.innerHTML = "";

            if (!results.length) {
                suggestionsList.hidden = true;
                return;
            }

            results.forEach((place) => {
                const li = document.createElement("li");
                li.textContent = place.display_name;
                li.setAttribute("role", "option");
                li.addEventListener("click", () => selectSuggestion(place));
                li.addEventListener("mouseenter", () => {
                    activeIndex = currentResults.indexOf(place);
                    updateActiveDescendant();
                });
                suggestionsList.appendChild(li);
            });

            suggestionsList.hidden = false;
        }

        function updateActiveDescendant() {
            const items = suggestionsList.querySelectorAll("li");
            items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
            if (activeIndex >= 0 && items[activeIndex]) {
                items[activeIndex].scrollIntoView({ block: "nearest" });
            }
        }

        function selectSuggestion(place) {
            input.value = place.display_name;
            selectedLocation = extractLocationParts(place);
            suggestionsList.hidden = true;
        }

        function fetchSuggestions(query) {
            if (!query || query.length < 3) {
                suggestionsList.hidden = true;
                return;
            }

            setLoading(true);

            const url = `https://api.locationiq.com/v1/autocomplete` +
                `?key=${LOCATIONIQ_TOKEN}` +
                `&q=${encodeURIComponent(query)}` +
                `&countrycodes=us` +
                `&viewbox=${HOUSTON_VIEWBOX}` +
                `&bounded=1` +
                `&addressdetails=1` +
                `&limit=5` +
                `&format=json`;

            fetch(url)
                .then((res) => res.json())
                .then((data) => renderSuggestions(Array.isArray(data) ? data : []))
                .catch(() => {
                    suggestionsList.hidden = true;
                })
                .finally(() => setLoading(false));
        }

        input.addEventListener("input", () => {
            selectedLocation = null; // typing again invalidates any prior selection
            clearTimeout(debounceTimer);
            const query = input.value.trim();
            debounceTimer = setTimeout(() => fetchSuggestions(query), 300);
        });

        input.addEventListener("keydown", (e) => {
            const isOpen = !suggestionsList.hidden && currentResults.length > 0;

            if (e.key === "ArrowDown") {
                if (!isOpen) return;
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
                updateActiveDescendant();
                return;
            }

            if (e.key === "ArrowUp") {
                if (!isOpen) return;
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                updateActiveDescendant();
                return;
            }

            if (e.key === "Escape") {
                suggestionsList.hidden = true;
                return;
            }

            if (e.key === "Enter" && isOpen && activeIndex >= 0) {
                // Selecting a highlighted suggestion with Enter should
                // just fill the field, not also submit the form —
                // mirrors valuation.html's behavior, and stops a
                // double-Enter from submitting before someone's had a
                // chance to see what they picked.
                e.preventDefault();
                selectSuggestion(currentResults[activeIndex]);
            }
        });

        document.addEventListener("click", (e) => {
            if (!e.target.closest(`#${suggestionsId}`) && e.target !== input) {
                suggestionsList.hidden = true;
            }
        });

        // Resolves whatever's currently typed into { streetaddress, city,
        // zipCode }, using the already-selected suggestion if there is
        // one, otherwise geocoding the raw text. Calls back with `null`
        // if the location can't be resolved (search still proceeds —
        // just without a location filter — rather than blocking submit).
        function resolveLocation(callback) {
            const query = input.value.trim();

            if (!query) {
                callback(null);
                return;
            }

            if (selectedLocation) {
                callback(selectedLocation);
                return;
            }

            const url = `https://api.locationiq.com/v1/search` +
                `?key=${LOCATIONIQ_TOKEN}` +
                `&q=${encodeURIComponent(query)}` +
                `&countrycodes=us` +
                `&viewbox=${HOUSTON_VIEWBOX}` +
                `&bounded=1` +
                `&addressdetails=1` +
                `&limit=1` +
                `&format=json`;

            fetch(url)
                .then((res) => res.json())
                .then((data) => {
                    const place = Array.isArray(data) ? data[0] : null;
                    callback(place ? extractLocationParts(place) : null);
                })
                .catch(() => callback(null));
        }

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            suggestionsList.hidden = true;
            setLoading(true);

            resolveLocation((location) => {
                setLoading(false);

                const minPrice = minPriceId ? document.getElementById(minPriceId).value : "";
                const maxPrice = maxPriceId ? document.getElementById(maxPriceId).value : "";
                const beds = bedsId ? document.getElementById(bedsId).value : "";
                const baths = bathsId ? document.getElementById(bathsId).value : "";

                const url = buildHarUrl({
                    streetaddress: location ? location.streetaddress : "",
                    city: location ? location.city : "",
                    zipCode: location ? location.zipCode : "",
                    minPrice,
                    maxPrice,
                    beds,
                    baths
                });

                // Same tab, not a new one — this is a continuation of
                // the visitor's search, not a hop to a separate tool.
                window.location.href = url;
            });
        });
    }

    // Homepage hero search
    attachInstance({
        formId: "heroSearchForm",
        inputId: "heroLocation",
        suggestionsId: "heroAddressSuggestions",
        minPriceId: "heroMinPrice",
        maxPriceId: "heroMaxPrice",
        bedsId: "heroBeds",
        bathsId: "heroBaths"
    });

    // Buy / listing-search page's primary search
    attachInstance({
        formId: "listingSearchForm",
        inputId: "listingLocation",
        suggestionsId: "listingAddressSuggestions",
        minPriceId: "listingMinPrice",
        maxPriceId: "listingMaxPrice",
        bedsId: "listingBeds",
        bathsId: "listingBaths"
    });
});

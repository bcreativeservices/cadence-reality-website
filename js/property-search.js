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
//      out on valuation.html — but with addressdetails=1, so we get
//      structured city/ZIP/street data instead of just a display
//      string.
//   2. Shows REAL RESULTS directly, in one click, embedded on our
//      own page — never a navigation to har.com, and never a second
//      click required inside an embedded form. This uses HAR's
//      public, token-free results endpoint:
//        https://www.har.com/houston/realestate/for_sale
//      confirmed (against real, independently-indexed HAR pages
//      showing these exact params in live use) to accept
//      bedroom_min, full_bath_min, listing_price_min, and
//      listing_price_max as direct GET params that filter results
//      immediately, no form submission or token needed.
//
//      NOTE — this endpoint is scoped to the Houston metro generally
//      (not a specific ZIP/subdivision, and not filtered to only
//      Cadence's own cid=736316 listings the way HAR's AWS embed
//      tool is). That's a deliberate, disclosed trade-off: it's the
//      only way confirmed to give one-click real results without
//      guessing at unconfirmed parameters (the same mistake that
//      caused the original broken-search bug). Precise ZIP/
//      subdivision/school-district filtering remains available via
//      the "Advanced Search" accordion below, which still uses HAR's
//      full raw form for visitors who want that level of precision.
//
// NOTE — Property Type is intentionally NOT sent as a filter here.
// HAR's PROPERTY_CLASS_ID / propsubtype codes were never confirmed
// against a real, working search — sending an unconfirmed value
// risks silently zeroing out results again. Once real values are
// confirmed with HAR, that filter can be reintroduced.
//
// Supports multiple independent instances on one page (e.g. the
// homepage hero AND the Buy search page each have their own).
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const LOCATIONIQ_TOKEN = "pk.59a376113c25f0cbeffd1581de2e2662";
    const HOUSTON_VIEWBOX = "-94.8,30.3,-96.0,29.3";
    const HAR_RESULTS_ENDPOINT = "https://www.har.com/houston/realestate/for_sale";
    const RESULTS_IFRAME_ID = "listingResultsFrame";
    const RESULTS_SECTION_ID = "searchResultsSection";

    // Builds a URL that shows REAL, already-filtered results directly
    // — no intermediate form, no second click. Only uses the three
    // params independently confirmed to work on this endpoint.
    function buildHarResultsUrl({ minPrice, maxPrice, beds, baths }) {
        const params = new URLSearchParams({ view: "map" });

        if (minPrice) params.set("listing_price_min", minPrice);
        if (maxPrice) params.set("listing_price_max", maxPrice);
        if (beds) params.set("bedroom_min", beds);
        if (baths) params.set("full_bath_min", baths);

        return `${HAR_RESULTS_ENDPOINT}?${params.toString()}`;
    }

    // Reveals the embedded results iframe on THIS page and points it
    // at the given HAR URL. Never touches window.location — the
    // visitor never leaves our site. Only does anything on pages
    // that actually have a results iframe (i.e. listing-search.html).
    function showResults(harUrl) {
        const section = document.getElementById(RESULTS_SECTION_ID);
        const iframe = document.getElementById(RESULTS_IFRAME_ID);
        if (!section || !iframe) return false;

        iframe.src = harUrl;
        section.hidden = false;
        if (typeof section.scrollIntoView === "function") {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return true;
    }

    // Pulls city / ZIP / street out of a LocationIQ result's
    // structured `address` object (requires addressdetails=1 on the
    // request). Not currently used to filter HAR results (see note
    // above) — kept for the location text display and for forwarding
    // to listing-search.html, where it may become useful again if a
    // confirmed location-filtering param is found for this endpoint.
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
        // if the location can't be resolved. Not used to filter results
        // right now (see notes above), but still resolved so the
        // display text and forwarded params stay meaningful.
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

                // Real results, one click, embedded — no intermediate
                // form, no second click required.
                const harUrl = buildHarResultsUrl({ minPrice, maxPrice, beds, baths });
                const shown = showResults(harUrl);
                if (shown) return;

                // Otherwise (the homepage hero has no results iframe of
                // its own) — carry the search to the Buy page via our
                // OWN url params, where it displays embedded immediately
                // on load. Still same-site navigation to our own domain,
                // never to har.com directly.
                const forwardParams = new URLSearchParams();
                if (input.value.trim()) forwardParams.set("loc", input.value.trim());
                if (minPrice) forwardParams.set("min", minPrice);
                if (maxPrice) forwardParams.set("max", maxPrice);
                if (beds) forwardParams.set("beds", beds);
                if (baths) forwardParams.set("baths", baths);

                window.location.href = `listing-search.html?${forwardParams.toString()}`;
            });
        });
    }

    // If we've arrived on the Buy page carrying search criteria from
    // the homepage hero (via the forwardParams above), show results
    // immediately on load and reflect what was searched in the visible
    // fields — rather than making the visitor re-type/re-submit the
    // same search they just ran on the homepage.
    function restoreFromForwardedParams() {
        const params = new URLSearchParams(window.location.search);
        if ([...params.keys()].length === 0) return; // nothing forwarded

        const locInput = document.getElementById("listingLocation");
        if (locInput && params.get("loc")) locInput.value = params.get("loc");

        const minSelect = document.getElementById("listingMinPrice");
        if (minSelect && params.get("min")) minSelect.value = params.get("min");

        const maxSelect = document.getElementById("listingMaxPrice");
        if (maxSelect && params.get("max")) maxSelect.value = params.get("max");

        const bedsSelect = document.getElementById("listingBeds");
        if (bedsSelect && params.get("beds")) bedsSelect.value = params.get("beds");

        const bathsSelect = document.getElementById("listingBaths");
        if (bathsSelect && params.get("baths")) bathsSelect.value = params.get("baths");

        const harUrl = buildHarResultsUrl({
            minPrice: params.get("min") || "",
            maxPrice: params.get("max") || "",
            beds: params.get("beds") || "",
            baths: params.get("baths") || ""
        });

        showResults(harUrl);
    }

    // "Browse By Category" shortcut buttons — same embedded-results
    // pattern as the search form itself. These used to be plain <a>
    // links straight to har.com (the same "abandons our site" problem
    // as the search bar); now they reveal results inline instead.
    document.querySelectorAll(".js-shortcut-search").forEach((button) => {
        button.addEventListener("click", () => {
            const harUrl = buildHarResultsUrl({
                minPrice: button.dataset.min || "",
                maxPrice: button.dataset.max || "",
                beds: button.dataset.beds || "",
                baths: button.dataset.baths || ""
            });
            showResults(harUrl);
        });
    });

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

    restoreFromForwardedParams();
});

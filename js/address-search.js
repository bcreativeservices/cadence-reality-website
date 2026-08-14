// ------------------------------------------------------------
// Cadence Realty — Address Search + Valuation Lead Capture
// (valuation.html only — this script no-ops on every other page)
//
// Two third-party services power this, both with generous free tiers,
// neither requiring a backend server, and — importantly — neither
// requiring a credit card to sign up:
//   - LocationIQ: address autocomplete suggestions + a static map image
//     (5,000 requests/day free, no card — docs.locationiq.com)
//   - Web3Forms: delivers the lead form submission by email
//
// SETUP REQUIRED: replace LOCATIONIQ_TOKEN below with a real token
// before this goes live — sign up free at locationiq.com (no credit
// card needed), then grab your Access Token from the dashboard. Without
// it, address suggestions and the map simply won't load; everything
// else on the page (the form, the HAR accordion) is unaffected.
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("valuationAddressInput");
    if (!input) return; // this page doesn't have the address search widget

    const searchBar = input.closest(".address-search-bar");
    const searchBtn = document.getElementById("valuationSearchBtn");
    const suggestionsList = document.getElementById("addressSuggestions");
    const resultSection = document.getElementById("valuationResult");
    const resultAddress = document.getElementById("valuationResultAddress");
    const mapImage = document.getElementById("valuationMapImage");
    const hiddenAddressField = document.getElementById("valuationHiddenAddress");

    // ------------------------------------------------------------
    // LOCATIONIQ SETUP — see setup note above.
    // ------------------------------------------------------------
    const LOCATIONIQ_TOKEN = "pk.59a376113c25f0cbeffd1581de2e2662";

    // Restrict results to greater Houston — a hard filter (bounded=1),
    // not just a ranking hint. Confirmed by direct testing: a soft
    // viewbox hint alone barely mattered (searching "1600 Pennsylvania"
    // still returned the White House and DC/PA results despite the
    // Houston viewbox). Since this tool is specifically for valuing
    // Houston-area homes, a hard boundary is the right behavior here —
    // someone using this almost certainly has a Houston-area property.
    // Format is "max_lon,max_lat,min_lon,min_lat" per LocationIQ's docs.
    const HOUSTON_VIEWBOX = "-94.8,30.3,-96.0,29.3";

    let debounceTimer = null;
    let selectedCoords = null; // [lat, lon]
    let currentResults = [];
    let activeIndex = -1; // keyboard-navigated suggestion, -1 = none

    function setLoading(isLoading) {
        if (searchBar) searchBar.classList.toggle("is-loading", isLoading);
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
            // Hovering with the mouse and navigating with the keyboard
            // should feel like the same "active" state, not two
            // different visual systems.
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
        selectedCoords = [parseFloat(place.lat), parseFloat(place.lon)];
        suggestionsList.hidden = true;
        showResult(place.display_name, selectedCoords);
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
            `&limit=5` +
            `&format=json`;

        fetch(url)
            .then((res) => res.json())
            .then((data) => renderSuggestions(Array.isArray(data) ? data : []))
            .catch(() => {
                // Fail quietly — worst case, no suggestions show and the
                // person can still type a full address and hit Search.
                suggestionsList.hidden = true;
            })
            .finally(() => setLoading(false));
    }

    input.addEventListener("input", () => {
        selectedCoords = null; // typing again invalidates any prior selection
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        debounceTimer = setTimeout(() => fetchSuggestions(query), 300);
    });

    // Keyboard navigation: Up/Down move through suggestions, Enter
    // selects the highlighted one (or falls back to Search if nothing
    // is highlighted), Escape closes the list.
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

        if (e.key === "Enter") {
            e.preventDefault();
            if (isOpen && activeIndex >= 0) {
                selectSuggestion(currentResults[activeIndex]);
            } else {
                searchBtn.click();
            }
        }
    });

    // Close the suggestion dropdown when clicking anywhere outside it
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".address-search-bar")) {
            suggestionsList.hidden = true;
        }
    });

    // "Search": use the already-selected suggestion if there is one,
    // otherwise geocode whatever's currently typed and use the top hit.
    searchBtn.addEventListener("click", () => {
        const query = input.value.trim();
        if (!query) return;

        if (selectedCoords) {
            showResult(input.value, selectedCoords);
            return;
        }

        setLoading(true);

        const url = `https://api.locationiq.com/v1/search` +
            `?key=${LOCATIONIQ_TOKEN}` +
            `&q=${encodeURIComponent(query)}` +
            `&countrycodes=us` +
            `&viewbox=${HOUSTON_VIEWBOX}` +
            `&bounded=1` +
            `&limit=1` +
            `&format=json`;

        fetch(url)
            .then((res) => res.json())
            .then((data) => {
                const place = Array.isArray(data) ? data[0] : null;
                if (place) {
                    selectSuggestion(place);
                } else {
                    alert("We couldn't find that address — please check it and try again.");
                }
            })
            .catch(() => {
                alert("Something went wrong looking up that address. Please try again.");
            })
            .finally(() => setLoading(false));
    });

    function showResult(address, coords) {
        const [lat, lon] = coords;

        resultAddress.textContent = address;
        hiddenAddressField.value = address;

        mapImage.src = `https://maps.locationiq.com/v3/staticmap` +
            `?key=${LOCATIONIQ_TOKEN}` +
            `&center=${lat},${lon}` +
            `&zoom=15` +
            `&size=640x480` +
            `&format=png` +
            `&markers=icon:large-red-cutout|${lat},${lon}`;
        mapImage.alt = `Map showing ${address}`;

        resultSection.hidden = false;

        // Force the staggered fade-in (.result-visible in valuation.css)
        // to replay on every search, not just the first. Removing the
        // class, forcing a reflow (reading offsetHeight), then re-adding
        // it is the standard way to restart a CSS animation — without
        // the reflow read in between, the browser just batches the
        // remove+add together and nothing visibly restarts.
        resultSection.classList.remove("result-visible");
        void resultSection.offsetHeight;
        resultSection.classList.add("result-visible");

        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // ------------------------------------------------------------
    // LEAD FORM SUBMISSION — Web3Forms, no backend required.
    // ------------------------------------------------------------
    const form = document.getElementById("valuationLeadForm");
    const successMsg = document.getElementById("valuationFormSuccess");
    const errorMsg = document.getElementById("valuationFormError");

    if (form) {
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            successMsg.classList.remove("visible");
            errorMsg.classList.remove("visible");

            const submitBtn = form.querySelector("button[type=submit]");
            const originalLabel = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = "Sending...";

            fetch(form.action, {
                method: "POST",
                body: new FormData(form),
                headers: { Accept: "application/json" }
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.success) {
                        successMsg.classList.add("visible");
                        const addressText = resultAddress.textContent;
                        form.reset();
                        hiddenAddressField.value = addressText; // form.reset() wipes hidden fields too
                    } else {
                        errorMsg.classList.add("visible");
                    }
                })
                .catch(() => {
                    errorMsg.classList.add("visible");
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalLabel;
                });
        });
    }

    // ------------------------------------------------------------
    // HAR TOOL ACCORDION — fallback for people who want HAR's own
    // automated valuation engine instead of/alongside our lead form.
    // Uses a CSS class (not the `hidden` attribute) so the max-height
    // expand/collapse transition in valuation.css can actually animate
    // — a transition can't start from display:none, which is what
    // `hidden` applies.
    // ------------------------------------------------------------
    const harToggle = document.getElementById("harToolToggle");
    const harAccordion = document.getElementById("harToolAccordion");
    const harIframe = document.getElementById("harToolIframe");
    const HAR_VALUATION_SRC = "https://www.har.com/idx/mls/homevalue/search?sitetype=aws&cid=736316";

    if (harToggle) {
        harToggle.addEventListener("click", () => {
            const isOpen = harToggle.getAttribute("aria-expanded") === "true";
            harToggle.setAttribute("aria-expanded", String(!isOpen));
            harAccordion.classList.toggle("open", !isOpen);

            // Lazy-load: only fetch HAR's iframe once someone actually
            // expands this, not on every page load.
            if (!isOpen && harIframe && !harIframe.src) {
                harIframe.src = HAR_VALUATION_SRC;
            }
        });
    }
});

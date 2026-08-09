// ------------------------------------------------------------
// Cadence Realty — HAR Search Bar
// Builds a HAR.com IDX search-results URL from the custom hero
// search bar and opens it in a new tab.
//
// Endpoint: https://search.har.com/idx/doSearch.cfm
// CID (client/company ID) identifies Cadence Realty Services on HAR.
// ALLMLS=Y searches the full Houston-area MLS, not just this
// brokerage's own listings.
//
// NOTE ON PROPERTY_CLASS_ID mapping: HAR does not publish official
// IDX parameter documentation. This mapping (1 = Single Family,
// 2 = Townhouse/Condo, 3 = Lease/Rental, 5 = Land) is inferred from
// publicly observable HAR search URLs. If results look off for a
// given property type after this goes live, this is the first
// place to adjust.
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("harSearchForm");
    if (!form) return;

    const HAR_ENDPOINT = "https://search.har.com/idx/doSearch.cfm";
    const HAR_CID = "736316";

    form.addEventListener("submit", (e) => {
        e.preventDefault();

        const location = document.getElementById("harLocation").value.trim();
        const minPrice = document.getElementById("harMinPrice").value;
        const maxPrice = document.getElementById("harMaxPrice").value;
        const beds = document.getElementById("harBeds").value;
        const baths = document.getElementById("harBaths").value;
        const propertyType = document.getElementById("harPropertyType").value;

        const params = new URLSearchParams({
            CID: HAR_CID,
            SITETYPE: "AWS",
            ALLMLS: "Y",
            FOR_SALE: "1",
            PROPERTY_STATUS: "A",
            SORTBY: "listing_price desc"
        });

        if (minPrice) params.set("LISTING_PRICE_MIN", minPrice);
        if (maxPrice) params.set("LISTING_PRICE_MAX", maxPrice);
        if (beds) params.set("FULL_BED_NUM", beds);
        if (baths) params.set("FULL_BATH_NUM", baths);
        if (propertyType) params.set("PROPERTY_CLASS_ID", propertyType);

        if (location) {
            // A 5-digit input is treated as a ZIP code; otherwise it's
            // sent as both a subdivision and address match so HAR can
            // resolve city/neighborhood/street-name style queries.
            if (/^\d{5}$/.test(location)) {
                params.set("ZIP_CODE", location);
            } else {
                params.set("SUBDIVISION", location);
                params.set("ADDRESS", location);
            }
        }

        const url = `${HAR_ENDPOINT}?${params.toString()}`;
        window.open(url, "_blank", "noopener");
    });
});

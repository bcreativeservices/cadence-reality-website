// ------------------------------------------------------------
// Cadence Realty — HAR Embed Auto-Resize
//
// PROBLEM: every .har-embed-frame wraps a cross-origin <iframe> pointing at
// har.com. Browsers block a parent page from reading a cross-origin iframe's
// real content height (security boundary — this is not a bug, it's
// intentional browser behavior), so the wrapper's height was previously a
// static guess (2400px desktop / 3400px mobile for the full-bleed variant,
// used identically for every embed type). That guess is wrong in both
// directions depending on the embed:
//   - Too TALL for compact embeds (e.g. the Home Valuation address-input
//     form) => a large block of dead blank space before the next section.
//   - Too SHORT for content-heavy embeds (e.g. a large listings grid) =>
//     the bottom of HAR's page — including their required compliance
//     banner — gets silently clipped, since scrolling="no" + overflow:
//     hidden means there's no scrollbar to reveal the rest.
//
// FIX: listen for a postMessage from the iframe reporting its actual
// rendered content height, and resize the wrapper to match exactly. This
// removes the guesswork entirely instead of trading one wrong static number
// for another. If HAR's embed never sends a resize message (protocol not
// supported, or blocked), the existing CSS static height remains as a
// fallback — this is purely additive and cannot make things worse than
// today's behavior.
//
// VERIFICATION NEEDED: HAR.com's exact postMessage payload shape isn't
// publicly documented and couldn't be confirmed against the live embed
// from this environment (no outbound network access here). This listener
// defensively handles the conventions most IDX/embed providers use (raw
// number, or a JSON object with a height-like key). Confirm against the
// real embed in QA — inspect postMessage traffic via the browser's
// DevTools (Console: `window.addEventListener('message', e =>
// console.log(e.origin, e.data))`) on a live page, and adjust the parsing
// below if HAR's actual format differs.
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const frames = document.querySelectorAll(".har-embed-frame");
    if (!frames.length) return;

    // Only accept resize messages from HAR's own origins — never trust
    // postMessage from an unexpected source. Every iframe src on this site
    // currently points at www.har.com; search.har.com is included since
    // it's used elsewhere (js/har-search.js) and may host embeds too.
    const TRUSTED_ORIGINS = new Set([
        "https://www.har.com",
        "https://search.har.com"
    ]);

    // Sane bounds so a malformed or unexpected message can't collapse the
    // embed to nothing or blow it out to something absurd.
    const MIN_HEIGHT = 200;
    const MAX_HEIGHT = 6000;

    function extractHeight(data) {
        if (typeof data === "number") return data;

        if (typeof data === "string") {
            // Try JSON first ({"height": 1234} and similar)
            try {
                const parsed = JSON.parse(data);
                return extractHeight(parsed);
            } catch (e) {
                // Fall back to a bare numeric string
                const asNumber = parseFloat(data);
                return Number.isNaN(asNumber) ? null : asNumber;
            }
        }

        if (data && typeof data === "object") {
            const candidateKeys = ["height", "iframeHeight", "docHeight", "contentHeight"];
            for (const key of candidateKeys) {
                if (typeof data[key] === "number") return data[key];
                if (typeof data[key] === "string") {
                    const n = parseFloat(data[key]);
                    if (!Number.isNaN(n)) return n;
                }
            }
        }

        return null;
    }

    window.addEventListener("message", (event) => {
        if (!TRUSTED_ORIGINS.has(event.origin)) return;

        const height = extractHeight(event.data);
        if (height === null) return;

        const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));

        // Match the message to the iframe that actually sent it, so a
        // resize event from one embed never resizes a different one on
        // the same page (e.g. market.html has two separate embeds).
        frames.forEach((frame) => {
            const iframe = frame.querySelector("iframe");
            if (!iframe || !iframe.contentWindow) return;
            if (event.source !== iframe.contentWindow) return;

            frame.style.height = `${clamped}px`;
            // Once we're getting real height data for this embed, the
            // static CSS fallback height is no longer needed for it —
            // explicit inline height (set above) already overrides it.
        });
    });
});

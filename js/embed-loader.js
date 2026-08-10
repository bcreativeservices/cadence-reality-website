// ------------------------------------------------------------
// Cadence Realty — Embed Loading States
// Every .har-embed-frame on the site contains an iframe pointing
// to a HAR.com tool. Cross-origin iframes render blank/white while
// loading, which feels unfinished. This auto-injects a branded
// loading overlay in front of each embed and fades it out once the
// iframe's `load` event fires — this event fires for cross-origin
// iframes too (only reading their content is blocked, not knowing
// that they loaded).
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".har-embed-frame").forEach((frame) => {
        const iframe = frame.querySelector("iframe");
        if (!iframe) return;

        const overlay = document.createElement("div");
        overlay.className = "embed-loading-overlay";
        overlay.innerHTML = `
            <div class="embed-loading-spinner"></div>
            <p>Just a moment&hellip;</p>
        `;
        frame.appendChild(overlay);

        function hideOverlay() {
            overlay.classList.add("loaded");
            setTimeout(() => overlay.remove(), 500);
        }

        iframe.addEventListener("load", hideOverlay);

        // Safety net: if load never fires (rare), don't leave the
        // overlay stuck forever.
        setTimeout(hideOverlay, 8000);
    });
});

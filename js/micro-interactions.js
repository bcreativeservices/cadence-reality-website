// ------------------------------------------------------------
// Cadence Realty — Micro Interaction System
// Subtle luxury interactions for buttons, links, icons & CTA
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    // ------------------------------------------------------------
    // Sticky CTA Tap Feedback (if present on page)
    // ------------------------------------------------------------
    const cta = document.getElementById("ctaButton");
    if (cta) {
        cta.addEventListener("click", () => {
            cta.classList.add("soft-pulse");
            setTimeout(() => cta.classList.remove("soft-pulse"), 800);
        });
    }

    // ------------------------------------------------------------
    // Auto-apply tap/hover classes to buttons, links, icons.
    // Re-run on "partialsLoaded" too, since the header/footer (and their
    // nav links, logo, icons) are injected asynchronously after this
    // first pass and would otherwise never get these classes.
    // ------------------------------------------------------------
    function applyMicroInteractions() {
        document.querySelectorAll("button, .btn, .submit-button, .cta-button")
            .forEach(btn => btn.classList.add("button-tap"));

        document.querySelectorAll("a")
            .forEach(link => link.classList.add("link-slide"));

        document.querySelectorAll("img, svg").forEach(icon => {
            if (icon.classList.contains("site-logo")) return;
            icon.classList.add("icon-scale");
        });
    }

    applyMicroInteractions();
    document.addEventListener("partialsLoaded", applyMicroInteractions);

});

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
    // Auto-apply button tap animation
    // ------------------------------------------------------------
    const buttons = document.querySelectorAll("button, .btn, .submit-button, .cta-button");
    buttons.forEach(btn => {
        btn.classList.add("button-tap");
    });


    // ------------------------------------------------------------
    // Auto-apply link underline slide
    // ------------------------------------------------------------
    const links = document.querySelectorAll("a");
    links.forEach(link => {
        link.classList.add("link-slide");
    });


    // ------------------------------------------------------------
    // Auto-apply icon micro-scale
    // ------------------------------------------------------------
    const icons = document.querySelectorAll("img, svg");
    icons.forEach(icon => {
        // Avoid scaling the main site logo
        if (icon.classList.contains("site-logo")) return;
        icon.classList.add("icon-scale");
    });

});

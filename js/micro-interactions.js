// Micro-Interaction Library for Cadence Realty
// App-like luxury interactions

document.addEventListener("DOMContentLoaded", () => {

    /* Sticky CTA Tap Feedback */
    const cta = document.getElementById("ctaButton");
    if (cta) {
        cta.addEventListener("click", () => {
            cta.classList.add("soft-pulse");
            setTimeout(() => cta.classList.remove("soft-pulse"), 800);
        });
    }

    /* Auto-apply button tap class */
    document.querySelectorAll("button").forEach(btn => {
        btn.classList.add("button-tap");
    });

    /* Auto-apply link slide class */
    document.querySelectorAll("a").forEach(link => {
        link.classList.add("link-slide");
    });

    /* Auto-apply icon micro-scale */
    document.querySelectorAll("img, svg").forEach(icon => {
        if (icon.classList.contains("site-logo")) return; // avoid scaling logo
        icon.classList.add("icon-scale");
    });

});

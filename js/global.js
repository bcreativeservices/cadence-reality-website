// ------------------------------------------------------------
// Mobile Menu Toggle
// The header (and #mobileMenuBtn / #mobileMenu) is injected
// asynchronously by components/includes.js, so it does not exist yet
// at DOMContentLoaded. Event delegation on document sidesteps that
// timing problem entirely — no need to wait for a "loaded" signal.
// ------------------------------------------------------------

function setMobileMenuState(open) {
    const mobileMenu = document.getElementById("mobileMenu");
    const overlay = document.getElementById("mobileMenuOverlay");
    if (!mobileMenu) return;

    mobileMenu.classList.toggle("active", open);
    if (overlay) overlay.classList.toggle("active", open);
    document.body.classList.toggle("menu-open", open);
}

document.addEventListener("click", (event) => {
    const btn = event.target.closest("#mobileMenuBtn");
    if (!btn) return;

    const mobileMenu = document.getElementById("mobileMenu");
    if (mobileMenu) {
        setMobileMenuState(!mobileMenu.classList.contains("active"));
    }
});

// Close the mobile menu when a nav link/button inside it is tapped
document.addEventListener("click", (event) => {
    const link = event.target.closest("#mobileMenu a, #mobileMenu button");
    if (!link) return;
    setMobileMenuState(false);
});

// Close when tapping the backdrop
document.addEventListener("click", (event) => {
    if (event.target.id === "mobileMenuOverlay") {
        setMobileMenuState(false);
    }
});

// Close on Escape
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMobileMenuState(false);
});

// ------------------------------------------------------------
// Floating Mobile CTA — reveal after scrolling past the hero,
// hide again near the very top so it doesn't compete with the
// hero's own CTAs.
// ------------------------------------------------------------
window.addEventListener("scroll", () => {
    const cta = document.getElementById("mobileFloatingCta");
    if (!cta) return;

    if (window.scrollY > 500) {
        cta.classList.add("visible");
    } else {
        cta.classList.remove("visible");
    }
});

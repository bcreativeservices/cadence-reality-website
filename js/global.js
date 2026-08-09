// ------------------------------------------------------------
// Mobile Menu Toggle
// The header (and #mobileMenuBtn / #mobileMenu inside it) is injected
// asynchronously by components/includes.js, so it does not exist yet
// at DOMContentLoaded. Event delegation on document sidesteps that
// timing problem entirely — no need to wait for a "loaded" signal.
// ------------------------------------------------------------
document.addEventListener("click", (event) => {
    const btn = event.target.closest("#mobileMenuBtn");
    if (!btn) return;

    const mobileMenu = document.getElementById("mobileMenu");
    if (mobileMenu) {
        mobileMenu.classList.toggle("active");
    }
});

// Close the mobile menu when a nav link inside it is tapped
document.addEventListener("click", (event) => {
    const link = event.target.closest("#mobileMenu a");
    if (!link) return;

    const mobileMenu = document.getElementById("mobileMenu");
    if (mobileMenu) {
        mobileMenu.classList.remove("active");
    }
});

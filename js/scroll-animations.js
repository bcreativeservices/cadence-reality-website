// ------------------------------------------------------------
// Cadence Realty — Motion System
// Scroll-triggered animations for all pages
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    // Intersection Observer
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {

                // Add animate-in class
                entry.target.classList.add("animate-in");

                // Animate staggered children
                const staggerChildren = entry.target.querySelectorAll(
                    ".stagger-1, .stagger-2, .stagger-3, .stagger-4, .stagger-5"
                );

                staggerChildren.forEach(child => {
                    child.classList.add("animate-in");
                });

                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15
    });

    // Tracks which sections are already being observed, so re-scans
    // (triggered by partialsLoaded below) don't double-observe.
    const observedSections = new Set();

    function observeAnimatedSections() {
        document.querySelectorAll(".animate-section").forEach(section => {
            if (!observedSections.has(section)) {
                observedSections.add(section);
                observer.observe(section);
            }
        });
    }

    // Initial scan for sections already in the DOM
    observeAnimatedSections();

    // The footer (and header, if it ever gets .animate-section) are
    // injected asynchronously after this initial scan runs — without
    // this, the footer would stay at opacity:0 forever, since nothing
    // would ever observe it into view.
    document.addEventListener("partialsLoaded", observeAnimatedSections);



    // ------------------------------------------------------------
    // Sticky Header Shadow on Scroll
    // Header is injected asynchronously (components/includes.js), so we
    // look it up at scroll-time rather than caching it at DOMContentLoaded —
    // otherwise this throws on a null header if the fetch hasn't resolved yet.
    // ------------------------------------------------------------
    window.addEventListener("scroll", () => {
        const header = document.querySelector(".site-header");
        if (!header) return;

        if (window.scrollY > 40) {
            header.classList.add("scrolled-header");
        } else {
            header.classList.remove("scrolled-header");
        }
    });

    // Note: mobile menu toggle lives in js/global.js only.
    // (Previously duplicated here, which caused the hamburger button
    // to toggle the "active" class twice per click — net no visible effect.)

});

// ------------------------------------------------------------
// Cadence Realty — Motion System
// Scroll-triggered animations for all pages
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    // Intersection Observer
    //
    // threshold is a fraction of the TARGET element's own height, not the
    // viewport's. That's fine for short sections, but breaks completely for
    // any .animate-section that's taller than ~6.5x the viewport — the
    // required visible fraction can never physically fit on screen, so
    // isIntersecting never becomes true and the section (and everything in
    // it) stays at opacity:0 forever.
    //
    // This bit real content: team.html's agent grid is a CSS Grid that
    // collapses to a single column on mobile, stacking 14 agent cards into
    // one ~7,500px-tall section. A ~700px mobile viewport can never show 15%
    // (~1,125px) of that at once, so the whole section — names, photos,
    // everything — silently never revealed on mobile. (about.html's agent
    // carousel doesn't hit this because it's a fixed-height horizontal
    // scroller, not a stacking grid, so its total height stays short
    // regardless of how many agents are in it.)
    //
    // Fix: use threshold: 0 (fires the instant any pixel intersects, so it
    // no longer depends on the target's total height at all) combined with
    // a negative rootMargin (so short sections still wait until they're
    // meaningfully on screen rather than revealing on a 1px sliver at the
    // very edge of the viewport). This is correct for sections of any
    // height, including future ones we haven't built yet.
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
        threshold: 0,
        rootMargin: "0px 0px -10% 0px"
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

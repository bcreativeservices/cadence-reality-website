// ------------------------------------------------------------
// Cadence Realty — Motion System
// Scroll-triggered animations for all pages
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    // Select all animated sections
    const animatedSections = document.querySelectorAll(".animate-section");

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
            }
        });
    }, {
        threshold: 0.15
    });

    // Observe each section
    animatedSections.forEach(section => observer.observe(section));



    // ------------------------------------------------------------
    // Sticky Header Shadow on Scroll
    // ------------------------------------------------------------
    const header = document.querySelector(".site-header");

    window.addEventListener("scroll", () => {
        if (window.scrollY > 40) {
            header.classList.add("scrolled-header");
        } else {
            header.classList.remove("scrolled-header");
        }
    });



    // ------------------------------------------------------------
    // Mobile Menu Toggle
    // ------------------------------------------------------------
    const mobileBtn = document.getElementById("mobileMenuBtn");
    const mobileMenu = document.getElementById("mobileMenu");

    if (mobileBtn && mobileMenu) {
        mobileBtn.addEventListener("click", () => {
            mobileMenu.classList.toggle("active");
        });
    }

});

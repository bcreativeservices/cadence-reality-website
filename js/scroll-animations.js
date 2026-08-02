// Luxury Motion System for Cadence Realty
// Mobile-first, app-like scroll animations

document.addEventListener("DOMContentLoaded", () => {

    const animatedSections = document.querySelectorAll(".privacy-section, .privacy-hero");

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("animate-in");
            }
        });
    }, {
        threshold: 0.15
    });

    animatedSections.forEach(section => observer.observe(section));
});

// ------------------------------------------------------------
// Cadence Realty — Hero Parallax Engine
// Soft vertical parallax motion for hero background image
// ------------------------------------------------------------

document.addEventListener("scroll", () => {
    const scrolled = window.pageYOffset;
    const heroImg = document.querySelector(".parallax-bg .hero-image");

    if (heroImg) {
        // Smooth vertical parallax movement
        heroImg.style.transform = `translateY(${scrolled * 0.25}px) scale(1.1)`;
    }
});

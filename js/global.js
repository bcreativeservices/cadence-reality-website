// Mobile Menu Toggle
document.addEventListener("DOMContentLoaded", () => {
    const mobileBtn = document.getElementById("mobileMenuBtn");
    const mobileMenu = document.getElementById("mobileMenu");

    if (mobileBtn && mobileMenu) {
        mobileBtn.addEventListener("click", () => {
            mobileMenu.classList.toggle("active");
        });
    }
});

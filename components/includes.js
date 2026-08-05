// Simple HTML include system for static sites
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-include]").forEach(async (el) => {
        const file = el.getAttribute("data-include");
        const response = await fetch(file);
        const html = await response.text();
        el.innerHTML = html;
    });
});

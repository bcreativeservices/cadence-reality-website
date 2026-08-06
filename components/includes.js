// ------------------------------------------------------------
// Cadence Realty — Global Component Loader
// Injects header and footer into every page
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    // Inject Global Header
    const headerPlaceholder = document.getElementById("header-placeholder");
    if (headerPlaceholder) {
        fetch("components/global-header.html")
            .then(response => response.text())
            .then(html => {
                headerPlaceholder.innerHTML = html;
            })
            .catch(err => console.error("Header load error:", err));
    }

    // Inject Global Footer
    const footerPlaceholder = document.getElementById("footer-placeholder");
    if (footerPlaceholder) {
        fetch("components/global-footer.html")
            .then(response => response.text())
            .then(html => {
                footerPlaceholder.innerHTML = html;
            })
            .catch(err => console.error("Footer load error:", err));
    }

});

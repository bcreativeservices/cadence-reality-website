// ------------------------------------------------------------
// Cadence Realty — Global Component Loader
// Injects header and footer into every page
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    const headerPlaceholder = document.getElementById("header-placeholder");
    const footerPlaceholder = document.getElementById("footer-placeholder");

    const loadHeader = headerPlaceholder
        ? fetch("components/global-header.html")
            .then(response => response.text())
            .then(html => { headerPlaceholder.innerHTML = html; })
            .catch(err => console.error("Header load error:", err))
        : Promise.resolve();

    const loadFooter = footerPlaceholder
        ? fetch("components/global-footer.html")
            .then(response => response.text())
            .then(html => { footerPlaceholder.innerHTML = html; })
            .catch(err => console.error("Footer load error:", err))
        : Promise.resolve();

    // Other scripts (scroll animations, micro-interactions, the mobile menu)
    // need to know when the header/footer actually exist in the DOM, since
    // they arrive asynchronously after DOMContentLoaded. Rather than each
    // script guessing at timing, we broadcast one event once both are in.
    Promise.all([loadHeader, loadFooter]).then(() => {
        document.dispatchEvent(new Event("partialsLoaded"));
    });

});

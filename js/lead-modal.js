// ------------------------------------------------------------
// Cadence Realty — Shared Lead-Form Modal
// Any element with class "js-open-leadform" opens a modal with
// HAR's lead capture form embedded via iframe. Requires the page
// to include the modal markup (#leadFormModal) — see about.html
// for the reference implementation.
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("leadFormModal");
    if (!modal) return;

    const closeBtn = modal.querySelector(".modal-close");
    const iframe = modal.querySelector("iframe");
    const IFRAME_SRC = "https://www.har.com/idx/leadform?sitetype=aws&cid=736316";

    function openModal() {
        // Lazy-load the iframe only when actually opened
        if (iframe && !iframe.src) {
            iframe.src = IFRAME_SRC;
        }
        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
    }

    function closeModal() {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest(".js-open-leadform")) {
            e.preventDefault();
            openModal();
        }
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("active")) closeModal();
    });
});

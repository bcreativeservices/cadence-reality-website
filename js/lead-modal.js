// ------------------------------------------------------------
// Cadence Realty — Shared Modals (Lead Form + Cookie Preferences)
// Modal markup lives in components/global-footer.html, which is
// injected asynchronously on every page. All lookups here happen
// at event time (not cached at DOMContentLoaded) so this works
// regardless of whether the footer has finished loading yet.
// ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {

    const LEADFORM_SRC = "https://www.har.com/idx/leadform?sitetype=aws&cid=736316";

    function openModal(id) {
        const modal = document.getElementById(id);
        if (!modal) return;

        if (id === "leadFormModal") {
            const iframe = modal.querySelector("iframe");
            if (iframe && !iframe.src) iframe.src = LEADFORM_SRC;
        }

        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
    }

    // Opens the shared #harEmbedModal with whichever HAR tool the
    // clicked trigger points at (data-har-src / data-har-title). The
    // iframe's src is only ever set here, at the moment the modal
    // actually opens — never loaded up front — so pages with a teaser
    // card don't pay the cost of loading a HAR iframe until someone
    // actually asks to see it.
    function openHarModal(trigger) {
        const modal = document.getElementById("harEmbedModal");
        if (!modal) return;

        const src = trigger.getAttribute("data-har-src");
        const title = trigger.getAttribute("data-har-title") || "";
        if (!src) return;

        const iframe = modal.querySelector("iframe");
        if (iframe) {
            // Reset src first if switching between two different HAR
            // tools without a full page reload (e.g. Market Snapshot's
            // two separate teaser cards) — avoids briefly showing the
            // previous tool's stale content while the new one loads.
            if (iframe.src !== src) iframe.src = src;
            iframe.title = title;
        }

        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
    }

    function closeModal(modal) {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }

    // Open triggers (event delegation — works even if footer loads later)
    document.addEventListener("click", (e) => {
        if (e.target.closest(".js-open-leadform")) {
            e.preventDefault();
            openModal("leadFormModal");
        }
        if (e.target.closest(".js-open-cookie-prefs")) {
            e.preventDefault();
            openModal("cookiePrefsModal");
            hideCookieBanner();
        }
        const harTrigger = e.target.closest(".js-open-har-modal");
        if (harTrigger) {
            e.preventDefault();
            openHarModal(harTrigger);
        }
    });

    // Close triggers: close button, or clicking the overlay backdrop
    document.addEventListener("click", (e) => {
        const closeBtn = e.target.closest(".modal-close");
        if (closeBtn) {
            const modal = closeBtn.closest(".modal-overlay");
            if (modal) closeModal(modal);
            return;
        }
        if (e.target.classList && e.target.classList.contains("modal-overlay")) {
            closeModal(e.target);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        document.querySelectorAll(".modal-overlay.active").forEach(closeModal);
    });

    // ------------------------------------------------------------
    // Cookie Preferences — persisted in localStorage on the
    // visitor's own browser (this is the live site, not a Claude
    // artifact preview, so localStorage works normally here).
    // ------------------------------------------------------------
    const STORAGE_KEY = "cadence-cookie-prefs";

    function getStoredPrefs() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function savePrefs(prefs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch (e) {
            // localStorage unavailable (private browsing, etc.) — fail silently
        }
    }

    function hideCookieBanner() {
        const banner = document.getElementById("cookieBanner");
        if (banner) banner.classList.remove("visible");
        const cta = document.getElementById("mobileFloatingCta");
        if (cta) cta.classList.remove("banner-open");
    }

    function showCookieBannerIfNeeded() {
        if (getStoredPrefs()) return;
        const banner = document.getElementById("cookieBanner");
        if (banner) banner.classList.add("visible");
        const cta = document.getElementById("mobileFloatingCta");
        if (cta) cta.classList.add("banner-open");
    }

    function syncTogglesFromStorage() {
        const prefs = getStoredPrefs() || { analytics: false, marketing: false };
        const analytics = document.getElementById("cookieAnalytics");
        const marketing = document.getElementById("cookieMarketing");
        if (analytics) analytics.checked = !!prefs.analytics;
        if (marketing) marketing.checked = !!prefs.marketing;
    }

    document.addEventListener("click", (e) => {
        if (e.target.id === "cookieSavePrefs") {
            const analytics = document.getElementById("cookieAnalytics");
            const marketing = document.getElementById("cookieMarketing");
            savePrefs({
                analytics: analytics ? analytics.checked : false,
                marketing: marketing ? marketing.checked : false
            });
            hideCookieBanner();
            const modal = document.getElementById("cookiePrefsModal");
            if (modal) closeModal(modal);
        }

        if (e.target.id === "cookieRejectAll") {
            savePrefs({ analytics: false, marketing: false });
            syncTogglesFromStorage();
            hideCookieBanner();
            const modal = document.getElementById("cookiePrefsModal");
            if (modal) closeModal(modal);
        }

        if (e.target.id === "cookieBannerAccept") {
            savePrefs({ analytics: true, marketing: true });
            hideCookieBanner();
        }

        if (e.target.id === "cookieBannerPrefs") {
            openModal("cookiePrefsModal");
            hideCookieBanner();
        }
    });

    // Wait for the footer (and its cookie banner/modal) to actually
    // exist in the DOM before deciding whether to show the banner.
    document.addEventListener("partialsLoaded", () => {
        syncTogglesFromStorage();
        showCookieBannerIfNeeded();
    });

});

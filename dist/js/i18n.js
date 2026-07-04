// INTERNATIONALIZATION & RTL LAYOUT ENGINE - ROASTERY MANAGER V2 (GLOBAL SCRIPT VERSION)
(function() {
    window.currentLanguage = 'en';
    try {
        window.currentLanguage = localStorage.getItem('app_language') || 'en';
    } catch (e) {}

    /**
     * Get translated string for a key.
     */
    window.t = function(key) {
        const translationsDict = window.translations || {};
        const langDict = translationsDict[window.currentLanguage] || translationsDict['en'] || {};
        const defaultDict = translationsDict['en'] || {};
        return langDict[key] || defaultDict[key] || key;
    };

    /**
     * Translate all DOM elements containing data-i18n or data-i18n-placeholder.
     */
    window.translatePage = function() {
        // 1. Text elements translations
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = window.t(key);
            }
        });

        // 2. Form placeholder translations
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.setAttribute('placeholder', window.t(key));
            }
        });

        // 3. Direction and Layout adjustment (LTR / RTL)
        if (window.currentLanguage === 'ar') {
            document.documentElement.setAttribute('dir', 'rtl');
            document.body.setAttribute('dir', 'rtl');
            document.body.classList.add('rtl-active');
            adjustSidebarLayoutForRTL(true);
        } else {
            document.documentElement.setAttribute('dir', 'ltr');
            document.body.setAttribute('dir', 'ltr');
            document.body.classList.remove('rtl-active');
            adjustSidebarLayoutForRTL(false);
        }
        
        // Dispatch custom window event
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: window.currentLanguage }));
    };

    /**
     * Shift layout alignments dynamically when changing direction.
     */
    function adjustSidebarLayoutForRTL(isRTL) {
        const sidebar = document.getElementById('sidebar');
        const mainContent = document.getElementById('main-content');
        
        if (sidebar && mainContent && window.innerWidth > 768) {
            if (isRTL) {
                sidebar.style.left = 'auto';
                sidebar.style.right = '0';
                sidebar.style.borderRight = 'none';
                sidebar.style.borderLeft = '1px solid var(--border)';
                mainContent.style.marginLeft = '0';
                mainContent.style.marginRight = '260px'; // sidebar width
            } else {
                sidebar.style.left = '0';
                sidebar.style.right = 'auto';
                sidebar.style.borderRight = '1px solid var(--border)';
                sidebar.style.borderLeft = 'none';
                mainContent.style.marginLeft = '260px';
                mainContent.style.marginRight = '0';
            }
        }
    }

    window.setLanguage = function(lang) {
        const translationsDict = window.translations || {};
        if (translationsDict[lang]) {
            window.currentLanguage = lang;
            try {
                localStorage.setItem('app_language', lang);
            } catch (e) {}
            window.translatePage();
            return true;
        }
        return false;
    };

    // Auto-translate once page is fully parsed
    document.addEventListener('DOMContentLoaded', () => {
        window.translatePage();
    });

    // Re-adjust layout position on window scaling
    window.addEventListener('resize', () => {
        adjustSidebarLayoutForRTL(window.currentLanguage === 'ar');
    });
})();

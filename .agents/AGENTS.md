# Project Rules for Roastery Manager Pro

## 1. Localization (I18n) Integrity
* **No Hardcoded English Text**: All user-facing text, page titles, table headers, forms, placeholders, and JavaScript alert messages must use the localization engine.
* **Keys Usage**:
  - In HTML: Use `data-i18n="translation_key"` or `data-i18n-placeholder="translation_key"`.
  - In JavaScript: Use `window.t("translation_key")`.
* **RTL Support**: Any UI adjustments must support Right-to-Left (RTL) layout rendering when the active language is Arabic (`ar`).

## 2. Theme Toggle (Light/Dark Mode) Integrity
* **Variables Only**: Rely strictly on the CSS variable system (`var(--bg-app)`, `var(--bg-card)`, `var(--text-primary)`, etc.) for styling. Never hardcode color values in CSS or JS.
* **Toggle Safety**: The theme toggler listener must remain attached to `#theme-toggle` in `js/app.js` and call the global `toggleTheme()` securely.

## 3. Resilient Script Loading
* **Null Check Guards**: Always check if DOM elements exist using conditional guards (e.g., `if (element) { ... }`) before attaching event listeners. Startup script crashes due to un-guarded element additions are strictly forbidden.
* **Error Boundary**: Keep the `#error-console` in `index.html` as an early warning diagnostic tool to catch any unexpected script execution halts during development.

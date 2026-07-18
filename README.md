# Chronos.js

> A lightweight, zero-dependency CSS engine that runs directly in the browser.

Chronos.js lets you write clean, maintainable responsive CSS using modern helper functions — like `fluid()` for typography and `stack-below()` for layouts — without requiring any build steps (Sass, PostCSS, or Webpack).

- 📖 **Documentation:** [chronos.aximon.ng](https://chronos.aximon.ng)
- 🌐 **Portfolio:** [myxo.aximon.ng](https://myxo.aximon.ng)

---

##  Why Chronos?

- **Zero-Build Pipeline:** Drop a script tag, link your CSS, and you're done. No compilation, no setup, no `node_modules`.
- **Opt-in Logic:** Chronos only touches the functions you define. Your existing `@media`, `@keyframes`, and `@font-face` blocks are ignored and pass through completely untouched.
- **Intelligent Parsing:** Unlike flat regex-based parsers, Chronos tracks brace depth. It handles complex, nested CSS structures without corrupting your styles.
- **Zero-Config Mobile Nav:** Automatically detects your `<header>` and transforms your nav into a polished, slide-in mobile navigation menu with zero manual JavaScript.
- **Accessible Typography:** Chronos resolves `fluid()` typography in `rem` units, ensuring that if a user bumps their browser's default text size, your responsive layout scales with their preference.

---

##  Quick Start

### 1. Include Chronos.js in your document

```html
<script src="https://cdn.jsdelivr.net/gh/Myxo-victor/Chronos@v1.0.0/Chronos.js"></script>
```

### 2. Initialize in your `index.html`

```html
<script>
  Chronos.respond('style.css');
</script>
```

### 3. Write your CSS

```css
.hero {
  /* Fluidly scales from 24px to 48px */
  font-size: fluid(24px, 48px);
  padding: fluid(16px, 64px);
}

.sidebar {
  /* Hides the element below 768px */
  display: hide-below(768px);
}

.navbar {
  /* Stacks nav items into a column below 600px */
  flex-direction: stack-below(600px);
}
```

---

## 🛠️ Local Development (`file://` protocol)

Browsers block `fetch()` on `file://` URLs, so Chronos provides a fallback. Define your styles directly in the HTML:

```html
<style type="text/chronos">
  .hero { font-size: fluid(24px, 48px); }
</style>
```

Chronos automatically detects these tags and compiles them without needing a server.

---

## 📚 Features & API

| Function | Description |
| --- | --- |
| `fluid(min, max, [minVW, maxVW])` | Linearly interpolates values across a viewport range. |
| `hide-below(px)` / `hide-above(px)` | Quickly toggle visibility based on viewport. |
| `stack-below(px)` | Switches `flex-direction` to column below a threshold. |
| `auto-fit(px)` | A shorthand for CSS Grid `repeat(auto-fit, minmax(px, 1fr))`. |

---

## 📄 License

[MIT](./LICENSE)

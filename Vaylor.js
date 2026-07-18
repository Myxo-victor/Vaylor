/*!
 * Vaylor.js v1.1.0 — Media-query-free responsive CSS engine
 * Usage:  <script>Vaylor.respond('style.css');</script>
 *
 * Changelog:
 *   v1.1.0 — Real icon-font hamburger (Font Awesome), header background
 *            color detection to auto-pick a black/white icon, and a
 *            fully custom mobile slide-nav decoupled from the developer's
 *            desktop nav styling. Fixed: slide panel/backdrop leaking
 *            into normal desktop page flow.
 *   v1.0.0 — Renamed from Fluid.js. Added file:// fallback via inline
 *            <style type="text/vaylor"> tags, rem-based accessibility
 *            scaling for fluid(), and the vaylorCompiled debug event.
 *
 * Vaylor Writes CSS like:
 *   .hero  { font-size: fluid(24px, 48px); padding: fluid(16px, 64px); }
 *   .side  { display: hide-below(768px); }
 *   .navb  { flex-direction: stack-below(600px); }
 *   .grid  { grid-template-columns: auto-fit(240px); }
 *
 * Vaylor parses the raw CSS, converts these opt-in helper functions into
 * real clamp()/media-query CSS, injects it as a <style> tag, and (by
 * default) auto-detects your header/nav and turns it into a mobile
 * hamburger menu.
 *
 * Nothing is rewritten unless you use one of the helper functions above —
 * ordinary CSS (including your own existing @media / @keyframes /
 * @font-face blocks) passes through untouched and unbroken, because the
 * parser tracks brace depth instead of relying on a flat regex.
 */
(function (global) {
  'use strict';

  var VERSION = '1.1.0';
  var STYLE_ID = 'vaylor-compiled-styles';
  var DEFAULT_MIN_VW = 375;  // reference "smallest phone" width
  var DEFAULT_MAX_VW = 1440; // reference "large desktop" width
  var ROOT_FONT_SIZE = 16;   // assumed root font-size, used only to derive the rem portion below

  var _explainLog = {};      // selector -> generated CSS, for vaylor.explain()

  // ---------------------------------------------------------------------
  // Unit helpers
  // ---------------------------------------------------------------------

  function parseLength(raw) {
    var m = String(raw).trim().match(/^(-?[\d.]+)(px|rem|em|%|vw|vh)?$/);
    if (!m) return null;
    return { value: parseFloat(m[1]), unit: m[2] || 'px' };
  }

  // Builds a clamp() that linearly interpolates between min and max
  // across the viewport range [minVW, maxVW]. Falls back to a simple
  // clamp with a 50vw preferred value if units can't be reconciled.
  //
  // For px values, the interpolation's fixed offset is expressed in rem
  // rather than px. This is an accessibility win, not just cosmetic: rem
  // resolves against the root font-size at render time, so if a visitor
  // has bumped their browser's default text size up, the fluid value
  // scales with that preference instead of ignoring it. The vw portion
  // (the part that responds to viewport width) is unaffected either way.
  function fluidClamp(minRaw, maxRaw, minVW, maxVW) {
    minVW = minVW || DEFAULT_MIN_VW;
    maxVW = maxVW || DEFAULT_MAX_VW;

    var min = parseLength(minRaw);
    var max = parseLength(maxRaw);

    if (!min || !max || min.unit !== max.unit || min.unit === '%') {
      // Mixed/relative units: safe fallback, still fluid, just not
      // perfectly linear.
      return 'clamp(' + minRaw + ', 50vw, ' + maxRaw + ')';
    }

    var unit = min.unit;
    var slope = (max.value - min.value) / (maxVW - minVW);
    var interceptRaw = min.value - slope * minVW;
    var preferredVw = (slope * 100).toFixed(4);

    var lo = Math.min(min.value, max.value) + unit;
    var hi = Math.max(min.value, max.value) + unit;

    var preferred;
    if (unit === 'px') {
      var interceptRem = (interceptRaw / ROOT_FONT_SIZE).toFixed(4);
      preferred = interceptRem + 'rem + ' + preferredVw + 'vw';
    } else {
      preferred = interceptRaw.toFixed(4) + unit + ' + ' + preferredVw + 'vw';
    }

    return 'clamp(' + lo + ', calc(' + preferred + '), ' + hi + ')';
  }

  // ---------------------------------------------------------------------
  // CSS transform
  // ---------------------------------------------------------------------

  // A brace-depth-aware block splitter — deliberately not a full CSS
  // parser, but unlike a flat regex it correctly walks INTO nested
  // @media / @keyframes / @font-face blocks without corrupting anything
  // outside them, so pre-existing responsive CSS in the source file is
  // left completely intact.
  function splitRules(cssText) {
    var rules = [];
    var depth = 0, buf = '', selector = '', i;
    for (i = 0; i < cssText.length; i++) {
      var ch = cssText[i];
      if (ch === '{') {
        if (depth === 0) { selector = buf.trim(); buf = ''; }
        else buf += ch;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          rules.push({ selector: selector, body: buf, isAtRule: selector.indexOf('@') === 0 });
          buf = '';
        } else buf += ch;
      } else {
        buf += ch;
      }
    }
    return rules;
  }

  function transformCSS(cssText, options) {
    var rules = splitRules(cssText);
    var staticCSS = [];
    var mediaBuckets = {}; // "max-width:768px" -> [css lines]

    function addMedia(query, css) {
      mediaBuckets[query] = mediaBuckets[query] || [];
      mediaBuckets[query].push(css);
    }

    rules.forEach(function (rule) {
      if (rule.isAtRule) {
        // Existing @media / @keyframes / @font-face etc. pass through
        // completely unmodified — nested content included, brace-for-brace.
        staticCSS.push(rule.selector + '{' + rule.body + '}');
        return;
      }

      var decls = rule.body.split(';').map(function (d) { return d.trim(); }).filter(Boolean);
      var keptDecls = [];

      decls.forEach(function (decl) {
        var parts = decl.split(':');
        if (parts.length < 2) { keptDecls.push(decl); return; }
        var prop = parts.shift().trim();
        var value = parts.join(':').trim();

        var fluidMatch = value.match(/^fluid\(\s*([^,]+),\s*([^,)]+)(?:,\s*([\d.]+))?(?:,\s*([\d.]+))?\s*\)$/);
        var hideBelowMatch = value.match(/^hide-below\(\s*([\d.]+)px\s*\)$/);
        var hideAboveMatch = value.match(/^hide-above\(\s*([\d.]+)px\s*\)$/);
        var stackBelowMatch = value.match(/^stack-below\(\s*([\d.]+)px\s*\)$/);
        var autoFitMatch = value.match(/^auto-fit\(\s*([\d.]+)px\s*\)$/);

        if (fluidMatch) {
          var computed = fluidClamp(
            fluidMatch[1].trim(), fluidMatch[2].trim(),
            fluidMatch[3] ? parseFloat(fluidMatch[3]) : undefined,
            fluidMatch[4] ? parseFloat(fluidMatch[4]) : undefined
          );
          keptDecls.push(prop + ': ' + computed);
        } else if (hideBelowMatch) {
          addMedia('(max-width: ' + hideBelowMatch[1] + 'px)', rule.selector + '{' + prop + ': none !important;}');
          keptDecls.push(prop + ': ' + (prop === 'display' ? 'block' : 'initial'));
        } else if (hideAboveMatch) {
          addMedia('(min-width: ' + hideAboveMatch[1] + 'px)', rule.selector + '{' + prop + ': none !important;}');
        } else if (stackBelowMatch) {
          addMedia('(max-width: ' + stackBelowMatch[1] + 'px)', rule.selector + '{' + prop + ': column;}');
          keptDecls.push(prop + ': row');
        } else if (autoFitMatch) {
          keptDecls.push(prop + ': repeat(auto-fit, minmax(' + autoFitMatch[1] + 'px, 1fr))');
        } else {
          // Anything not using a vaylor helper function is left exactly
          // as the author wrote it — no implicit/automatic rewriting.
          keptDecls.push(decl);
        }
      });

      if (keptDecls.length) {
        var generated = rule.selector + ' {\n  ' + keptDecls.join(';\n  ') + ';\n}';
        staticCSS.push(generated);
        _explainLog[rule.selector] = generated;
      }
    });

    var mediaCSS = Object.keys(mediaBuckets).map(function (q) {
      return '@media ' + q + ' {\n' + mediaBuckets[q].join('\n') + '\n}';
    });

    return staticCSS.concat(mediaCSS).join('\n\n');
  }

  // ---------------------------------------------------------------------
  // Mobile nav / hamburger auto-detection
  // ---------------------------------------------------------------------

  var NAV_STYLE_ID = 'vaylor-nav-styles';
  var ICON_FONT_ID = 'vaylor-icon-font';
  var ICON_FONT_HREF = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';

  // Loads a real icon font (Font Awesome) once, so the hamburger uses an
  // actual bars/xmark glyph instead of hand-drawn <span> lines. Skips
  // injection if the page already links Font Awesome itself.
  function ensureIconFont() {
    if (document.getElementById(ICON_FONT_ID)) return;
    if (document.querySelector('link[href*="font-awesome"]')) return;
    var link = document.createElement('link');
    link.id = ICON_FONT_ID;
    link.rel = 'stylesheet';
    link.href = ICON_FONT_HREF;
    document.head.appendChild(link);
  }

  // ---- header color detection --------------------------------------

  function parseRgb(str) {
    var m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var parts = m[1].split(',').map(function (s) { return parseFloat(s.trim()); });
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  }

  // Walks up from the header until it finds a non-transparent background,
  // since a header's own background is very often set on an ancestor.
  function getEffectiveBackground(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var rgb = parseRgb(getComputedStyle(node).backgroundColor);
      if (rgb && rgb.a > 0) return rgb;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; // default: assume a white page background
  }

  // "White or grayish" = low color saturation (r, g, b close together)
  // AND light enough to read as white/light-gray rather than dark gray.
  // Anything else (a real hue, or a dark background) gets a white icon;
  // white/light-gray backgrounds get a black icon.
  function isWhiteOrGrayish(rgb) {
    var max = Math.max(rgb.r, rgb.g, rgb.b);
    var min = Math.min(rgb.r, rgb.g, rgb.b);
    var isGrayscale = (max - min) <= 18;
    var lightness = (rgb.r + rgb.g + rgb.b) / 3;
    return isGrayscale && lightness >= 170;
  }

  function pickIconColor(headerEl) {
    var bg = getEffectiveBackground(headerEl);
    return isWhiteOrGrayish(bg) ? '#141414' : '#ffffff';
  }

  // ---- styles ---------------------------------------------------------

  function injectNavStyles(breakpoint) {
    if (document.getElementById(NAV_STYLE_ID)) return;
    var css = [
      '.vaylor-hamburger{display:none;align-items:center;justify-content:center;',
      'width:40px;height:40px;border:none;background:transparent;cursor:pointer;padding:0;z-index:1101;}',
      '.vaylor-hamburger i{font-size:22px;color:var(--vaylor-icon-color,#141414);transition:transform .2s ease;}',
      '.vaylor-hamburger.is-open i{transform:rotate(90deg);}',

      // Both are appended to <body>, outside the header, so without an
      // explicit base rule they'd fall back to the browser default
      // (display:block) and appear as a second nav sitting in normal
      // page flow on desktop. Hidden by default; the media query below
      // is the only place that turns them on.
      '.vaylor-managed-nav{display:none;}',
      '.vaylor-nav-backdrop{display:none;}',

      // The desktop nav the developer built is hidden below the
      // breakpoint rather than reused — its own layout/color choices
      // (often a horizontal flex row) don't translate to a slide-in
      // panel, so mobile gets a purpose-built nav instead.
      '@media (max-width:' + breakpoint + 'px){',
      '  .vaylor-desktop-nav{display:none !important;}',
      '  .vaylor-hamburger{display:flex;}',

      // Custom slide panel — intentionally NOT the developer's nav
      // styling, so it always looks clean regardless of the desktop design.
      '  .vaylor-managed-nav{position:fixed;top:0;right:0;height:100vh;width:min(80vw,340px);',
      '    background:linear-gradient(165deg,#14181f 0%,#1c2230 100%);',
      '    box-shadow:-12px 0 32px rgba(0,0,0,.35);',
      '    transform:translateX(100%);transition:transform .32s cubic-bezier(.4,0,.2,1);',
      '    z-index:1100;display:flex;flex-direction:column;',
      '    padding:5.5rem 1.75rem 2rem;overflow-y:auto;}',
      '  .vaylor-managed-nav.is-open{transform:translateX(0);}',
      '  .vaylor-slide-title{color:#5b6472;font-size:12px;letter-spacing:.12em;',
      '    text-transform:uppercase;margin:0 0 1rem;font-weight:600;}',
      '  .vaylor-slide-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;}',
      '  .vaylor-slide-list li{border-bottom:1px solid rgba(255,255,255,.08);}',
      '  .vaylor-slide-link{display:block;padding:1rem 0.25rem;color:#f3f4f6;',
      '    text-decoration:none;font-size:16px;font-weight:500;',
      '    opacity:0;transform:translateX(16px);transition:opacity .3s ease,transform .3s ease,color .15s ease;}',
      '  .vaylor-slide-link:active,.vaylor-slide-link:hover{color:#7dd3fc;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-link{opacity:1;transform:translateX(0);}',
      // staggered entrance
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(1) .vaylor-slide-link{transition-delay:.05s;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(2) .vaylor-slide-link{transition-delay:.1s;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(3) .vaylor-slide-link{transition-delay:.15s;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(4) .vaylor-slide-link{transition-delay:.2s;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(5) .vaylor-slide-link{transition-delay:.25s;}',
      '  .vaylor-managed-nav.is-open .vaylor-slide-list li:nth-child(n+6) .vaylor-slide-link{transition-delay:.3s;}',

      '  .vaylor-nav-backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;',
      '    pointer-events:none;transition:opacity .25s ease;z-index:1099;}',
      '  .vaylor-nav-backdrop.is-open{opacity:1;pointer-events:auto;}',
      '}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = NAV_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildHamburger() {
    var btn = document.createElement('button');
    btn.className = 'vaylor-hamburger';
    btn.setAttribute('aria-label', 'Toggle navigation menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    return btn;
  }

  function setHamburgerIcon(btn, isOpen) {
    var icon = btn.querySelector('i');
    if (!icon) return;
    icon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  }

  // Builds a fresh, vaylor-styled panel from the original nav's links,
  // deliberately discarding the original <a> classes/inline styles so
  // the developer's desktop nav design has no influence on mobile.
  function buildSlidePanel(nav) {
    var panel = document.createElement('div');
    panel.className = 'vaylor-managed-nav';
    panel.setAttribute('aria-hidden', 'true');

    var title = document.createElement('p');
    title.className = 'vaylor-slide-title';
    title.textContent = 'Menu';
    panel.appendChild(title);

    var list = document.createElement('ul');
    list.className = 'vaylor-slide-list';

    nav.querySelectorAll('a').forEach(function (originalLink) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.className = 'vaylor-slide-link';
      link.href = originalLink.getAttribute('href') || '#';
      link.textContent = originalLink.textContent.trim();
      li.appendChild(link);
      list.appendChild(li);
    });

    panel.appendChild(list);
    return panel;
  }

  function initMobileNav(options) {
    options = options || {};
    var breakpoint = options.navBreakpoint || 768;
    var headerSel = options.headerSelector || 'header, [role="banner"]';
    var navSel = options.navSelector || 'nav';

    var header = document.querySelector(headerSel);
    if (!header) return; // nothing to auto-detect, silently skip

    var nav = header.querySelector(navSel) || document.querySelector(navSel);
    if (!nav || nav.dataset.vaylorNav === 'true') return;

    ensureIconFont();
    injectNavStyles(breakpoint);

    // Hide the developer's original nav below the breakpoint — it is
    // never reused for the mobile panel.
    nav.classList.add('vaylor-desktop-nav');
    nav.dataset.vaylorNav = 'true';

    var panel = buildSlidePanel(nav);
    document.body.appendChild(panel);

    var backdrop = document.createElement('div');
    backdrop.className = 'vaylor-nav-backdrop';
    document.body.appendChild(backdrop);

    var hamburger = buildHamburger();
    hamburger.style.setProperty('--vaylor-icon-color', pickIconColor(header));
    header.appendChild(hamburger);

    function closeNav() {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      backdrop.classList.remove('is-open');
      hamburger.classList.remove('is-open');
      hamburger.setAttribute('aria-expanded', 'false');
      setHamburgerIcon(hamburger, false);
    }

    function toggleNav() {
      // Re-check the header's background each time, in case a theme
      // toggle or scroll-based class changed it since page load.
      hamburger.style.setProperty('--vaylor-icon-color', pickIconColor(header));

      var open = panel.classList.toggle('is-open');
      panel.setAttribute('aria-hidden', String(!open));
      backdrop.classList.toggle('is-open', open);
      hamburger.classList.toggle('is-open', open);
      hamburger.setAttribute('aria-expanded', String(open));
      setHamburgerIcon(hamburger, open);
    }

    hamburger.addEventListener('click', toggleNav);
    backdrop.addEventListener('click', closeNav);
    panel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeNav);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > breakpoint) closeNav();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });
  }

  // ---------------------------------------------------------------------
  // file:// fallback — scan for inline <style type="text/vaylor"> tags
  // ---------------------------------------------------------------------
  //
  // Opening index.html directly (file:// protocol) blocks fetch() with a
  // CORS error in most browsers, which would otherwise leave respond()
  // with nothing to compile. As a fallback, vaylor scans the document
  // for <style type="text/vaylor"> tags and compiles those instead, so
  // local, no-server testing still works:
  //
  //   <style type="text/vaylor">
  //     .hero { font-size: fluid(24px, 48px); }
  //   </style>
  //   <script>vaylor.respond('style.css');</script>

  function scanDocumentForStyles(options) {
    var styleTags = document.querySelectorAll('style[type="text/vaylor"]');
    if (!styleTags.length) {
      console.warn('vaylor: no fallback <style type="text/vaylor"> tags found either. ' +
        'Serve the page over http(s):// or add an inline text/vaylor style tag.');
      return;
    }
    styleTags.forEach(function (tag) {
      respondText(tag.textContent, options);
    });
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  function respondText(cssText, options) {
    options = options || {};
    var autoNav = options.autoNav !== false; // on by default

    var output = transformCSS(cssText, options);

    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = output;

    if (options.debug) {
      console.log('%cvaylor.js generated CSS', 'font-weight:bold');
      console.log(output);
    }

    if (autoNav) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initMobileNav(options); });
      } else {
        initMobileNav(options);
      }
    }

    // Dispatch a hook so debugging tools / playgrounds can inspect
    // exactly what was compiled, without needing vaylor.explain().
    window.dispatchEvent(new CustomEvent('vaylorCompiled', {
      detail: { original: cssText, compiled: output }
    }));

    return output;
  }

  var Vaylor = {
    version: VERSION,

    respond: function (cssPath, options) {
      return fetch(cssPath)
        .then(function (res) {
          if (!res.ok) throw new Error('Vaylor: could not load ' + cssPath + ' (' + res.status + ')');
          return res.text();
        })
        .then(function (cssText) {
          return respondText(cssText, options);
        })
        .catch(function (err) {
          console.warn('Vaylor: fetch failed for "' + cssPath + '" (likely opened via file:// ' +
            'without a local server). Falling back to inline <style type="text/vaylor"> tags…', err);
          scanDocumentForStyles(options);
        });
    },

    // Compile a raw CSS string directly — skips fetch() entirely. Useful
    // for the file:// fallback above, or for feeding Vaylor a stylesheet
    // string you already have in memory.
    respondText: respondText,

    // Standalone — call this if you don't need the CSS transform at all,
    // just the auto header/nav → hamburger behavior.
    initNav: initMobileNav,

    explain: function (selector) {
      var found = _explainLog[selector];
      if (!found) {
        console.log('Vaylor.explain: no generated CSS found for "' + selector + '". ' +
          'Available selectors: ' + Object.keys(_explainLog).join(', '));
        return null;
      }
      console.log(found);
      return found;
    },

    // Exposed for testing / advanced use
    _fluidClamp: fluidClamp,
    _transformCSS: transformCSS
  };

  // Support local, no-server testing out of the box: if the page never
  // calls respond() at all but does have inline text/vaylor style tags,
  // compile them automatically once the DOM is ready.
  window.addEventListener('DOMContentLoaded', function () {
    if (document.querySelectorAll('style[type="text/vaylor"]').length && !document.getElementById(STYLE_ID)) {
      scanDocumentForStyles();
    }
  });

  global.Vaylor = Vaylor;
})(typeof window !== 'undefined' ? window : this);
// Rose diffraction outlines on large white type. The ambient-wave renderer owns
// the clock and supplies its actual annuli; this module never starts a loop.
const TARGETS = 'h1,h2,h3,h4,.card-copy strong,.contact-method strong,.contact-method-label,.hero-scroll-label,.action,.project-detail-link,.category-tabs button,.subcategory-row button,.preview-toolbar,.selection-heading,.detail-next-copy strong';
const EXCLUDED = 'nav,.header,dialog,[role="dialog"],[aria-modal="true"],[hidden],.sr-only,svg,canvas,script,style,[aria-hidden="true"]';
const PIXEL_BUDGET = 900000, MAX_TARGETS = 160, MAX_GLYPHS = 1600;

export function createAmbientTextFlow() {
  const canvas = document.createElement('canvas');
  canvas.id = 'ambient-text-flow-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.noTranslate = '';
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100vh;z-index:11;pointer-events:none;user-select:none;contain:strict;';
  canvas.hidden = true;
  document.body.append(canvas);
  const context = canvas.getContext('2d', {alpha: true});
  const main = document.querySelector('main');
  if (!context || !main) return {render() {}, clear() {}, resize() {}, destroy() { canvas.remove(); }};

  let width = 1, height = 1, destroyed = false, painted = false;
  let structureDirty = true, layoutDirty = true, targets = [], runs = [];
  const visible = new Set(), metrics = new Map();
  const letterSpacingSupported = 'letterSpacing' in context;
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;
  let layoutJob = null;
  const useIdleCallback = typeof window.requestIdleCallback === 'function';
  function queueLayout() {
    if (destroyed || document.hidden || layoutJob !== null) return;
    const prepare = () => {
      layoutJob = null;
      if (!destroyed && !document.hidden && (structureDirty || layoutDirty)) rebuildLayout();
    };
    layoutJob = useIdleCallback ? requestIdleCallback(prepare) : setTimeout(prepare, 100);
  }
  const invalidateLayout = () => { layoutDirty = true; queueLayout(); };
  const invalidateStructure = () => { structureDirty = true; invalidateLayout(); };
  const viewportObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      if (entry.isIntersecting && !visible.has(entry.target)) { visible.add(entry.target); changed = true; }
      else if (!entry.isIntersecting && visible.delete(entry.target)) changed = true;
    }
    if (changed) invalidateLayout();
  }, {rootMargin: '220px 0px'}) : null;
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidateLayout) : null;
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.type === 'attributes')) structureDirty = true;
    invalidateLayout();
  });
  // Per-frame shader custom properties/data attributes do not invalidate type.
  mutations.observe(main, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'lang']});
  resizeObserver?.observe(main);
  window.addEventListener('portfolio:languagechange', invalidateStructure);
  main.addEventListener('load', invalidateLayout, true);
  document.fonts?.addEventListener('loadingdone', invalidateLayout);
  if (!viewportObserver) window.addEventListener('scroll', invalidateLayout, {passive: true});

  function clear() {
    if (destroyed) return;
    if (painted) context.clearRect(0, 0, width, height);
    painted = false;
    canvas.hidden = true;
  }

  function resize(nextWidth, nextHeight) {
    if (destroyed) return;
    width = Math.max(1, nextWidth || 1);
    height = Math.max(1, nextHeight || 1);
    const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(PIXEL_BUDGET / (width * height)));
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    painted = false;
    canvas.hidden = true;
    invalidateLayout();
  }

  function refreshTargets() {
    viewportObserver?.disconnect();
    resizeObserver?.disconnect();
    resizeObserver?.observe(main);
    visible.clear();
    targets = [...main.querySelectorAll(TARGETS)].filter(target => !target.closest(EXCLUDED)).slice(0, MAX_TARGETS);
    for (const target of targets) {
      // Seed the first render before IntersectionObserver's asynchronous report.
      const rect = target.getBoundingClientRect();
      if (rect.width && rect.height && rect.bottom >= -220 && rect.top <= height + 220) visible.add(target);
      viewportObserver?.observe(target);
      resizeObserver?.observe(target);
    }
    structureDirty = false;
    layoutDirty = true;
  }

  function whiteType(style, parent) {
    if (style.visibility !== 'visible' || Number(style.opacity) < .65) return false;
    const channels = style.color.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3) return false;
    if ((channels[3] ?? 1) < .7) {
      // Contact hover replaces its cold-white fill with the existing clipped
      // white starlight gradient; it is still the same visible white lettering.
      return parent.matches('.contact-method strong') && style.backgroundClip.includes('text') && style.backgroundImage !== 'none';
    }
    const rgb = channels.slice(0, 3);
    // Include the site's cold whites (#f4f7ff, #dceaf6), not its blue/pink labels.
    return Math.min(...rgb) >= 208 && Math.max(...rgb) - Math.min(...rgb) <= 52;
  }

  function fontFor(style) {
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  }

  function minimumOutlineSize() {
    // The shared shell contains this benchmark even when its home panel is hidden.
    // Read its computed type size once per layout rebuild, never once per frame.
    const benchmark = document.getElementById('home-projects-title');
    const size = benchmark ? parseFloat(getComputedStyle(benchmark).fontSize) : NaN;
    if (Number.isFinite(size) && size > 0) return size;
    // work.html has no home panel. Match home-layout.css's actual cascade:
    // clamp(30px,3.2vw,44px), overridden to 31px at max-width:600px.
    return matchMedia('(max-width:600px)').matches ? 31 : Math.min(44, Math.max(30, innerWidth * .032));
  }

  function applyFont(run) {
    context.font = run.font;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.direction = 'ltr';
    if ('fontKerning' in context) context.fontKerning = run.kerning;
    if (letterSpacingSupported) context.letterSpacing = run.spacing;
  }

  function textMetrics(run, text) {
    const key = `${run.font}|${run.spacing}|${run.kerning}|${text}`;
    if (metrics.has(key)) return metrics.get(key);
    applyFont(run);
    const measured = context.measureText(text);
    const value = {width: measured.width, ascent: measured.fontBoundingBoxAscent ?? run.size * .8, descent: measured.fontBoundingBoxDescent ?? run.size * .2};
    if (metrics.size >= 500) metrics.delete(metrics.keys().next().value);
    metrics.set(key, value);
    return value;
  }

  function rebuildLayout() {
    if (structureDirty) refreshTargets();
    runs = [];
    const visited = new Set(), styles = new Map();
    const pageLeft = scrollX, pageTop = scrollY;
    const minimumSize = minimumOutlineSize();
    let glyphCount = 0;
    const range = document.createRange();
    const activeTargets = viewportObserver ? visible : targets;
    for (const target of activeTargets) {
      if (!target.isConnected || target.closest(EXCLUDED)) continue;
      const clip = target.getBoundingClientRect();
      if (!clip.width || !clip.height || clip.bottom < -220 || clip.top > height + 220) continue;
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (visited.has(node) || !node.textContent.trim() || node.parentElement.closest(EXCLUDED)) continue;
        visited.add(node);
        const parent = node.parentElement;
        let style = styles.get(parent);
        if (!style) { style = getComputedStyle(parent); styles.set(parent, style); }
        const size = parseFloat(style.fontSize);
        if (!Number.isFinite(size) || size < minimumSize) continue;
        if (!whiteType(style, parent) || style.direction === 'rtl' || style.writingMode !== 'horizontal-tb') continue;
        const source = node.textContent;
        // This deliberately targets compact titles/labels, not body paragraphs.
        if (source.length > 320) continue;
        const options = {font: fontFor(style), size, spacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing, kerning: style.fontKerning || 'auto'};
        const parts = segmenter ? [...segmenter.segment(source)].map(part => ({text: part.segment, index: part.index})) : (() => {
          let index = 0;
          return Array.from(source, text => { const part = {text, index}; index += text.length; return part; });
        })();
        const lines = [];
        let line;
        for (const part of parts) {
          if (++glyphCount > MAX_GLYPHS) break;
          range.setStart(node, part.index);
          range.setEnd(node, part.index + part.text.length);
          const rect = range.getBoundingClientRect();
          if (!rect.width || !rect.height) continue;
          // Range rects give native wrapping/alignment, including nested title spans.
          if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.left >= clip.right) continue;
          let text = part.text.replace(/\s/g, ' ');
          if (style.textTransform === 'uppercase') text = text.toUpperCase();
          else if (style.textTransform === 'lowercase') text = text.toLowerCase();
          if (!line || Math.abs(line.top - rect.top) > 1 || rect.left < line.left - 1) {
            line = {text: '', left: rect.left, right: rect.right, top: rect.top, height: rect.height, glyphs: []};
            lines.push(line);
          }
          line.text += text;
          line.right = Math.max(line.right, rect.right);
          line.glyphs.push({text, left: rect.left});
        }
        for (const line of lines) {
          if (!line.text.trim()) continue;
          const measured = textMetrics(options, line.text);
          const baseline = line.top + (line.height - measured.ascent - measured.descent) / 2 + measured.ascent;
          const bounds = {left: Math.max(clip.left, line.left) + pageLeft, right: Math.min(clip.right, line.right) + pageLeft,
            top: Math.max(clip.top, line.top) + pageTop, bottom: Math.min(clip.bottom, line.top + line.height) + pageTop};
          const fallback = !letterSpacingSupported && parseFloat(options.spacing) !== 0;
          runs.push({...options, text: line.text, x: line.left + pageLeft, y: baseline + pageTop, bounds,
            glyphs: fallback ? line.glyphs.map(glyph => ({text: glyph.text, x: glyph.left + pageLeft})) : null});
        }
        if (glyphCount > MAX_GLYPHS) break;
      }
      if (glyphCount > MAX_GLYPHS) break;
    }
    layoutDirty = false;
  }

  function radialLight(band) {
    const gradient = context.createRadialGradient(band.cx, band.cy, band.inner, band.cx, band.cy, band.outer);
    const edge = 'rgba(117,25,74,0)';
    const rose = 'rgba(117,25,74,.62)';
    const crest = 'rgba(213,49,121,.98)';
    const coolPink = 'rgba(229,105,174,.94)';
    const lilac = 'rgba(163,132,219,.92)';
    const blueWhite = 'rgba(207,230,250,.88)';
    const stops = [[0, edge], [.025, rose], [.975, rose], [1, edge]];
    const phase = ((band.elapsed * .55) % .5 + .5) % .5;
    // Small spectral splits travel with each radial crest. Most of the outline
    // remains deep rose against white; the blue-white split is a narrow ridge.
    // At most 28 native stops per band, with no extra surface, loop or shader.
    const split = Math.min(.035, Math.max(.008, 1.5 / (band.outer - band.inner)));
    const grating = [[-.12, rose], [-2.5 * split, crest], [-1.3 * split, coolPink],
      [-.55 * split, lilac], [0, crest], [.45 * split, blueWhite],
      [1.1 * split, lilac], [2.4 * split, crest], [.12, rose]];
    for (let center = phase - .5; center < 1.5; center += .5) {
      for (const [offset, color] of grating) {
        const at = center + offset;
        if (at > .025 && at < .975) stops.push([at, color]);
      }
    }
    stops.sort((a, b) => a[0] - b[0]);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    return gradient;
  }

  function strokeRun(run, left, top) {
    applyFont(run);
    if (run.glyphs) {
      for (const glyph of run.glyphs) context.strokeText(glyph.text, glyph.x - left, run.y - top);
    } else context.strokeText(run.text, run.x - left, run.y - top);
  }

  function render(bands, view) {
    if (destroyed) return;
    if (!bands.length || document.hidden || window.PortfolioStartGate?.active) { clear(); return; }
    if (width !== view.width || height !== view.height) resize(view.width, view.height);
    // A cold cache must never block the frame that reveals the white ring.
    if (structureDirty || layoutDirty) {
      queueLayout();
      clear();
      return;
    }
    const left = view.left, top = view.top;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    if (painted) context.clearRect(0, 0, width, height);
    let drewOutline = false;
    context.lineJoin = 'round';
    context.miterLimit = 2;
    for (const band of bands.slice(0, 4)) {
      if (![band.cx, band.cy, band.outer, band.inner, band.elapsed].every(Number.isFinite) || band.outer <= band.inner || band.inner < 0) continue;
      const gradient = radialLight(band);
      context.strokeStyle = gradient;
      for (const run of runs) {
        const box = {left: run.bounds.left - left, right: run.bounds.right - left, top: run.bounds.top - top, bottom: run.bounds.bottom - top};
        if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
        const near = Math.hypot(Math.max(box.left - band.cx, 0, band.cx - box.right), Math.max(box.top - band.cy, 0, band.cy - box.bottom));
        const far = Math.hypot(Math.max(Math.abs(box.left - band.cx), Math.abs(box.right - band.cx)), Math.max(Math.abs(box.top - band.cy), Math.abs(box.bottom - band.cy)));
        if (near > band.outer + 2 || far < band.inner - 2) continue;
        drewOutline = true;
        context.save();
        context.beginPath();
        context.rect(box.left - 1, box.top - 1, box.right - box.left + 2, box.bottom - box.top + 2);
        context.clip();
        context.lineWidth = 2.3;
        context.globalAlpha = .2;
        strokeRun(run, left, top);
        context.lineWidth = 1.15;
        context.globalAlpha = 1;
        strokeRun(run, left, top);
        context.restore();
      }
    }
    painted = drewOutline;
    canvas.hidden = !drewOutline;
  }

  function destroy() {
    if (destroyed) return;
    clear();
    destroyed = true;
    if (layoutJob !== null) {
      if (useIdleCallback) cancelIdleCallback(layoutJob);
      else clearTimeout(layoutJob);
    }
    mutations.disconnect();
    viewportObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('portfolio:languagechange', invalidateStructure);
    main.removeEventListener('load', invalidateLayout, true);
    document.fonts?.removeEventListener('loadingdone', invalidateLayout);
    window.removeEventListener('scroll', invalidateLayout);
    targets = runs = [];
    visible.clear(); metrics.clear();
    canvas.remove();
  }
  return {render, clear, resize, destroy};
}

// This small classic script runs before the page modules and before first paint.
// No markup is hidden unless this controller can also release it.
(() => {
  const sessionKey = 'portfolio-started-v1';
  const root = document.documentElement;
  let seen = false;
  try { seen = sessionStorage.getItem(sessionKey) === '1'; } catch { /* Optional storage. */ }
  if (seen) {
    window.PortfolioStartGate = Object.freeze({active: false, started: false, enteredAt: null, mount() {}});
    return;
  }

  let active = true, started = false, dialog, ready = false, appReady = false;
  let enteredAt = null;
  let deadline, bootDeadline, language = 'zh';
  let previousFocus, scrollStyles, disposeFilm;
  const pendingCleanup = new Set();
  const tasks = new Map([['page', null], ['type', null], ['brand', null], ['covers', null]]);
  try { language = localStorage.getItem('portfolio-language') === 'en' ? 'en' : 'zh'; } catch {}
  const words = language === 'en' ? {
    label: 'Enter portfolio', loading: 'Loading essentials', complete: 'Ready. Press Enter to start.',
    partial: 'Ready · some resources unavailable',
    escape: 'Press Escape to enter now.',
  } : {
    label: '进入作品集', loading: '正在加载首屏资源', complete: '准备就绪，按 Enter 进入',
    partial: '部分资源未就绪，可进入',
    escape: '可按 Esc 直接进入。',
  };

  function release(userInitiated = false, restoreFocus = true) {
    if (!active) return;
    enteredAt = userInitiated ? performance.now() : null;
    active = false;
    started = userInitiated;
    clearTimeout(deadline);
    clearTimeout(bootDeadline);
    disposeFilm?.();
    window.removeEventListener('portfolio:app-ready', onAppReady);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('DOMContentLoaded', mount);
    for (const cleanup of pendingCleanup) cleanup();
    pendingCleanup.clear();
    if (userInitiated) {
      try { sessionStorage.setItem(sessionKey, '1'); } catch {}
    }
    // Synchronous dispatch keeps the real button/keyboard activation for audio.play().
    // pagehide and recovery release the page without asking the soundtrack to play.
    window.dispatchEvent(new CustomEvent('portfolio:enter', {detail: {userInitiated, enteredAt}}));
    const x = scrollX, y = scrollY;
    if (dialog?.open) dialog.close();
    dialog?.remove();
    root.removeAttribute('data-start-gate');
    if (scrollStyles) {
      for (const [node, value, priority] of scrollStyles) {
        if (value) node.style.setProperty('overflow', value, priority);
        else node.style.removeProperty('overflow');
      }
      window.scrollTo({left: x, top: y, behavior: 'instant'});
    }
    if (!restoreFocus || !dialog) return;
    let destination;
    try { destination = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch {}
    destination ||= previousFocus && previousFocus !== document.body && previousFocus.isConnected
      ? previousFocus : document.querySelector('main');
    if (destination) {
      if (!destination.hasAttribute('tabindex')) destination.setAttribute('tabindex', '-1');
      destination.focus({preventScroll: true});
    }
  }

  function paint() {
    if (!active || !dialog) return;
    const checked = [...tasks.values()].filter(value => value !== null).length;
    const complete = checked === tasks.size;
    const failed = [...tasks.values()].some(value => value === false);
    dialog.style.setProperty('--start-progress', `${checked / tasks.size * 100}%`);
    const status = dialog.querySelector('.start-gate-status');
    if (status) status.textContent = complete
      ? (failed ? words.partial : words.complete) : `${words.loading} ${checked}/${tasks.size}。 ${words.escape}`;
    dialog.dataset.ready = String(complete);
    if (!complete || ready) return;
    ready = true;
    clearTimeout(deadline);
    const button = dialog.querySelector('.start-gate-start');
    if (!button) return;
    button.disabled = false;
    if (document.activeElement === dialog) button.focus({preventScroll: true});
  }

  function settle(name, success) {
    if (!active || tasks.get(name) !== null) return;
    tasks.set(name, success);
    paint();
  }

  function imageReady(image) {
    return new Promise(resolve => {
      let done = false;
      const cleanup = () => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
        pendingCleanup.delete(cleanup);
      };
      const finish = success => {
        if (done) return;
        done = true;
        cleanup();
        resolve(success);
      };
      const loaded = () => {
        if (image.decode) image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0));
        else finish(image.naturalWidth > 0);
      };
      const failed = () => finish(false);
      pendingCleanup.add(cleanup);
      image.addEventListener('load', loaded, {once: true});
      image.addEventListener('error', failed, {once: true});
      if (image.complete) image.naturalWidth ? loaded() : failed();
    });
  }

  function prepareCovers() {
    // Read the rendered route, including a saved category or direct work URL.
    // Only warm two initial covers; videos, embeds and breakdown images stay lazy.
    let images = [...document.querySelectorAll('#detail-player img, #project-preview img')]
      .filter(image => !image.closest('[hidden]'));
    const grid = document.querySelector('[data-view-panel="works"]:not([hidden]) #project-grid')
      || document.querySelector('[data-view-panel="top"]:not([hidden]) #home-project-grid');
    if (grid) images.push(...grid.querySelectorAll('img'));
    const seenSources = new Set();
    images = images.filter(image => {
      const src = image.currentSrc || image.src;
      if (!src || seenSources.has(src)) return false;
      seenSources.add(src);
      return true;
    }).slice(0, 2);
    for (const image of images) image.loading = 'eager';
    Promise.all(images.map(imageReady)).then(results => settle('covers', results.every(Boolean)));
  }

  function onAppReady() {
    if (!active || appReady) return;
    appReady = true;
    settle('page', true);
    prepareCovers();
    // Wait for layout's actual font set, after the initial app has rendered text.
    Promise.resolve(document.fonts?.ready).then(
      () => settle('type', !document.fonts || [...document.fonts].every(font => font.status !== 'error')),
      () => settle('type', false),
    );
  }

  function onPageHide() { release(false, false); }

  function mountStartFilm(button) {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const properties = ['--film-x', '--film-y', '--film-angle', '--film-shift-x', '--film-shift-y'];
    let frame = 0, bounds, x = .5, y = .5;
    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      bounds = null;
      for (const property of properties) button.style.removeProperty(property);
    }
    function paintFilm() {
      frame = 0;
      if (!active || document.hidden || motion.matches || button.disabled) return;
      button.style.setProperty('--film-x', `${(x * 100).toFixed(2)}%`);
      button.style.setProperty('--film-y', `${(y * 100).toFixed(2)}%`);
      button.style.setProperty('--film-angle', `${(108 + (x - .5) * 32 + (y - .5) * 16).toFixed(2)}deg`);
      button.style.setProperty('--film-shift-x', `${(15 + x * 70).toFixed(2)}%`);
      button.style.setProperty('--film-shift-y', `${(35 + y * 30).toFixed(2)}%`);
    }
    function move(event) {
      if (!active || button.disabled || motion.matches || document.hidden || event.pointerType === 'touch') return;
      bounds ||= button.getBoundingClientRect();
      x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
      // Coalesce pointer input only; a stationary pointer has no animation loop.
      if (!frame) frame = requestAnimationFrame(paintFilm);
    }
    function pointerDown(event) { if (event.pointerType === 'touch') reset(); }
    function visibility() { if (document.hidden) reset(); }
    button.addEventListener('pointerenter', move, {passive: true});
    button.addEventListener('pointermove', move, {passive: true});
    button.addEventListener('pointerleave', reset);
    button.addEventListener('pointercancel', reset);
    button.addEventListener('pointerdown', pointerDown, {passive: true});
    button.addEventListener('keydown', reset);
    window.addEventListener('resize', reset, {passive: true});
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', reset);
    return () => {
      reset();
      button.removeEventListener('pointerenter', move);
      button.removeEventListener('pointermove', move);
      button.removeEventListener('pointerleave', reset);
      button.removeEventListener('pointercancel', reset);
      button.removeEventListener('pointerdown', pointerDown);
      button.removeEventListener('keydown', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', reset);
    };
  }

  function mount() {
    if (!active || dialog || !document.body) return;
    try {
      // If the stylesheet or native dialog capability is unavailable, keep the page usable.
      if (getComputedStyle(root).getPropertyValue('--start-gate-styles').trim() !== 'ready'
        || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) {
        release(false, false);
        return;
      }
      clearTimeout(bootDeadline);
      previousFocus = document.activeElement;
      dialog = document.createElement('dialog');
      dialog.className = 'start-gate';
      dialog.dataset.clickEffects = 'off';
      dialog.dataset.noTranslate = '';
      dialog.lang = language === 'en' ? 'en' : 'zh-CN';
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', words.label);
      dialog.setAttribute('aria-describedby', 'start-gate-status');
      dialog.tabIndex = -1;
      dialog.innerHTML = `
        <div class="start-gate-content">
          <button class="start-gate-start" type="button" aria-label="START · ${words.label}" disabled><span class="start-gate-label">START</span></button>
          <span class="start-gate-progress" aria-hidden="true"><span class="start-gate-progress-fill"></span></span>
          <span class="start-gate-status" id="start-gate-status" role="status" aria-live="polite">${words.loading}。 ${words.escape}</span>
        </div>`;
      const button = dialog.querySelector('.start-gate-start');
      button.addEventListener('click', () => release(true));
      disposeFilm = mountStartFilm(button);
      dialog.addEventListener('cancel', event => { event.preventDefault(); release(true); });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const buttons = [...dialog.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { event.preventDefault(); dialog.focus({preventScroll: true}); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      });
      document.body.prepend(dialog);
      // Native modal inertness includes nodes that the parser/modules append later.
      dialog.showModal();
      scrollStyles = [root, document.body].map(node => [node, node.style.getPropertyValue('overflow'), node.style.getPropertyPriority('overflow')]);
      root.style.setProperty('overflow', 'hidden');
      document.body.style.setProperty('overflow', 'hidden');
      root.dataset.startGate = 'open';
      dialog.focus({preventScroll: true});
      // Warm the actual header mark without adding decoration to the entry screen.
      const brandImage = new Image();
      brandImage.src = './brand-logo.svg';
      imageReady(brandImage).then(success => settle('brand', success));
      deadline = setTimeout(() => {
        for (const [name, value] of tasks) if (value === null) tasks.set(name, false);
        paint();
        for (const cleanup of pendingCleanup) cleanup();
        pendingCleanup.clear();
        window.removeEventListener('portfolio:app-ready', onAppReady);
      }, 8000);
      paint();
    } catch { release(false, false); }
  }

  window.PortfolioStartGate = Object.freeze({get active() { return active; }, get started() { return started; }, get enteredAt() { return enteredAt; }, mount});
  window.addEventListener('portfolio:app-ready', onAppReady);
  window.addEventListener('pagehide', onPageHide, {once: true});
  document.addEventListener('DOMContentLoaded', mount, {once: true});
  // A broken or missing mount call never leaves the early paint cover in place.
  bootDeadline = setTimeout(() => { if (!dialog) release(false, false); }, 12000);
  root.dataset.startGate = 'pending';
})();

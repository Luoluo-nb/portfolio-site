// This small classic script runs before the page modules and before first paint.
// No markup is hidden unless this controller can also release it.
(() => {
  const sessionKey = 'portfolio-started-v1';
  const root = document.documentElement;
  let seen = false;
  try { seen = sessionStorage.getItem(sessionKey) === '1'; } catch { /* Optional storage. */ }
  if (seen) {
    window.PortfolioStartGate = Object.freeze({active: false, started: false, mount() {}});
    return;
  }

  let active = true, started = false, dialog, ready = false, appReady = false;
  let deadline, bootDeadline, language = 'zh';
  let previousFocus, scrollStyles;
  const pendingCleanup = new Set();
  const tasks = new Map([['page', null], ['type', null], ['brand', null], ['covers', null]]);
  try { language = localStorage.getItem('portfolio-language') === 'en' ? 'en' : 'zh'; } catch {}
  const words = language === 'en' ? {
    title: 'Zhang Zhiyuan', role: 'ARTIST / TECHNICAL ARTIST', label: 'Enter portfolio',
    loading: 'Preparing your first view', complete: 'Ready to explore',
    partial: 'You can enter · some resources are still unavailable',
    skip: 'Skip loading', enter: 'Enter portfolio', progress: 'Essential resources checked',
    hint: 'Start with sound · audio controls are in the header',
  } : {
    title: '张致远', role: '美术 / 技术美术', label: '进入作品集',
    loading: '正在准备首屏内容', complete: '准备就绪',
    partial: '可以进入 · 部分资源暂未就绪',
    skip: '跳过加载', enter: '进入作品集', progress: '首屏资源已检查',
    hint: '点击开启音乐 · 可在顶部暂停或静音',
  };

  function release(userInitiated = false, restoreFocus = true) {
    if (!active) return;
    active = false;
    started = userInitiated;
    clearTimeout(deadline);
    clearTimeout(bootDeadline);
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
    window.dispatchEvent(new CustomEvent('portfolio:enter', {detail: {userInitiated}}));
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
    const progress = dialog.querySelector('progress');
    progress.value = checked;
    dialog.querySelector('.start-gate-count').textContent = `${String(checked).padStart(2, '0')} / 04`;
    dialog.querySelector('.start-gate-status').textContent = complete
      ? (failed ? words.partial : words.complete) : words.loading;
    dialog.dataset.ready = String(complete);
    if (!complete || ready) return;
    ready = true;
    clearTimeout(deadline);
    const button = dialog.querySelector('.start-gate-start');
    const skip = dialog.querySelector('.start-gate-skip');
    button.disabled = false;
    if (document.activeElement === skip || document.activeElement === dialog) button.focus({preventScroll: true});
    skip.hidden = true;
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
      dialog.setAttribute('aria-labelledby', 'start-gate-title');
      dialog.setAttribute('aria-describedby', 'start-gate-status');
      dialog.tabIndex = -1;
      dialog.innerHTML = `
        <div class="start-gate-top"><span>ZY / PORTFOLIO</span><span>WELCOME</span></div>
        <div class="start-gate-content">
          <img class="start-gate-logo" src="./brand-logo.svg" width="64" height="64" alt="">
          <p class="start-gate-name" id="start-gate-title">${words.title}</p>
          <p class="start-gate-role">${words.role}</p>
          <button class="start-gate-start" type="button" aria-label="${words.label}" disabled>
            <span>START</span><span class="start-gate-arrow" aria-hidden="true">↗</span>
          </button>
          <div class="start-gate-loading">
            <div class="start-gate-progress-label"><span class="start-gate-status" id="start-gate-status" role="status" aria-live="polite">${words.loading}</span><span class="start-gate-count" aria-hidden="true">00 / 04</span></div>
            <progress max="4" value="0" aria-label="${words.progress}"></progress>
          </div>
          <div class="start-gate-skip-slot"><button class="start-gate-skip" type="button">${words.skip}</button></div>
        </div>
        <p class="start-gate-footnote">${words.hint}</p>`;
      dialog.querySelector('.start-gate-start').addEventListener('click', () => release(true));
      dialog.querySelector('.start-gate-skip').addEventListener('click', () => release(true));
      dialog.addEventListener('cancel', event => { event.preventDefault(); release(true); });
      dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const buttons = [...dialog.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden);
        const first = buttons[0], last = buttons[buttons.length - 1];
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
      imageReady(dialog.querySelector('img')).then(success => settle('brand', success));
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

  window.PortfolioStartGate = Object.freeze({get active() { return active; }, get started() { return started; }, mount});
  window.addEventListener('portfolio:app-ready', onAppReady);
  window.addEventListener('pagehide', onPageHide, {once: true});
  document.addEventListener('DOMContentLoaded', mount, {once: true});
  // A broken or missing mount call never leaves the early paint cover in place.
  bootDeadline = setTimeout(() => { if (!dialog) release(false, false); }, 12000);
  root.dataset.startGate = 'pending';
})();

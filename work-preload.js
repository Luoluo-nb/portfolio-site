const detailAssets = [
  './work.js',
  './work.css',
  './project-details.js',
  './image-viewer.js',
  './image-viewer.css',
];
const requestLimit = 16;
let installed = false;

export function setupWorkPreload(initialUrls = [], initialCovers = []) {
  if (installed || !['http:', 'https:'].includes(location.protocol)) return;
  installed = true;

  const detailPage = new URL('./work.html', location.href);
  const mediaDirectory = new URL('./media/', detailPage);
  const used = new Set();
  const pendingFetches = new Map();
  const supportsPrefetch = document.createElement('link').relList?.supports?.('prefetch');
  const idleCallback = typeof window.requestIdleCallback === 'function';
  let idleHandle;
  let suspended = false;
  let initialWarmingDone = false;

  function canWarmCache() {
    const connection = navigator.connection;
    return !suspended && !document.hidden && navigator.onLine !== false
      && !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType);
  }

  function detailUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try {
      url = new URL(value, location.href);
    } catch {
      return null;
    }
    if (url.origin !== detailPage.origin || url.pathname !== detailPage.pathname
      || url.username || url.password || !/^\?id=[\w-]+$/.test(url.search)) return null;
    url.hash = '';
    return url.href;
  }

  function warm(url) {
    if (!url || !canWarmCache() || used.size >= requestLimit || used.has(url)) return;
    used.add(url);
    if (supportsPrefetch) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      link.fetchPriority = 'low';
      link.addEventListener('load', () => link.remove(), {once: true});
      link.addEventListener('error', () => link.remove(), {once: true});
      document.head.append(link);
      return;
    }
    // Consume these small same-origin resources so the HTTP cache receives
    // their full response even when the browser lacks link prefetch.
    const controller = new AbortController();
    pendingFetches.set(url, controller);
    fetch(url, {
      credentials: 'same-origin',
      cache: 'force-cache',
      mode: 'same-origin',
      priority: 'low',
      signal: controller.signal,
    }).then(response => response.ok ? response.arrayBuffer() : undefined)
      .catch(() => {})
      .finally(() => {
        if (pendingFetches.get(url) === controller) pendingFetches.delete(url);
      });
  }

  function warmInitial() {
    idleHandle = undefined;
    if (!canWarmCache()) return;
    initialWarmingDone = true;
    for (const href of initialUrls.slice(0, 2)) warm(detailUrl(href));
    if (location.pathname !== detailPage.pathname) {
      for (const path of detailAssets) warm(new URL(path, detailPage).href);
    }
    for (const cover of initialCovers.slice(0, 2)) {
      const url = new URL(cover, detailPage);
      if (url.origin === mediaDirectory.origin && url.pathname.startsWith(mediaDirectory.pathname)
        && /\.(?:jpg|webp|png)$/i.test(url.pathname)) warm(url.href);
    }
  }

  function scheduleInitial() {
    if (initialWarmingDone || idleHandle !== undefined || !canWarmCache()) return;
    idleHandle = idleCallback
      ? requestIdleCallback(warmInitial, {timeout: 1200})
      : setTimeout(warmInitial, 180);
  }

  function cancelInitial() {
    if (idleHandle === undefined) return;
    if (idleCallback) cancelIdleCallback(idleHandle);
    else clearTimeout(idleHandle);
    idleHandle = undefined;
  }

  function warmOnIntent(event) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest('a[data-preload-work][href]');
    if (!link) return;
    if (event.type === 'pointerover' && event.relatedTarget instanceof Node
      && link.contains(event.relatedTarget)) return;
    warm(detailUrl(link.href));
  }

  document.addEventListener('pointerover', warmOnIntent, {passive: true});
  document.addEventListener('pointerdown', warmOnIntent, {passive: true});
  document.addEventListener('focusin', warmOnIntent);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelInitial();
    else scheduleInitial();
  });
  window.addEventListener('online', scheduleInitial);
  window.addEventListener('pagehide', () => {
    suspended = true;
    cancelInitial();
    if (pendingFetches.size) initialWarmingDone = false;
    for (const [url, controller] of pendingFetches) {
      controller.abort();
      used.delete(url);
    }
    pendingFetches.clear();
  });
  window.addEventListener('pageshow', () => {
    suspended = false;
    scheduleInitial();
  });
  scheduleInitial();
}

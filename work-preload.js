const detailAssets = [
  './work.js',
  './work.css',
  './project-details.js',
  './image-viewer.js',
  './image-viewer.css',
];
const requestLimit = 16;
let startupPreparation;

export function setupWorkPreload(initialUrls = [], initialCovers = []) {
  if (startupPreparation) return startupPreparation;
  if (!['http:', 'https:'].includes(location.protocol)) return Promise.resolve(true);

  const detailPage = new URL('./work.html', location.href);
  const mediaPathPrefix = new URL('media', detailPage).pathname + '/';
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

  function localUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    let url;
    try {
      url = new URL(value, detailPage);
    } catch {
      return null;
    }
    if (url.origin !== detailPage.origin || url.username || url.password) return null;
    url.hash = '';
    return url;
  }

  function detailUrl(value) {
    const url = localUrl(value);
    return url?.pathname === detailPage.pathname && /^\?id=[\w-]+$/.test(url.search)
      ? url.href
      : null;
  }

  function coverUrl(value) {
    const url = localUrl(value);
    return url?.pathname.startsWith(mediaPathPrefix) && /\.(?:jpe?g|webp|png)$/i.test(url.pathname)
      ? url.href
      : null;
  }

  function warm(url, waitForBytes = false) {
    if (!url || !canWarmCache() || used.size >= requestLimit || used.has(url)) {
      return Promise.resolve(true);
    }
    used.add(url);
    if (!waitForBytes && supportsPrefetch) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      link.fetchPriority = 'low';
      link.addEventListener('load', () => link.remove(), {once: true});
      link.addEventListener('error', () => link.remove(), {once: true});
      document.head.append(link);
      return Promise.resolve(true);
    }
    // Consume these small same-origin resources so the HTTP cache receives
    // their full response before START marks the preparation task complete.
    const controller = new AbortController();
    pendingFetches.set(url, controller);
    return fetch(url, {
      credentials: 'same-origin',
      cache: 'force-cache',
      mode: 'same-origin',
      priority: 'low',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return false;
      await response.arrayBuffer();
      return true;
    })
      .catch(() => false)
      .finally(() => {
        if (pendingFetches.get(url) === controller) pendingFetches.delete(url);
      });
  }

  function warmInitial(waitForBytes = false) {
    idleHandle = undefined;
    if (!canWarmCache()) return Promise.resolve(true);
    initialWarmingDone = true;
    const assets = location.pathname === detailPage.pathname
      ? []
      : detailAssets.map(path => new URL(path, detailPage).href);
    const resources = new Set([
      ...assets,
      ...initialUrls.slice(0, 2).map(detailUrl),
      ...initialCovers.slice(0, 2).map(coverUrl),
    ]);
    return Promise.all([...resources].map(url => warm(url, waitForBytes)))
      .then(results => results.every(Boolean));
  }

  function scheduleInitial() {
    if (initialWarmingDone || idleHandle !== undefined || !canWarmCache()) return;
    const run = () => warmInitial();
    idleHandle = idleCallback
      ? requestIdleCallback(run, {timeout: 1200})
      : setTimeout(run, 180);
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
    warm(coverUrl(link.dataset.preloadWork));
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
  const gateActive = window.PortfolioStartGate?.active;
  startupPreparation = gateActive ? warmInitial(true) : Promise.resolve(true);
  if (!gateActive) scheduleInitial();
  return startupPreparation;
}

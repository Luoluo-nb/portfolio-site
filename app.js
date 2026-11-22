import { bilibiliVideoUrl, profile, projects } from './content.js';
import { Starfield } from './starfield.js';
import { renderVideoChapters } from './video-chapters.js';
import { setupWorkPreload } from './work-preload.js';
import './player-nebula.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let activeCategory = 'all';
let activeSubcategory = 'all';
let selected = null;
let activeView = 'top';
let savedProjectId = null;
try {
  const saved = JSON.parse(sessionStorage.getItem('portfolio-selection') || 'null');
  if (saved) {
    activeCategory = ['unity','unreal','td'].includes(saved.category) ? saved.category : 'all';
    activeSubcategory = activeCategory === 'unreal' && saved.subcategory === 'vehicle' ? 'vehicle' : 'all';
    savedProjectId = saved.projectId;
  }
} catch { /* Navigation works without storage. */ }
function saveSelection() {
  try { sessionStorage.setItem('portfolio-selection', JSON.stringify({category:activeCategory,subcategory:activeSubcategory,projectId:selected?.id})); } catch {}
}
const categoryName = (category) => ({unity:'UNITY',unreal:'UNREAL ENGINE',td:'TD'}[category] || '作品合集');
const announce = (message) => { $('announcement').textContent = message; };

let starfield;
try {
  starfield = new Starfield($('starfield-canvas'), {
    reducedMotion: reducedMotion.matches,
    onStatus({state}) { $('starfield-canvas').dataset.state = state; }
  });
} catch (error) {
  $('starfield-canvas').dataset.state = 'fallback';
  console.warn('星空背景使用静态显示', error);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
const speedStorageKey = 'portfolio-video-speed';
const validPlaybackSpeed = (value) => Number.isFinite(value) && value >= 0.25 && value <= 4;
let playbackSpeed = 1;
try {
  const savedSpeed = Number(localStorage.getItem(speedStorageKey));
  if (validPlaybackSpeed(savedSpeed)) playbackSpeed = savedSpeed;
} catch { /* Playback controls also work when storage is unavailable. */ }
function syncSpeedControl() {
  const control = $('playback-speed');
  control.querySelector('[data-custom-speed]')?.remove();
  if (![...control.options].some(option => Number(option.value) === playbackSpeed)) {
    const option = element('option', '', `${playbackSpeed}×`);
    option.value = String(playbackSpeed);
    option.dataset.customSpeed = '';
    control.append(option);
  }
  control.value = String(playbackSpeed);
}
function rememberPlaybackSpeed(value) {
  if (!validPlaybackSpeed(value)) return;
  playbackSpeed = value;
  syncSpeedControl();
  try { localStorage.setItem(speedStorageKey, String(value)); } catch { /* Optional preference. */ }
}
syncSpeedControl();
$('playback-speed').addEventListener('change', (event) => {
  rememberPlaybackSpeed(Number(event.target.value));
  const video = $('project-preview').querySelector('video');
  if (video) {
    video.defaultPlaybackRate = playbackSpeed;
    video.playbackRate = playbackSpeed;
  }
  announce(`播放速度：${playbackSpeed}倍`);
});
function replacePreview(...nodes) {
  const previousVideo = $('project-preview').querySelector('video');
  if (previousVideo) {
    previousVideo.pause();
    previousVideo.removeAttribute('src');
    previousVideo.load();
  }
  $('project-preview').replaceChildren(...nodes);
}
function createTypeCover(project) {
  const cover = element('span', 'project-type-cover', project.coverLabel || project.title);
  cover.setAttribute('aria-hidden', 'true');
  return cover;
}
function createPoster(project) {
  $('video-chapters')._chapterReset?.();
  if (!project.cover) return createTypeCover(project);
  if (!project.videoSrc) {
    const cover = element('figure', 'project-static-cover');
    const image = element('img');
    image.addEventListener('load', () => { image.style.maxWidth = image.naturalWidth+'px'; image.style.maxHeight = image.naturalHeight+'px'; }, {once:true});
    image.alt = project.title;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.src = project.cover;
    cover.append(image);
    return cover;
  }
  const button = element('button', 'poster-button');
  button.type = 'button';
  button.setAttribute('aria-label', `播放 ${project.title}`);
  const img = element('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.addEventListener('error', () => { img.hidden = true; }, {once:true});
  img.src = project.cover;
  const caption = element('span', 'poster-play');
  const playIcon = element('span', 'play-triangle');
  playIcon.setAttribute('aria-hidden', 'true');
  playIcon.innerHTML = '<svg viewBox="0 0 28 28" focusable="false"><path d="m10 7 11 7-11 7Z"/></svg>';
  caption.append(playIcon, element('span', '', '播放作品'));
  button.append(img, caption);
  button.addEventListener('click', () => openPlayer(project));
  return button;
}
function openPlayer(project, startTime = project.startTime ?? 0) {
  if (!project.videoSrc) return;
  const transferFocus = $('project-preview').contains(document.activeElement);
  const time = Number.isFinite(startTime) && startTime >= 0 ? startTime : 0;
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.loop = Boolean(project.loop);
  video.muted = video.defaultMuted = Boolean(project.muted);
  video.preload = 'metadata';
  video.poster = project.cover;
  video.src = project.videoSrc;
  video.defaultPlaybackRate = video.playbackRate = playbackSpeed;
  video.setAttribute('aria-label', project.title);
  video.addEventListener('ratechange', () => {
    if (video.isConnected && selected?.id === project.id) rememberPlaybackSpeed(video.playbackRate);
  });
  video.addEventListener('error', () => {
    if (!video.isConnected || selected?.id !== project.id) return;
    $('playback-help').textContent = '视频暂时无法加载，可通过「打开视频」重试。';
    $('playback-help').hidden = false;
  }, {once:true});
  const close = element('button', 'close-player');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭播放器');
  close.innerHTML = '<span class="player-close-glyph" aria-hidden="true"><svg class="player-close-orbit" viewBox="0 0 40 40" focusable="false"><path d="M10 6.8A16.5 16.5 0 0 1 36.2 23M30 33.2A16.5 16.5 0 0 1 3.8 17"/></svg><svg class="player-close-mark" viewBox="0 0 20 20" focusable="false"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></span><span class="player-close-label">关闭</span>';
  close.addEventListener('click', () => { replacePreview(createPoster(project)); $('playback-help').hidden = true; $('project-preview').querySelector('.poster-button')?.focus({preventScroll:true}); });
  replacePreview(video, close);
  $('playback-help').hidden = true;
  const seek = () => {
    if (!video.isConnected || $('project-preview').querySelector('video') !== video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.min(time, Math.max(0, video.duration - .05));
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener('loadedmetadata', seek, {once:true});
  // This is reached only from an explicit play or chapter action.
  video.play().catch(() => { /* Native controls remain available. */ });
  if (transferFocus) video.focus({preventScroll:true});
  announce(`正在播放：${project.title}`);
}
function selectProject(project, shouldScroll = false) {
  selected = project;
  replacePreview(createPoster(project));
  $('playback-controls').hidden = !project.videoSrc;
  renderVideoChapters($('video-chapters'), project.videoSrc ? project : null, () => $('project-preview').querySelector('video'), time => openPlayer(project, time));
  syncSpeedControl();
  $('project-title').textContent = project.title;
  $('project-platform').textContent = categoryName(project.category) + (project.subcategory === 'vehicle' ? ' / 车辆' : '');
  $('project-description').textContent = project.description || '';
  $('project-description').hidden = !project.description;
  const detailLink = $('project-detail-link');
  detailLink.hidden = project.externalOnly === true;
  if (project.externalOnly) detailLink.removeAttribute('href');
  else {
    detailLink.href = `./work.html?id=${encodeURIComponent(project.id)}`;
    detailLink.dataset.preloadWork = project.cover || '';
  }
  $('project-credits').replaceChildren();
  $('project-credits').hidden = !project.references?.length;
  for (const reference of project.references || []) {
    const link = element('a', '', `${reference.label} ↗`);
    link.href = reference.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('project-credits').append(link);
  }
  $('project-link').href = project.videoSrc || bilibiliVideoUrl(project);
  $('project-link').textContent = project.videoSrc ? '打开视频 ↗' : '在 Bilibili 打开 ↗';
  $('preview-index').textContent = `${String(projects.indexOf(project) + 1).padStart(2,'0')} / ${String(projects.length).padStart(2,'0')}`;
  $('playback-help').hidden = true;
  for (const item of document.querySelectorAll('#project-grid .project-card')) {
    const current = item.dataset.id === project.id;
    item.dataset.selected = String(current);
    if (current) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  }
  if (shouldScroll && matchMedia('(max-width:760px)').matches) $('project-preview').scrollIntoView({behavior:reducedMotion.matches ? 'instant' : 'smooth', block:'start'});
  announce(`已选择：${project.title}`);
  savedProjectId = project.id;
  saveSelection();
}
function showEmpty() {
  selected = null;
  $('playback-controls').hidden = true;
  renderVideoChapters($('video-chapters'), null);
  $('project-detail-link').hidden = true;
  const state = element('div','empty-preview');
  state.append(element('div','empty-symbol','＋'),element('span','empty-kicker','新的作品'),element('h3','','作品待补充'),element('p','','此分类暂无作品。'));
  replacePreview(state);
  $('project-title').textContent = '等待下一次灵感登场';
  $('project-platform').textContent = activeCategory === 'all' ? 'UNITY / UNREAL ENGINE / TD' : categoryName(activeCategory);
  $('project-description').textContent = '此分类的作品将在这里更新。';
  $('project-description').hidden = false;
  $('project-credits').replaceChildren();
  $('project-credits').hidden = true;
  $('preview-index').textContent = '— / —';
  $('project-link').href = profile.bilibili;
  $('project-link').textContent = 'Bilibili 空间 ↗';
  $('playback-help').hidden = true;
}
// Native rounded borders keep each option's silhouette fixed. Only the soft
// highlight moves; no noise, displacement or filter touches the contour.
const selectionFrames = new Set();
function syncSelectionFrame(frame) {
  const moving = frame.dataset.visible === 'true' && !document.hidden && !reducedMotion.matches;
  frame.dataset.motion = moving ? 'running' : 'paused';
}
const selectionFrameObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.dataset.visible = String(entry.isIntersecting);
      syncSelectionFrame(entry.target);
    }
  }, {threshold:0}) : null;
function syncSelectionFrames() { for (const frame of selectionFrames) syncSelectionFrame(frame); }
reducedMotion.addEventListener('change', syncSelectionFrames);
document.addEventListener('visibilitychange', syncSelectionFrames);
function createSelectionFrame(index) {
  const frame = element('span', 'selection-card-frame');
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.visible = String(!selectionFrameObserver);
  frame.style.setProperty('--selection-highlight-delay', `${-index * 2.4}s`);
  frame.append(element('span', 'selection-frame-light'));
  selectionFrames.add(frame);
  return frame;
}
function setProjectDestination(link, project) {
  if (project.externalOnly) {
    link.href = bilibiliVideoUrl(project);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `在 Bilibili 观看 ${project.title}`);
  } else {
    link.href = `./work.html?id=${encodeURIComponent(project.id)}`;
    link.dataset.preloadWork = project.cover || '';
    link.setAttribute('aria-label', `查看 ${project.title} 详情`);
  }
}
document.querySelector('.selection-tip').textContent = '悬停预览。单个作品可查看详情，合集直接前往 Bilibili。';

function renderProjects() {
  const visible = projects.filter(project => (activeCategory === 'all' || project.category === activeCategory) && (activeCategory !== 'unreal' || activeSubcategory === 'all' || project.subcategory === activeSubcategory));
  $('ue-subcategories').hidden = activeCategory !== 'unreal';
  for (const item of document.querySelectorAll('[data-category]')) item.setAttribute('aria-pressed', String(item.dataset.category === activeCategory));
  for (const item of document.querySelectorAll('[data-subcategory]')) item.setAttribute('aria-pressed', String(item.dataset.subcategory === activeSubcategory));
  selectionFrameObserver?.disconnect();
  selectionFrames.clear();
  $('project-grid').replaceChildren();
  $('project-count').textContent = String(visible.length).padStart(2,'0');
  for (const project of visible) {
    const button = element('a','project-card');
    setProjectDestination(button, project);
    button.dataset.id = project.id;
    button.dataset.selected = String(selected?.id === project.id);
    button.setAttribute('aria-current', String(selected?.id === project.id));
    const label = element('span', 'card-copy');
    const duration = Number.isFinite(project.duration) ? Math.round(project.duration) : 0;
    const platform = categoryName(project.category);
    const meta = duration > 0 ? `${platform} / ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : platform;
    label.append(element('strong','',project.title), element('small','',meta));
    const media = element('span', 'selection-card-media');
    if (project.cover) {
      const image = element('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.hidden = true; }, {once:true});
      image.src = project.cover;
      media.append(image);
    } else media.append(createTypeCover(project));
    const frame = createSelectionFrame(visible.indexOf(project));
    button.append(media,label,frame);
    button.addEventListener('click', (event) => {
      if (project.externalOnly) return;
      // Touch users can preview first, then use the detail link or tap again.
      if (matchMedia('(hover: none)').matches && selected?.id !== project.id) {
        event.preventDefault();
        selectProject(project, true);
      } else selectProject(project);
    });
    // Hover updates posters only, and never interrupts an already opened player.
    button.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse' && !$('project-preview').querySelector('iframe, video')) selectProject(project); });
    // Keyboard focus previews; touch focus must leave the first-tap decision to click.
    button.addEventListener('focus', () => { if (button.matches(':focus-visible') && !$('project-preview').querySelector('iframe, video')) selectProject(project); });
    $('project-grid').append(button);
    selectionFrameObserver?.observe(frame);
    syncSelectionFrame(frame);
  }
  if (!visible.length) {
    const categories = activeCategory === 'all' ? ['unity','unreal','td'] : [activeCategory];
    for (const category of categories) {
      const tile = element('div','empty-category');
      const copy = element('div');
      copy.append(element('strong','',{unity:'Unity',unreal:'Unreal Engine',td:'TD'}[category]),element('small','','作品待补充'));
      tile.append(element('span','',{unity:'U',unreal:'UE',td:'TD'}[category]),copy);
      $('project-grid').append(tile);
    }
    showEmpty();
  } else if (!visible.includes(selected)) selectProject(visible.find(project => project.id === savedProjectId) || visible.find(project => project.id === 'ptcg-card') || visible[0]);
  saveSelection();
  document.querySelector('.header nav [data-view="works"]').href = `./portfolio.html${worksRoute()}`;
}
const help = element('p', 'playback-help', '若播放器加载受限，可点击「在 Bilibili 打开」观看。');
help.id = 'playback-help';
help.hidden = true;
$('project-preview').after(help);
for (const button of document.querySelectorAll('[data-category]')) button.addEventListener('click', () => {
  activeCategory = button.dataset.category;
  activeSubcategory = 'all';
  history.replaceState(null, '', worksRoute());
  renderProjects();
});
for (const button of document.querySelectorAll('[data-subcategory]')) button.addEventListener('click', () => {
  activeSubcategory = button.dataset.subcategory;
  history.replaceState(null, '', worksRoute());
  renderProjects();
  announce(activeSubcategory === 'vehicle' ? '已进入 Unreal Engine / Vehicle' : '显示全部 Unreal Engine 作品');
});
function worksRoute() {
  return activeCategory === 'all' ? '#works' : `#works/${activeCategory}${activeCategory === 'unreal' && activeSubcategory === 'vehicle' ? '/vehicle' : ''}`;
}
const siteRoot = new URL('./', location.href);
const shellViews = new Map([
  [new URL('portfolio.html', siteRoot).pathname, 'works'],
  [new URL('about.html', siteRoot).pathname, 'about'],
  [new URL('contact.html', siteRoot).pathname, 'contact'],
]);
const shellPaths = new Set([siteRoot.pathname, new URL('index.html', siteRoot).pathname, ...shellViews.keys()]);
const shellRouteHash = /^#(top|home-projects(?:-title)?|works(?:\/(unity|unreal|td)(?:\/vehicle)?)?|about|contact)$/;
let renderedUrl;

function showRoute({focus = false} = {}) {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const fileView = shellViews.get(location.pathname);
  const nextView = fileView || (['works','about','contact'].includes(parts[0]) ? parts[0] : 'top');
  const homeProjects = nextView === 'top' && ['home-projects', 'home-projects-title'].includes(parts[0]);
  const changedView = activeView !== nextView;
  // Hidden views must not keep playing audio. Keep local progress and selection.
  if (activeView === 'works' && nextView !== 'works') {
    $('project-preview').querySelector('video')?.pause();
    if ($('project-preview').querySelector('iframe') && selected) {
      replacePreview(createPoster(selected));
      $('playback-help').hidden = true;
    }
  }
  if (nextView === 'works' && parts[0] === 'works') {
    const category = ['unity','unreal','td'].includes(parts[1]) ? parts[1] : 'all';
    const subcategory = category === 'unreal' && parts[2] === 'vehicle' ? 'vehicle' : 'all';
    const changedFilter = category !== activeCategory || subcategory !== activeSubcategory;
    activeCategory = category;
    activeSubcategory = subcategory;
    if (changedFilter) renderProjects();
  }
  activeView = nextView;
  for (const panel of document.querySelectorAll('[data-view-panel]')) {
    const hide = panel.dataset.viewPanel !== activeView;
    if (panel.hidden !== hide) panel.hidden = hide;
  }
  for (const link of document.querySelectorAll('.header nav [data-view]')) {
    if (link.dataset.view === activeView) {
      if (link.getAttribute('aria-current') !== 'page') link.setAttribute('aria-current', 'page');
    } else if (link.hasAttribute('aria-current')) link.removeAttribute('aria-current');
    if (link.dataset.view === 'works') link.href = `./portfolio.html${worksRoute()}`;
  }
  document.body.dataset.view = activeView;
  renderedUrl = location.href;
  const labels = {top:'首页',works:'作品',about:'关于',contact:'联系'};
  document.title = `${labels[activeView]} · 张致远 — 美术 / 技术美术`;
  if (homeProjects) {
    // The section starts with transition art; explicit navigation lands on its title.
    const headerHeight = document.querySelector('.header').getBoundingClientRect().height;
    const top = window.scrollY + $('home-projects-title').getBoundingClientRect().top - headerHeight - 24;
    window.scrollTo({top:Math.max(0,top),left:0,behavior:focus && !reducedMotion.matches ? 'smooth' : 'instant'});
  }
  else if (changedView || focus || activeView === 'top') window.scrollTo({top:0,left:0,behavior:'instant'});
  if (focus) {
    const heading = homeProjects ? $('home-projects-title') : $(activeView).querySelector('h1,h2');
    heading.tabIndex = -1;
    heading.focus({preventScroll:true});
    announce(homeProjects ? '精选作品' : `已切换到${labels[activeView]}`);
  }
  if (changedView) window.dispatchEvent(new Event('portfolio:viewchange'));
}
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target.toLowerCase() !== '_self')) return;
  const route = new URL(link.href);
  if (route.origin !== siteRoot.origin || route.search || !shellPaths.has(route.pathname)) return;
  if (route.hash && !shellRouteHash.test(route.hash)) return;
  // Keep the canonical URLs and native links; only ordinary in-site clicks reuse the shell.
  if (route.href !== location.href) {
    try { history.pushState(null, '', route.href); }
    catch { return; }
  }
  event.preventDefault();
  document.body.classList.add('shell-navigated');
  showRoute({focus:true});
});
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  if (location.href !== renderedUrl) showRoute();
  // A compositor smooth-scroll frame can arrive after history's instant jump.
  // Reapply the destination once after that frame, unless navigation changed.
  if (/^#home-projects(?:-title)?$/.test(location.hash)) {
    const destination = location.href;
    requestAnimationFrame(() => { if (location.href === destination) showRoute(); });
  }
});
window.addEventListener('hashchange', () => { if (location.href !== renderedUrl) showRoute(); });
if (profile.about) $('about-text').textContent = profile.about;
for (const item of profile.experience || []) {
  const row = element('article', 'experience-item');
  row.append(element('p','resume-period',item.period), element('h4','',item.company), element('p','resume-role',item.role), element('p','resume-summary',item.summary));
  $('experience-list').append(row);
}
for (const item of profile.skills || []) {
  const row = element('div','skill-item');
  row.append(element('h4','',item.title),element('p','',item.text));
  $('skills-list').append(row);
}
for (const item of profile.education || []) {
  const row = element('article','education-item');
  row.append(element('p','resume-period',item.period),element('h4','',item.school),element('p','resume-summary',item.degree));
  $('education-list').append(row);
}
$('year').textContent = new Date().getFullYear();
const featuredTechniques = {
  'ptcg-card': '磨砂亮片 · 细线高光 · 双层视差',
  'unreal-car': '分层车漆 · 按键变色 · 平面反射',
  'rain-vat': '雨滴材质 · 涟漪法线 · 水花粒子',
  'unreal-snow': '雪地压痕 · 车轮沾雪 · 接触映射',
};
function mountHomeCardFilm(card, media) {
  const film = element('span', 'home-card-film');
  film.setAttribute('aria-hidden', 'true');
  media.append(film);
  let active = false, frame = 0, lastFrame = 0, lastMove = 0;
  let x = .5, y = .42, targetX = x, targetY = y, velocity = 0, energy = 0;
  const clamp = value => Math.max(0, Math.min(1, value));
  function paint() {
    media.style.setProperty('--film-x', `${(x * 100).toFixed(2)}%`);
    media.style.setProperty('--film-y', `${(y * 100).toFixed(2)}%`);
    media.style.setProperty('--film-angle', `${(112 + (x - .5) * 14 + (y - .5) * 6 + energy * 2).toFixed(2)}deg`);
    media.style.setProperty('--film-shift-x', `${(34 + x * 32 + energy * 4).toFixed(2)}%`);
    media.style.setProperty('--film-shift-y', `${(38 + y * 24).toFixed(2)}%`);
    media.style.setProperty('--film-energy', energy.toFixed(3));
  }
  function cancel() { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; }
  function tick(now) {
    frame = 0;
    if (!active || document.hidden || reducedMotion.matches) return;
    const seconds = Math.min(.06, Math.max(.001, (now - (lastFrame || now - 16)) / 1000));
    lastFrame = now;
    const easing = 1 - Math.exp(-seconds / .09);
    x += (targetX - x) * easing; y += (targetY - y) * easing;
    velocity *= Math.exp(-seconds / .14);
    energy += (velocity - energy) * easing;
    paint();
    // Only pointer movement and its short settling tail need animation frames.
    if (Math.abs(targetX - x) + Math.abs(targetY - y) > .0005 || velocity > .002 || energy > .002) frame = requestAnimationFrame(tick);
    else lastFrame = 0;
  }
  function queue() { if (!frame) frame = requestAnimationFrame(tick); }
  function updatePointer(event, entering = false) {
    const bounds = media.getBoundingClientRect();
    const nextX = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width));
    const nextY = clamp((event.clientY - bounds.top) / Math.max(1, bounds.height));
    const now = performance.now();
    velocity = entering ? 0 : Math.min(1, Math.hypot(nextX - targetX, nextY - targetY) * 260 / Math.max(8, now - lastMove));
    targetX = nextX; targetY = nextY; lastMove = now; queue();
  }
  function enter(event) {
    if (event.pointerType !== 'mouse' || document.hidden) return;
    active = true; media.dataset.filmActive = 'true';
    if (!reducedMotion.matches) updatePointer(event, true);
  }
  function move(event) {
    if (active && event.pointerType === 'mouse' && !reducedMotion.matches) updatePointer(event);
  }
  function leave() {
    active = false; delete media.dataset.filmActive; cancel(); velocity = energy = 0;
    // Keep the last light position while CSS fades the layer away.
  }
  function pointerDown(event) { if (event.pointerType !== 'mouse') leave(); }
  function motionChanged() {
    cancel(); x = targetX = .5; y = targetY = .42; velocity = energy = 0; paint();
  }
  function visibilityChanged() { if (document.hidden) leave(); }
  function pageHidden(event) {
    leave();
    if (event.persisted) return;
    card.removeEventListener('pointerenter', enter); card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerleave', leave); card.removeEventListener('pointercancel', leave);
    card.removeEventListener('pointerdown', pointerDown);
    reducedMotion.removeEventListener('change', motionChanged);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('blur', leave); window.removeEventListener('pagehide', pageHidden);
  }
  card.addEventListener('pointerenter', enter, {passive: true});
  card.addEventListener('pointermove', move, {passive: true});
  card.addEventListener('pointerleave', leave, {passive: true});
  card.addEventListener('pointercancel', leave, {passive: true});
  card.addEventListener('pointerdown', pointerDown, {passive: true});
  reducedMotion.addEventListener('change', motionChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('blur', leave); window.addEventListener('pagehide', pageHidden);
}
function createProjectLink(project) {
  const card = element('a', 'project-card');
  setProjectDestination(card, project);
  const image = element('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = project.cover;
  const media = element('span', 'home-card-media');
  media.append(image);
  mountHomeCardFilm(card, media);
  const copy = element('span', 'card-copy');
  const meta = element('span', 'home-card-meta');
  const duration = Math.max(0, Math.round(project.duration || 0));
  meta.append(element('span', '', {unity:'Unity',unreal:'Unreal Engine',td:'TD'}[project.category] || categoryName(project.category)), element('span', 'home-card-duration', `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2,'0')}`));
  const heading = element('span', 'home-card-heading');
  const arrow = element('span', 'card-arrow');
  arrow.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 18 18 6M7 6h11v11"/></svg>';
  arrow.setAttribute('aria-hidden', 'true');
  heading.append(element('strong', '', project.title), arrow);
  copy.append(meta, heading, element('span', 'home-card-detail', featuredTechniques[project.id] || ''));
  card.append(media, copy);
  return card;
}
const featuredProjectIds = ['ptcg-card', 'unreal-car', 'rain-vat', 'unreal-snow'];
for (const project of featuredProjectIds.map(id => projects.find(item => item.id === id)).filter(Boolean)) {
  $('home-project-grid').append(createProjectLink(project));
}
let copyFeedbackTimer;
for (const contact of document.querySelectorAll('[data-copy-value]')) {
  let copying = false;
  contact.addEventListener('click', async () => {
    if (copying) return;
    copying = true;
    const value = contact.querySelector('strong');
    const feedback = $('contact-copy-feedback');
    clearTimeout(copyFeedbackTimer);
    feedback.textContent = '';
    document.querySelectorAll('.contact-method.is-copied').forEach(item => item.classList.remove('is-copied'));
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(contact.dataset.copyValue);
      contact.classList.add('is-copied');
      feedback.textContent = '已复制';
      copyFeedbackTimer = setTimeout(() => { contact.classList.remove('is-copied'); feedback.textContent = ''; }, 2000);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(value);
      selection?.removeAllRanges(); selection?.addRange(range);
      feedback.textContent = '无法自动复制，请复制已选中的内容。';
    } finally { copying = false; }
  });
}
renderProjects();
showRoute();
const initialGrid = activeView === 'top' ? $('home-project-grid') : activeView === 'works' ? $('project-grid') : null;
const initialDetailLinks = initialGrid ? [...initialGrid.querySelectorAll('a[data-preload-work]')].slice(0, 2) : [];
const priorityCovers = initialDetailLinks.map(link => link.querySelector('img')).filter(Boolean);
const workPreparation = setupWorkPreload(
  initialDetailLinks.map(link => link.href),
  window.PortfolioStartGate?.active ? [] : priorityCovers.map(image => image.src),
);
// A cold document's native fragment scroll can run after module evaluation.
// Reapply the heading offset once after load, unless the visitor has moved on.
if (/^#home-projects(?:-title)?$/.test(location.hash)) {
  const initialDestination = location.href;
  let interrupted = false;
  const inputTypes = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
  const markInput = () => { interrupted = true; };
  for (const type of inputTypes) window.addEventListener(type, markInput, {passive:true});
  const settleFragment = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const type of inputTypes) window.removeEventListener(type, markInput);
    if (!interrupted && location.href === initialDestination) showRoute();
  }));
  if (document.readyState === 'complete') settleFragment();
  else window.addEventListener('load', settleFragment, {once:true});
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) starfield?.destroy(); });
window.dispatchEvent(new CustomEvent('portfolio:app-ready', {detail: {workPreparation, priorityCovers}}));


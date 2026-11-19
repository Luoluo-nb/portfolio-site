import { profile, projects } from './content.js';
import { Starfield } from './starfield.js';
import { renderVideoChapters } from './video-chapters.js';
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
function createPoster(project) {
  $('video-chapters')._chapterReset?.();
  const button = element('button', 'poster-button');
  button.type = 'button';
  button.setAttribute('aria-label', `播放 ${project.title}`);
  const img = element('img');
  img.src = project.cover;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => { img.hidden = true; }, {once:true});
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
  if (project.videoSrc) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.loop = Boolean(project.loop);
    video.preload = 'metadata';
    video.poster = project.cover;
    video.src = project.videoSrc;
    video.defaultPlaybackRate = playbackSpeed;
    video.playbackRate = playbackSpeed;
    video.setAttribute('aria-label', project.title);
    video.addEventListener('ratechange', () => {
      if (video.isConnected && selected?.id === project.id) rememberPlaybackSpeed(video.playbackRate);
    });
    video.addEventListener('error', () => {
      $('playback-help').textContent = '视频暂时无法加载，可通过「打开视频」重试。';
      $('playback-help').hidden = false;
    }, {once:true});
    replacePreview(video);
    $('playback-help').hidden = true;
    // This is reached only from an explicit click on the play button.
    video.play().catch(() => { /* Native controls remain available. */ });
    announce(`正在播放：${project.title}`);
    return;
  }
  if (!/^BV[a-zA-Z0-9]+$/.test(project.bvid)) return;
  const time = Number.isFinite(startTime) && startTime >= 0 ? startTime : 0;
  const source = new URL('https://player.bilibili.com/player.html');
  source.search = new URLSearchParams({bvid:project.bvid, ...(project.cid ? {cid:String(project.cid)} : {}), p:String(project.page || 1), t:String(time), autoplay:'0', danmaku:'0', poster:'1'}).toString();
  const frame = $('project-preview').querySelector('iframe') || document.createElement('iframe');
  frame.src = source.href;
  frame.title = `${project.title} — Bilibili 播放器`;
  frame.allow = 'fullscreen; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  if (!frame.isConnected) {
    const transferFocus = $('project-preview').contains(document.activeElement);
    replacePreview(frame);
    const close = element('button', 'close-player');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭播放器');
    close.innerHTML = '<span class="player-close-glyph" aria-hidden="true"><svg class="player-close-orbit" viewBox="0 0 40 40" focusable="false"><path d="M10 6.8A16.5 16.5 0 0 1 36.2 23M30 33.2A16.5 16.5 0 0 1 3.8 17"/></svg><svg class="player-close-mark" viewBox="0 0 20 20" focusable="false"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></span><span class="player-close-label">关闭</span>';
    close.addEventListener('click', () => { replacePreview(createPoster(project)); $('playback-help').hidden = true; $('project-preview').querySelector('.poster-button').focus({preventScroll:true}); });
    $('project-preview').append(close);
    if (transferFocus) frame.focus({preventScroll:true});
  }
  $('playback-help').textContent = project.videoChapters?.length
    ? '已打开所选章节，请在 Bilibili 播放器内点击播放。倍速可在播放器内调整。'
    : '倍速请在 Bilibili 播放器内调整；若加载受限，可点击「在 Bilibili 打开」观看。';
  $('playback-help').hidden = false;
  announce('Bilibili 播放器已打开，请点击播放器内的播放按钮。');
}
function selectProject(project, shouldScroll = false) {
  selected = project;
  replacePreview(createPoster(project));
  $('playback-controls').hidden = !project.videoSrc;
  renderVideoChapters($('video-chapters'), project, () => $('project-preview').querySelector('video'), time => openPlayer(project, time));
  syncSpeedControl();
  $('project-title').textContent = project.title;
  $('project-platform').textContent = categoryName(project.category) + (project.subcategory === 'vehicle' ? ' / 车辆' : '');
  $('project-description').textContent = project.description || '';
  $('project-detail-link').href = `./work.html?id=${encodeURIComponent(project.id)}`;
  $('project-detail-link').hidden = false;
  $('project-credits').replaceChildren();
  $('project-credits').hidden = !project.references?.length;
  for (const reference of project.references || []) {
    const link = element('a', '', `${reference.label} ↗`);
    link.href = reference.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('project-credits').append(link);
  }
  $('project-link').href = project.videoSrc || `https://www.bilibili.com/video/${project.bvid}/${Number.isFinite(project.startTime) && project.startTime > 0 ? `?t=${project.startTime}` : ''}`;
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
  $('project-credits').replaceChildren();
  $('project-credits').hidden = true;
  $('preview-index').textContent = '— / —';
  $('project-link').href = profile.bilibili;
  $('project-link').textContent = 'Bilibili 空间 ↗';
  $('playback-help').hidden = true;
}
// Static noise displaces the edge mask once. Two complete noise color fields
// flow behind it, so local wisps brighten and fade without moving the card shape.
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
  const id = `selection-nebula-${index}`;
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset.visible = String(!selectionFrameObserver);
  frame.style.setProperty('--nebula-delay', `${-index * 3.17}s`);
  const layer = (n) => {
    const layerId = `${id}-${n}`;
    const texture = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="212" viewBox="0 0 320 212" preserveAspectRatio="none" fill="none">
    <defs>
      <linearGradient id="${layerId}-color" x1="0" y1="0" x2="320" y2="212" gradientUnits="userSpaceOnUse">
        <stop stop-color="#78bce4" stop-opacity=".15"/><stop offset=".2" stop-color="#a3dcff" stop-opacity=".85"/><stop offset=".44" stop-color="#6786c0" stop-opacity=".22"/><stop offset=".7" stop-color="#91c9f4" stop-opacity=".95"/><stop offset="1" stop-color="#83ace2" stop-opacity=".2"/>
      </linearGradient>
      <filter id="${layerId}-flow" x="-12" y="-12" width="344" height="236" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="${n ? '.026 .036' : '.018 .045'}" numOctaves="2" seed="${index * 2 + n + 13}" result="field"/>
        <feDisplacementMap in="SourceGraphic" in2="field" scale="9" xChannelSelector="R" yChannelSelector="G" result="warped"/>
        <feColorMatrix in="field" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.4 0 0 0 -1.13" result="wisps"/>
        <feComposite in="warped" in2="wisps" operator="in" result="threads"/>
        <feGaussianBlur in="threads" stdDeviation="1.45" result="halo"/>
        <feMerge><feMergeNode in="halo"/><feMergeNode in="threads"/></feMerge>
      </filter>
    </defs>
    <g class="selection-nebula-ribbons" filter="url(#${layerId}-flow)" stroke="url(#${layerId}-color)">
      <path stroke-width="1.65" stroke-linecap="round" d="M7 34C3 13 12 6 34 7C98 3 160 11 224 6S315 2 314 33C318 78 310 130 315 177S296 206 265 205C199 210 141 201 77 206S4 212 6 177C2 128 10 83 7 34Z"/>
      <path stroke-width=".85" opacity=".58" stroke-linecap="round" d="M12 39C6 17 19 11 42 12C111 7 176 14 240 10S308 17 308 43C312 91 306 130 310 170S289 201 254 200C185 205 117 197 62 202S10 192 12 162C6 118 15 78 12 39Z"/>
    </g>
  </svg>`;
    if (n === 0) frame.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(texture)}")`;
    const field = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <filter id="field" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="${n ? '.047 .031' : '.031 .055'}" numOctaves="2" seed="${index * 2 + n + 31}" stitchTiles="stitch"/>
        <feColorMatrix type="matrix" values="0 0 0 0 ${n ? '.32' : '.65'}  0 0 0 0 ${n ? '.58' : '.88'}  0 0 0 0 1  3.8 0 0 0 -1.35"/>
      </filter><rect width="128" height="128" filter="url(#field)"/>
    </svg>`;
    const surface = element('span', `selection-nebula-layer selection-nebula-layer-${n}`);
    surface.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(field)}")`;
    return surface;
  };
  frame.append(layer(0), layer(1));
  selectionFrames.add(frame);
  return frame;
}
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
    button.href = `./work.html?id=${encodeURIComponent(project.id)}`;
    button.dataset.id = project.id;
    button.setAttribute('aria-label', `查看 ${project.title} 详情`);
    button.dataset.selected = String(selected?.id === project.id);
    button.setAttribute('aria-current', String(selected?.id === project.id));
    const img = element('img');
    img.src = project.cover;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.hidden = true; }, {once:true});
    const label = element('span', 'card-copy');
    const duration = Math.max(0, Math.round(project.duration || 0));
    const minutes = Math.floor(duration / 60);
    const seconds = String(duration % 60).padStart(2,'0');
    label.append(element('strong','',project.title), element('small','',`${categoryName(project.category)} / ${minutes}:${seconds}`));
    const media = element('span', 'selection-card-media');
    media.append(img);
    const frame = createSelectionFrame(visible.indexOf(project));
    button.append(media,label,frame);
    button.addEventListener('click', (event) => {
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
function showRoute({focus = false} = {}) {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const fileView = { 'portfolio.html':'works', 'about.html':'about', 'contact.html':'contact' }[location.pathname.split('/').pop()];
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
  for (const panel of document.querySelectorAll('[data-view-panel]')) panel.hidden = panel.dataset.viewPanel !== activeView;
  for (const link of document.querySelectorAll('.header nav [data-view]')) {
    if (link.dataset.view === activeView) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    if (link.dataset.view === 'works') link.href = `./portfolio.html${worksRoute()}`;
  }
  document.body.dataset.view = activeView;
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
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  let route = link.getAttribute('href');
  if (!/^#(top|home-projects(?:-title)?|works(?:\/(unity|unreal|td)(?:\/vehicle)?)?|about|contact)$/.test(route)) return;
  event.preventDefault();
  if (link.dataset.view === 'works') route = worksRoute();
  if (location.hash !== route) history.pushState(null, '', route);
  showRoute({focus:true});
});
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  showRoute();
  // A compositor smooth-scroll frame can arrive after history's instant jump.
  // Reapply the destination once after that frame, unless navigation changed.
  const destination = location.href;
  requestAnimationFrame(() => { if (location.href === destination) showRoute(); });
});
window.addEventListener('hashchange', () => showRoute());
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
function createProjectLink(project) {
  const card = element('a', 'project-card');
  card.href = `./work.html?id=${encodeURIComponent(project.id)}`;
  card.setAttribute('aria-label', `查看 ${project.title} 详情`);
  const image = element('img');
  image.src = project.cover;
  image.alt = '';
  image.loading = 'lazy';
  const media = element('span', 'home-card-media');
  media.append(image);
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
window.addEventListener('pagehide', (event) => { if (!event.persisted) starfield?.destroy(); });


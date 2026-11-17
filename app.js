import { profile, projects } from './content.js';
import { Starfield } from './starfield.js';
import { renderVideoChapters } from './video-chapters.js';

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
    activeCategory = ['unity','unreal'].includes(saved.category) ? saved.category : 'all';
    activeSubcategory = activeCategory === 'unreal' && saved.subcategory === 'vehicle' ? 'vehicle' : 'all';
    savedProjectId = saved.projectId;
  }
} catch { /* Navigation works without storage. */ }
function saveSelection() {
  try { sessionStorage.setItem('portfolio-selection', JSON.stringify({category:activeCategory,subcategory:activeSubcategory,projectId:selected?.id})); } catch {}
}
const categoryName = (category) => ({unity:'UNITY',unreal:'UNREAL ENGINE'}[category] || '作品合集');
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
    const close = element('button', 'close-player', '关闭播放器');
    close.type = 'button';
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
  state.append(element('div','empty-symbol','＋'),element('span','empty-kicker','新的作品'),element('h3','','作品待补充'),element('p','','新的探索，即将在这里展开。'));
  replacePreview(state);
  $('project-title').textContent = '等待下一次灵感登场';
  $('project-platform').textContent = activeCategory === 'all' ? 'UNITY / UNREAL ENGINE' : categoryName(activeCategory);
  $('project-description').textContent = '此分类的作品将在这里更新。';
  $('project-credits').replaceChildren();
  $('project-credits').hidden = true;
  $('preview-index').textContent = '— / —';
  $('project-link').href = profile.bilibili;
  $('project-link').textContent = 'Bilibili 空间 ↗';
  $('playback-help').hidden = true;
}
function renderProjects() {
  const visible = projects.filter(project => (activeCategory === 'all' || project.category === activeCategory) && (activeCategory !== 'unreal' || activeSubcategory === 'all' || project.subcategory === activeSubcategory));
  $('ue-subcategories').hidden = activeCategory !== 'unreal';
  for (const item of document.querySelectorAll('[data-category]')) item.setAttribute('aria-pressed', String(item.dataset.category === activeCategory));
  for (const item of document.querySelectorAll('[data-subcategory]')) item.setAttribute('aria-pressed', String(item.dataset.subcategory === activeSubcategory));
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
    button.append(img,label);
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
  }
  if (!visible.length) {
    const categories = activeCategory === 'all' ? ['unity','unreal'] : [activeCategory];
    for (const category of categories) {
      const tile = element('div','empty-category');
      const copy = element('div');
      copy.append(element('strong','',category === 'unity' ? 'Unity' : 'Unreal Engine'),element('small','','作品待补充'));
      tile.append(element('span','',category === 'unity' ? 'U' : 'UE'),copy);
      $('project-grid').append(tile);
    }
    showEmpty();
  } else if (!visible.includes(selected)) selectProject(visible.find(project => project.id === savedProjectId) || visible[0]);
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
  const parts = location.hash.slice(1).split('/');
  const fileView = { 'portfolio.html':'works', 'about.html':'about', 'contact.html':'contact' }[location.pathname.split('/').pop()];
  const nextView = fileView || (['works','about','contact'].includes(parts[0]) ? parts[0] : 'top');
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
    const category = ['unity','unreal'].includes(parts[1]) ? parts[1] : 'all';
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
  if (changedView || focus) window.scrollTo({top:0,left:0,behavior:'instant'});
  if (focus) {
    const heading = $(activeView).querySelector('h1,h2');
    heading.tabIndex = -1;
    heading.focus({preventScroll:true});
    announce(`已切换到${labels[activeView]}`);
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  let route = link.getAttribute('href');
  if (!/^#(top|works(?:\/(unity|unreal)(?:\/vehicle)?)?|about|contact)$/.test(route)) return;
  event.preventDefault();
  if (link.dataset.view === 'works') route = worksRoute();
  if (location.hash !== route) history.pushState(null, '', route);
  showRoute({focus:true});
});
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => showRoute());
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
function createProjectLink(project) {
  const card = element('a', 'project-card');
  card.href = `./work.html?id=${encodeURIComponent(project.id)}`;
  card.setAttribute('aria-label', `查看 ${project.title} 详情`);
  const image = element('img');
  image.src = project.cover;
  image.alt = '';
  image.loading = 'lazy';
  const copy = element('span', 'card-copy');
  const meta = element('small', '');
  const arrow = element('span', 'card-arrow', '↗');
  arrow.setAttribute('aria-hidden', 'true');
  meta.append(element('span', '', categoryName(project.category)), arrow);
  copy.append(element('strong', '', project.title), meta);
  card.append(image, copy);
  return card;
}
for (const project of projects.filter(item => item.category).slice(0, 4)) {
  $('home-project-grid').append(createProjectLink(project));
}
for (const id of ['ptcg-card', 'rain-vat', 'unreal-snow']) {
  const project = projects.find(item => item.id === id);
  if (project) $('contact-project-grid')?.append(createProjectLink(project));
}
renderProjects();
showRoute();
window.addEventListener('pagehide', (event) => { if (!event.persisted) starfield?.destroy(); });

import { bilibiliVideoUrl, projects } from './content.js';
import { Starfield } from './starfield.js';
import { renderVideoChapters } from './video-chapters.js';
import { projectDetails } from './project-details.js';
import { setupWorkPreload } from './work-preload.js';
import './player-nebula.js';
import './image-viewer.js';

const $ = id => document.getElementById(id);
const announce = message => { $('detail-announcement').textContent = message; };
let sky;
let skyFrame;
function scheduleSky() {
  if (sky || skyFrame) return;
  // Let the detail layout paint before compiling and drawing the background.
  skyFrame = requestAnimationFrame(() => {
    skyFrame = requestAnimationFrame(() => {
      skyFrame = 0;
      try {
        sky = new Starfield($('starfield-canvas'), {
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          onStatus({state}) { $('starfield-canvas').dataset.state = state; },
        });
      } catch { $('starfield-canvas').dataset.state = 'fallback'; }
    });
  });
}

const requestedId = new URLSearchParams(location.search).get('id');
const requestedProject = projects.find(item => item.id === (requestedId === 'ptcg-texture3d' ? 'ptcg-card' : requestedId));
const detailProjects = projects.filter(item => !item.externalOnly);
const project = requestedProject?.externalOnly ? null : requestedProject;
if (requestedProject?.externalOnly) location.replace(bilibiliVideoUrl(requestedProject));
const speedKey = 'portfolio-video-speed';
const validSpeed = value => Number.isFinite(value) && value >= 0.25 && value <= 4;
let speed = 1;
try {
  const saved = Number(localStorage.getItem(speedKey));
  if (validSpeed(saved)) speed = saved;
} catch { /* The player also works with browser storage disabled. */ }

function syncSpeed(value) {
  if (!validSpeed(value)) return;
  speed = value;
  const select = $('detail-speed');
  select.querySelector('[data-custom-speed]')?.remove();
  if (![...select.options].some(option => Number(option.value) === value)) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value}×`;
    option.dataset.customSpeed = '';
    select.append(option);
  }
  select.value = String(value);
  try { localStorage.setItem(speedKey, String(value)); } catch { /* Optional preference. */ }
}
syncSpeed(speed);
$('detail-speed').addEventListener('change', event => {
  syncSpeed(Number(event.target.value));
  const video = $('detail-player').querySelector('video');
  if (video) video.defaultPlaybackRate = video.playbackRate = speed;
  announce(`播放速度：${speed}倍`);
});

function help(message) {
  $('detail-playback-help').textContent = message;
  $('detail-playback-help').hidden = !message;
}
function replacePlayer(...nodes) {
  const previous = $('detail-player').querySelector('video');
  if (previous) {
    previous.pause();
    previous.removeAttribute('src');
    previous.load();
  }
  $('detail-player').replaceChildren(...nodes);
}
function play(startTime = project?.startTime ?? 0) {
  if (!project?.videoSrc) return;
  const transferFocus = $('detail-player').contains(document.activeElement);
  const time = Number.isFinite(startTime) && startTime >= 0 ? startTime : 0;
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.loop = Boolean(project.loop);
  video.muted = video.defaultMuted = Boolean(project.muted);
  video.preload = 'metadata';
  video.poster = project.cover;
  video.src = project.videoSrc;
  video.defaultPlaybackRate = video.playbackRate = speed;
  video.setAttribute('aria-label', project.title);
  video.addEventListener('ratechange', () => { if (video.isConnected) syncSpeed(video.playbackRate); });
  video.addEventListener('error', () => { if (video.isConnected) help('视频暂时无法加载，可点击下方「打开原视频」重试。'); }, {once:true});
  const close = document.createElement('button');
  close.className = 'close-player';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭播放器');
  close.innerHTML = '<span class="player-close-glyph" aria-hidden="true"><svg class="player-close-mark" viewBox="0 0 20 20" focusable="false"><path d="m5 5 10 10m0-10L5 15"/></svg></span><span class="player-close-label">关闭</span>';
  close.addEventListener('click', () => { showPoster(); help(''); $('detail-player').querySelector('.poster-button')?.focus({preventScroll:true}); });
  replacePlayer(video, close);
  help('');
  const seek = () => {
    if (!video.isConnected || $('detail-player').querySelector('video') !== video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.min(time, Math.max(0, video.duration - .05));
  };
  if (video.readyState >= 1) seek();
  else video.addEventListener('loadedmetadata', seek, {once:true});
  video.play().catch(() => { if (video.isConnected) help('点击播放器内的播放按钮继续观看。'); });
  if (transferFocus) video.focus({preventScroll:true});
  announce(`正在播放：${project.title}`);
}

function showPoster() {
  if (!project) return;
  $('detail-video-chapters')._chapterReset?.();
  if (!project.videoSrc) {
    const cover = document.createElement('figure');
    cover.className = 'project-static-cover';
    const image = document.createElement('img');
    image.addEventListener('load', () => { image.style.maxWidth = image.naturalWidth+'px'; image.style.maxHeight = image.naturalHeight+'px'; }, {once:true});
    image.alt = project.title;
    image.referrerPolicy = 'no-referrer';
    image.fetchPriority = 'high';
    image.decoding = 'async';
    image.src = project.cover;
    cover.append(image);
    replacePlayer(cover);
    help('');
    return;
  }
  const button = document.createElement('button');
  button.className = 'poster-button';
  button.type = 'button';
  button.setAttribute('aria-label', `播放 ${project.title}`);
  const image = document.createElement('img');
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.fetchPriority = 'high';
  image.decoding = 'async';
  image.addEventListener('error', () => { image.hidden = true; }, {once:true});
  image.src = project.cover;
  const caption = document.createElement('span');
  caption.className = 'poster-play';
  const icon = document.createElement('span');
  icon.className = 'play-triangle';
  icon.innerHTML = '<svg viewBox="0 0 28 28" focusable="false"><path d="m10 7 11 7-11 7Z"/></svg>';
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = '播放作品';
  caption.append(icon, text);
  button.append(image, caption);
  button.addEventListener('click', () => play());
  replacePlayer(button);
}

function renderBreakdown(detail) {
  if (!detail) return;
  $('breakdown-title').textContent = detail.title;
  $('breakdown-introduction').textContent = detail.introduction;
  for (const [index, chapter] of detail.chapters.entries()) {
    const number = String(index + 1).padStart(2, '0');
    const chapterId = `breakdown-${chapter.id}`;
    const link = document.createElement('a');
    link.href = `#${chapterId}`;
    link.textContent = `${number} / ${chapter.title}`;
    $('breakdown-toc').append(link);

    const section = document.createElement('section');
    section.className = 'breakdown-chapter';
    section.id = chapterId;
    if (chapter.sourceSlide != null) section.dataset.sourceSlide = chapter.sourceSlide;
    section.setAttribute('aria-labelledby', `${chapterId}-title`);
    const header = document.createElement('div');
    header.className = 'breakdown-chapter-heading';
    const count = document.createElement('span');
    count.className = 'breakdown-number';
    count.textContent = number;
    count.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const title = document.createElement('h3');
    title.id = `${chapterId}-title`;
    title.textContent = chapter.title;
    const description = document.createElement('p');
    description.textContent = chapter.description;
    copy.append(title, description);
    if (chapter.steps?.length) {
      const steps = document.createElement('ol');
      steps.className = 'breakdown-steps';
      for (const text of chapter.steps) {
        const item = document.createElement('li');
        item.textContent = text;
        steps.append(item);
      }
      copy.append(steps);
    }
    header.append(count, copy);
    const gallery = document.createElement('div');
    gallery.className = 'breakdown-gallery';
    for (const item of chapter.figures || []) {
      const figure = document.createElement('figure');
      figure.className = 'breakdown-figure';
      if (item.type === 'diagram') figure.classList.add('breakdown-diagram');
      if (item.type === 'preview') figure.classList.add('breakdown-preview');
      if (item.wide) figure.classList.add('breakdown-wide');
      const open = document.createElement('a');
      open.href = item.src;
      open.className = 'breakdown-image-link';
      open.dataset.imageCaption = item.caption;
      open.setAttribute('aria-label', item.caption);
      open.setAttribute('aria-haspopup', 'dialog');
      open.setAttribute('aria-controls', 'image-preview');
      const image = document.createElement('img');
      image.src = item.src;
      image.alt = item.caption;
      image.width = item.width;
      image.height = item.height;
      image.loading = 'lazy';
      image.decoding = 'async';
      open.append(image);
      const caption = document.createElement('figcaption');
      const label = document.createElement('span');
      label.textContent = item.caption;
      const action = document.createElement('span');
      action.className = 'breakdown-image-action';
      action.textContent = '预览大图';
      action.setAttribute('aria-hidden', 'true');
      caption.append(label, action);
      open.append(caption);
      figure.append(open);
      gallery.append(figure);
    }
    section.append(header);
    if (gallery.childElementCount) section.append(gallery);
    $('breakdown-chapters').append(section);
  }
  $('work-breakdown').hidden = false;
  // Chapter URLs remain useful when copied, refreshed, or opened in a new tab.
  if (location.hash.startsWith('#breakdown-')) {
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({block:'start'}));
  }
}

if (project) {
  const platform = {unity:'Unity',unreal:'Unreal Engine',td:'TD'}[project.category] || '作品合集';
  const categoryRoute = project.category ? `/${project.category}` : '';
  const subcategoryRoute = project.subcategory === 'vehicle' ? '/vehicle' : '';
  const returnUrl = `./portfolio.html#works${categoryRoute}${subcategoryRoute}`;
  $('work-back').href = returnUrl;
  if (detailProjects.length > 1) {
    const nextProject = detailProjects[(detailProjects.indexOf(project) + 1) % detailProjects.length];
    const nextUrl = `./work.html?id=${encodeURIComponent(nextProject.id)}`;
    $('work-next').href = $('work-next-footer').href = nextUrl;
    for (const link of [$('work-next'), $('work-next-footer')]) link.dataset.preloadWork = '';
    setupWorkPreload([nextUrl], [nextProject.cover]);
    $('work-next-name').textContent = $('work-next-title').textContent = nextProject.title;
    const nextCopy = document.createElement('span');
    nextCopy.className = 'detail-next-compact-copy';
    $('work-next-name').className = 'detail-next-name';
    nextCopy.append($('work-next-label'), $('work-next-name'));
    $('work-next').prepend(nextCopy);
    const nextShape = '<svg class="next-direction" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle class="next-direction-ring" cx="24" cy="24" r="20"/><path class="next-direction-mark" d="M16 24h16m-6-6 6 6-6 6"/></svg>';
    for (const link of [$('work-next'), $('work-next-footer')]) link.querySelector('.detail-next-arrow').innerHTML = nextShape;
    $('work-next').hidden = $('work-next-navigation').hidden = false;
  }
  $('work-breadcrumb').textContent = project.title;
  $('work-category').textContent = platform + (project.subcategory === 'vehicle' ? ' / 车辆' : '');
  $('work-title').textContent = project.title;
  $('work-description').textContent = project.description || '';
  const seconds = Math.max(0, Math.round(project.duration || 0));
  $('work-duration').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M12 6.5V12l3.5 2"/></svg><span class="duration-value" data-no-translate>${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}</span><span class="duration-type">视频</span>`;
  document.title = `${project.title} · 张致远作品集`;
  $('work-source').href = project.videoSrc || bilibiliVideoUrl(project);
  $('work-source').textContent = project.videoSrc ? '打开原视频 ↗' : '在 Bilibili 打开 ↗';
  $('work-profile').remove();
  $('detail-speed-controls').hidden = !project.videoSrc;
  for (const reference of project.references || []) {
    const link = document.createElement('a');
    link.href = reference.url;
    link.textContent = `${reference.label} ↗`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('work-references').append(link);
  }
  $('work-references').hidden = !project.references?.length;
  $('work-content').hidden = false;
  showPoster();
  renderVideoChapters($('detail-video-chapters'), project.videoSrc ? project : null, () => $('detail-player').querySelector('video'), play);
  renderBreakdown(projectDetails[project.id]);
} else if (!requestedProject?.externalOnly) {
  document.title = '未找到作品 · 张致远作品集';
  $('work-title').textContent = '未找到作品';
  $('work-breadcrumb').textContent = '未找到作品';
  $('work-missing').hidden = false;
}
$('detail-year').textContent = new Date().getFullYear();
window.addEventListener('pagehide', event => {
  cancelAnimationFrame(skyFrame);
  skyFrame = 0;
  $('detail-player').querySelector('video')?.pause();
  if (!event.persisted) sky?.destroy();
});
if (!requestedProject?.externalOnly) {
  scheduleSky();
  window.addEventListener('pageshow', event => { if (event.persisted) scheduleSky(); });
}
window.dispatchEvent(new Event('portfolio:app-ready'));

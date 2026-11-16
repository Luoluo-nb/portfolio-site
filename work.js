import { profile, projects } from './content.js';
import { Starfield } from './starfield.js';
import { renderVideoChapters } from './video-chapters.js';
import { projectDetails } from './project-details.js';

const $ = id => document.getElementById(id);
const announce = message => { $('detail-announcement').textContent = message; };
let sky;
try {
  sky = new Starfield($('starfield-canvas'), {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    onStatus({state}) { $('starfield-canvas').dataset.state = state; },
  });
} catch { $('starfield-canvas').dataset.state = 'fallback'; }

const requestedId = new URLSearchParams(location.search).get('id');
const project = projects.find(item => item.id === (requestedId === 'ptcg-texture3d' ? 'ptcg-card' : requestedId));
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
function play(startTime = project?.startTime ?? 0) {
  if (!project) return;
  if (project.videoSrc) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.loop = Boolean(project.loop);
    video.preload = 'metadata';
    video.poster = project.cover;
    video.src = project.videoSrc;
    video.defaultPlaybackRate = video.playbackRate = speed;
    video.setAttribute('aria-label', project.title);
    video.addEventListener('ratechange', () => { if (video.isConnected) syncSpeed(video.playbackRate); });
    video.addEventListener('error', () => help('视频暂时无法加载，可点击下方「打开原视频」重试。'), {once:true});
    $('detail-player').replaceChildren(video);
    help('');
    video.play().catch(() => help('点击播放器内的播放按钮继续观看。'));
    announce(`正在播放：${project.title}`);
  } else if (/^BV[a-zA-Z0-9]+$/.test(project.bvid)) {
    const time = Number.isFinite(startTime) && startTime >= 0 ? startTime : 0;
    const source = new URL('https://player.bilibili.com/player.html');
    source.search = new URLSearchParams({bvid:project.bvid,...(project.cid ? {cid:String(project.cid)} : {}),p:String(project.page || 1),t:String(time),autoplay:'0',danmaku:'0',poster:'1'}).toString();
    const frame = $('detail-player').querySelector('iframe') || document.createElement('iframe');
    frame.src = source.href;
    frame.title = `${project.title} — Bilibili 播放器`;
    frame.allow = 'fullscreen; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    if (!frame.isConnected) {
      $('detail-player').replaceChildren(frame);
      const close = document.createElement('button');
      close.className = 'close-player';
      close.type = 'button';
      close.textContent = '关闭播放器';
      close.addEventListener('click', () => { showPoster(); help(''); });
      $('detail-player').append(close);
    }
    help(project.videoChapters?.length
      ? '已打开所选章节，请在 Bilibili 播放器内点击播放。倍速可在播放器内调整。'
      : '倍速请在 Bilibili 播放器内调整；若加载受限，可通过下方链接在 Bilibili 观看。');
    announce('Bilibili 播放器已打开，请点击播放器内的播放按钮。');
  }
}

function showPoster() {
  if (!project) return;
  $('detail-video-chapters')._chapterReset?.();
  const button = document.createElement('button');
  button.className = 'poster-button';
  button.type = 'button';
  button.setAttribute('aria-label', `播放 ${project.title}`);
  const image = document.createElement('img');
  image.src = project.cover;
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => { image.hidden = true; }, {once:true});
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
  $('detail-player').replaceChildren(button);
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
    section.dataset.sourceSlide = chapter.sourceSlide;
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
    for (const item of chapter.figures) {
      const figure = document.createElement('figure');
      figure.className = 'breakdown-figure';
      if (item.type === 'diagram') figure.classList.add('breakdown-diagram');
      const open = document.createElement('a');
      open.href = item.src;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.className = 'breakdown-image-link';
      open.setAttribute('aria-label', `${item.caption}，在新标签页查看大图`);
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
      action.textContent = '查看大图 ↗';
      action.setAttribute('aria-hidden', 'true');
      caption.append(label, action);
      open.append(caption);
      figure.append(open);
      gallery.append(figure);
    }
    section.append(header, gallery);
    $('breakdown-chapters').append(section);
  }
  $('work-breakdown').hidden = false;
  // Chapter URLs remain useful when copied, refreshed, or opened in a new tab.
  if (location.hash.startsWith('#breakdown-')) {
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({block:'start'}));
  }
}

if (project) {
  const platform = {unity:'Unity',unreal:'Unreal Engine'}[project.category] || '作品合集';
  const categoryRoute = project.category ? `/${project.category}` : '';
  const subcategoryRoute = project.subcategory === 'vehicle' ? '/vehicle' : '';
  const returnUrl = `./portfolio.html#works${categoryRoute}${subcategoryRoute}`;
  $('work-back').href = returnUrl;
  $('work-breadcrumb').textContent = project.title;
  $('work-category').textContent = platform + (project.subcategory === 'vehicle' ? ' / 车辆' : '');
  $('work-title').textContent = project.title;
  $('work-description').textContent = project.description || '';
  const seconds = Math.max(0, Math.round(project.duration || 0));
  $('work-duration').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} / 视频`;
  document.title = `${project.title} · 张致远作品集`;
  $('work-source').href = project.videoSrc || `https://www.bilibili.com/video/${project.bvid}/${Number.isFinite(project.startTime) && project.startTime > 0 ? `?t=${project.startTime}` : ''}`;
  $('work-source').textContent = project.videoSrc ? '打开原视频 ↗' : '在 Bilibili 打开 ↗';
  $('work-profile').href = profile.bilibili;
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
  renderVideoChapters($('detail-video-chapters'), project, () => $('detail-player').querySelector('video'), play);
  renderBreakdown(projectDetails[project.id]);
} else {
  document.title = '未找到作品 · 张致远作品集';
  $('work-title').textContent = '未找到作品';
  $('work-breadcrumb').textContent = '未找到作品';
  $('work-missing').hidden = false;
}
$('detail-year').textContent = new Date().getFullYear();
window.addEventListener('pagehide', event => {
  $('detail-player').querySelector('video')?.pause();
  // Detaching the iframe also stops any cross-origin audio on browser back/forward.
  if ($('detail-player').querySelector('iframe')) showPoster();
  if (!event.persisted) sky?.destroy();
});

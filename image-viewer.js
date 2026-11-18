import { translate } from './i18n.js';

// A native dialog keeps the preview in this page and makes the background inert.
const viewer = document.createElement('dialog');
viewer.className = 'image-viewer';
viewer.id = 'image-preview';
viewer.dataset.noTranslate = '';
viewer.setAttribute('aria-labelledby', 'image-preview-title');
viewer.innerHTML = `
  <header class="image-viewer-header">
    <h2 id="image-preview-title"></h2>
    <button class="image-viewer-close" type="button" autofocus>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </header>
  <div class="image-viewer-stage" tabindex="0">
    <div class="image-viewer-media"><img class="image-viewer-image" decoding="async" alt=""></div>
    <p class="image-viewer-status" role="status"></p>
  </div>
  <footer class="image-viewer-footer">
    <p class="image-viewer-hint"></p>
    <button class="image-viewer-zoom" type="button" aria-pressed="false">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/></svg>
      <span></span>
    </button>
  </footer>`;
document.body.append(viewer);
const title = viewer.querySelector('h2');
const closeButton = viewer.querySelector('.image-viewer-close');
const stage = viewer.querySelector('.image-viewer-stage');
const media = viewer.querySelector('.image-viewer-media');
const image = viewer.querySelector('img');
const status = viewer.querySelector('.image-viewer-status');
const hint = viewer.querySelector('.image-viewer-hint');
const zoomButton = viewer.querySelector('.image-viewer-zoom');
let opener = null, sourceCaption = '', zoomed = false, loadState = 'loading', generation = 0;
let savedScroll = {x:0,y:0};

function labels() {
  title.textContent = translate(sourceCaption || '图片预览');
  image.alt = translate(sourceCaption);
  closeButton.setAttribute('aria-label', translate('关闭图片预览'));
  closeButton.title = translate('关闭图片预览');
  stage.setAttribute('aria-label', translate(zoomed ? '图片细节，可滚动查看' : '图片预览'));
  zoomButton.querySelector('span').textContent = translate(zoomed ? '适合窗口' : '原始尺寸');
  zoomButton.setAttribute('aria-pressed', String(zoomed));
  hint.textContent = translate(zoomed ? '滚动查看图片细节' : '点击空白处或按 Esc 关闭');
  status.textContent = translate(loadState === 'error' ? '图片加载失败，请关闭后重试。' : '正在加载图片…');
}
function fit() {
  zoomed = false; viewer.dataset.zoom = 'fit';
  stage.scrollTo({left:0,top:0,behavior:'instant'}); labels();
}
function close() { if (viewer.open) viewer.close(); }
function open(link) {
  if (typeof viewer.showModal !== 'function') return false;
  opener = link;
  sourceCaption = link.dataset.imageCaption || link.querySelector('img')?.alt || '';
  savedScroll = {x:scrollX,y:scrollY};
  const token = ++generation;
  loadState = 'loading'; status.hidden = false; image.hidden = true; zoomButton.disabled = true;
  fit();
  image.onload = () => {
    if (generation !== token) return;
    loadState = 'ready'; image.hidden = false; status.hidden = true; zoomButton.disabled = false;
    image.style.setProperty('--image-width', `${image.naturalWidth}px`);
    image.style.setProperty('--image-height', `${image.naturalHeight}px`);
    labels();
  };
  image.onerror = () => {
    if (generation !== token) return;
    loadState = 'error'; image.hidden = true; status.hidden = false; zoomButton.disabled = true; labels();
  };
  image.src = link.href;
  document.documentElement.classList.add('image-viewer-open');
  viewer.showModal();
  closeButton.focus({preventScroll:true});
  return true;
}

document.addEventListener('click', event => {
  const link = event.target instanceof Element ? event.target.closest('.breakdown-image-link') : null;
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (open(link)) event.preventDefault();
});
closeButton.addEventListener('click', close);
viewer.addEventListener('cancel', event => { event.preventDefault(); close(); });
viewer.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...viewer.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !viewer.contains(document.activeElement))) {
    event.preventDefault(); last.focus({preventScroll:true});
  } else if (!event.shiftKey && (document.activeElement === last || !viewer.contains(document.activeElement))) {
    event.preventDefault(); first.focus({preventScroll:true});
  }
});
viewer.addEventListener('close', () => {
  generation++; document.documentElement.classList.remove('image-viewer-open');
  opener?.focus({preventScroll:true});
  scrollTo({left:savedScroll.x,top:savedScroll.y,behavior:'instant'});
  opener = null;
});
// Do not close after a drag that begins on the image and ends in the backdrop.
let blankPointerDown = false;
const isBlank = event => {
  if (event.target === stage || event.target === media) return true;
  if (event.target !== viewer) return false;
  const rect = viewer.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
};
viewer.addEventListener('pointerdown', event => { blankPointerDown = isBlank(event); });
viewer.addEventListener('click', event => { if (blankPointerDown && isBlank(event)) close(); blankPointerDown = false; });
zoomButton.addEventListener('click', () => {
  zoomed = !zoomed; viewer.dataset.zoom = zoomed ? 'original' : 'fit';
  stage.scrollTo({left:0,top:0,behavior:'instant'}); labels();
});
window.addEventListener('portfolio:languagechange', labels);
window.addEventListener('pagehide', close);
labels();

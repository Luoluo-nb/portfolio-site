import { mountMusicShader } from './music-shader.js';

const source = './media/bgm-instrumental.mp3';
const preferenceKey = 'portfolio-music-volume';
const sessionKey = 'portfolio-music-session';
const ownerKey = 'portfolio-music-owner';
let volume = 0.35;
let muted = false;
let wanted = false;
let resumeTime = 0;
let blocked = false;
let unavailable = false;
let pageActive = true;
let tabId = `music-${Date.now()}-${Math.random().toString(36).slice(2)}`;
try {
  const preference = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
  if (Number.isFinite(preference?.volume)) volume = Math.max(0, Math.min(1, preference.volume));
  muted = Boolean(preference?.muted);
  const previous = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  wanted = Boolean(previous?.playing);
  resumeTime = Number(previous?.time) || 0;
} catch { /* Music still works when browser storage is disabled. */ }

const audio = new Audio();
audio.id = 'background-music';
audio.src = source;
audio.preload = 'none';
audio.loop = true;
audio.volume = volume;
audio.muted = muted;
audio.hidden = true;
document.body.append(audio);

// Analyse only this soundtrack, after a user gesture. Playback remains a normal
// media element when Web Audio is unavailable or cannot start.
let audioContext;
let mediaSource;
let analyser;
let frequencyData;
let analysisPending;
let analysisUnavailable = false;
let sampledAt = 0;
const levels = {bass: 0, mid: 0, treble: 0, active: false};
async function enableAnalysis() {
  if (analysisUnavailable || analysisPending || !wanted) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) { analysisUnavailable = true; return; }
  analysisPending = true;
  try {
    if (!audioContext) audioContext = new Context({latencyHint: 'playback'});
    // Do not reroute audio into a context that has not successfully resumed.
    if (audioContext.state !== 'running') await audioContext.resume();
    if (audioContext.state !== 'running' || mediaSource) return;
    const nextAnalyser = audioContext.createAnalyser();
    nextAnalyser.fftSize = 1024;
    nextAnalyser.smoothingTimeConstant = 0.72;
    nextAnalyser.minDecibels = -85;
    nextAnalyser.maxDecibels = -15;
    const nextData = new Uint8Array(nextAnalyser.frequencyBinCount);
    // Connect the downstream path first; createMediaElementSource is called once.
    nextAnalyser.connect(audioContext.destination);
    mediaSource = audioContext.createMediaElementSource(audio);
    try {
      mediaSource.connect(nextAnalyser);
      analyser = nextAnalyser;
      frequencyData = nextData;
    } catch {
      // The media element is already attached: preserve a direct audible route.
      mediaSource.connect(audioContext.destination);
      nextAnalyser.disconnect();
      analysisUnavailable = true;
    }
  } catch {
    analysisUnavailable = true;
  } finally { analysisPending = false; }
}
function getLevels() {
  const now = performance.now();
  const seconds = Math.min(1, Math.max(0, (now - sampledAt) / 1000));
  sampledAt = now;
  const active = Boolean(analyser && audioContext?.state === 'running' && wanted && !audio.paused
    && !audio.muted && audio.volume > 0 && !blocked && pageActive && !document.hidden);
  const targets = [0, 0, 0];
  if (active) {
    analyser.getByteFrequencyData(frequencyData);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    [[45, 200], [200, 2200], [2200, 9000]].forEach(([low, high], band) => {
      const begin = Math.max(1, Math.floor(low / binHz));
      const end = Math.min(frequencyData.length - 1, Math.ceil(high / binHz));
      let energy = 0;
      for (let bin = begin; bin <= end; bin++) energy += (frequencyData[bin] / 255) ** 2;
      targets[band] = Math.sqrt(energy / Math.max(1, end - begin + 1)) * audio.volume;
    });
  }
  ['bass', 'mid', 'treble'].forEach((band, index) => {
    const easing = 1 - Math.exp(-seconds / (targets[index] > levels[band] ? 0.07 : 0.12));
    levels[band] += (targets[index] - levels[band]) * easing;
    if (levels[band] < 0.001) levels[band] = 0;
  });
  levels.active = active;
  return {...levels};
}
window.PortfolioAudioAnalysis = Object.freeze({getLevels});
// A resumed cross-page session can opt in on the visitor's next interaction.
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => {
  if (wanted) enableAnalysis();
}, {once: true, passive: true});
const header = document.querySelector('.header');
let tools = header.querySelector('.header-tools');
if (!tools) {
  tools = document.createElement('div');
  tools.className = 'header-tools';
  header.append(tools);
}
const panel = document.createElement('div');
panel.className = 'music-controls';
panel.setAttribute('role', 'group');
panel.setAttribute('aria-label', '背景音乐');
panel.innerHTML = `<button type="button" class="music-button" id="music-toggle" aria-label="播放背景音乐" title="播放背景音乐"></button>
  <button type="button" class="music-button" id="music-mute" aria-label="静音背景音乐" title="静音背景音乐"></button>
  <div class="music-volume-control">
    <label class="sr-only" for="music-volume">背景音乐音量</label>
    <input id="music-volume" type="range" min="0" max="100" step="1" value="${Math.round(volume * 100)}">
  </div>
  <span id="music-status" class="sr-only" role="status" aria-live="polite"></span>`;
tools.prepend(panel);
const toggle = panel.querySelector('#music-toggle');
const mute = panel.querySelector('#music-mute');
const slider = panel.querySelector('#music-volume');
const status = panel.querySelector('#music-status');
let musicShader;
const creditTarget = document.querySelector('.detail-footer, .footer-bottom');
if (creditTarget) {
  const credit = document.createElement('p');
  credit.className = 'music-credit';
  credit.innerHTML = '<span>背景音乐</span><span data-no-translate>《永夜のパレード》 · JUMA / ケーキ姫☆優海</span>';
  creditTarget.append(credit);
}
const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
const playIcon = icon('<path d="m9 6.5 8.5 5.5-8.5 5.5Z"/>');
const pauseIcon = icon('<path d="M9 6.5v11M15 6.5v11"/>');
const soundIcon = icon('<path d="M4.5 9h3l4.5-3.5v13L7.5 15h-3Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const silentIcon = icon('<path d="M4.5 9h3l4.5-3.5v13L7.5 15h-3Z"/><path d="m16 9 5 6m0-6-5 6"/>');
function draw() {
  const playing = wanted && !audio.paused;
  panel.dataset.playing = String(playing);
  panel.dataset.blocked = String(blocked);
  toggle.innerHTML = wanted && !blocked ? pauseIcon : playIcon;
  toggle.disabled = blocked;
  const action = wanted ? '暂停背景音乐' : '播放背景音乐';
  toggle.setAttribute('aria-label', action);
  toggle.title = blocked ? '关闭视频播放器后可播放音乐' : action;
  toggle.setAttribute('aria-pressed', String(wanted));
  mute.innerHTML = muted || volume === 0 ? silentIcon : soundIcon;
  mute.setAttribute('aria-pressed', String(muted));
  const muteAction = muted ? '取消背景音乐静音' : '静音背景音乐';
  mute.setAttribute('aria-label', muteAction);
  mute.title = muteAction;
  slider.style.setProperty('--music-volume', `${Math.round(volume * 100)}%`);
  status.textContent = unavailable ? '音乐暂时无法加载，请稍后重试。' : blocked && wanted ? '观看 Bilibili 视频时暂停背景音乐。' : playing ? '背景音乐正在播放' : '背景音乐已暂停';
  musicShader?.refresh();
}
function remember() {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify({volume, muted}));
    sessionStorage.setItem(sessionKey, JSON.stringify({playing: wanted, time: audio.currentTime || resumeTime, tabId}));
  } catch { /* Playback does not depend on storage. */ }
}
function claimAudio() {
  try { localStorage.setItem(ownerKey, tabId); } catch {}
}
async function start() {
  if (!wanted || blocked || document.hidden || !pageActive) return draw();
  unavailable = false;
  try {
    if (mediaSource && audioContext.state !== 'running' && audioContext.state !== 'closed') {
      // Browsers may suspend an existing graph while a page is in the background.
      audioContext.resume().catch(() => {});
    }
    await audio.play();
    if (!wanted || blocked || document.hidden || !pageActive) audio.pause();
    else claimAudio();
  } catch (error) {
    if (error.name === 'NotAllowedError') wanted = false;
    else if (error.name !== 'AbortError') { unavailable = true; wanted = false; }
  }
  remember();
  draw();
}
toggle.addEventListener('click', () => {
  wanted = !wanted;
  if (wanted) { enableAnalysis(); start(); }
  else audio.pause();
  remember();
  draw();
});
mute.addEventListener('click', () => {
  muted = !muted;
  audio.muted = muted;
  remember();
  draw();
});
let volumeAnimation;
function adjustVolume(target) {
  cancelAnimationFrame(volumeAnimation);
  const from = audio.volume;
  const began = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - began) / 180);
    audio.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
    if (progress < 1) volumeAnimation = requestAnimationFrame(frame);
  }
  volumeAnimation = requestAnimationFrame(frame);
}
function syncMedia() {
  const wasBlocked = blocked;
  blocked = Boolean(document.querySelector('iframe[src^="https://player.bilibili.com/"]'));
  const nativeVideoPlaying = [...document.querySelectorAll('video')].some(video => !video.paused && !video.ended && !video.muted && video.volume > 0);
  adjustVolume(volume * (nativeVideoPlaying ? 0.18 : 1));
  if (blocked) audio.pause();
  else if (wasBlocked && wanted) start();
  draw();
}
slider.addEventListener('input', () => {
  volume = Number(slider.value) / 100;
  if (volume > 0) muted = false;
  audio.muted = muted;
  syncMedia();
  remember();
});
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration) && resumeTime > 0) audio.currentTime = resumeTime % audio.duration;
  resumeTime = 0;
});
audio.addEventListener('play', draw);
audio.addEventListener('pause', draw);
audio.addEventListener('error', () => { unavailable = true; wanted = false; remember(); draw(); });
let savedAt = 0;
audio.addEventListener('timeupdate', () => {
  if (performance.now() - savedAt > 1500) { remember(); savedAt = performance.now(); }
});
for (const event of ['play', 'pause', 'ended', 'volumechange']) {
  document.addEventListener(event, e => { if (e.target.tagName === 'VIDEO') syncMedia(); }, true);
}
new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('iframe,video') || node.querySelector('iframe,video'))))) syncMedia();
}).observe(document.querySelector('main'), {childList: true, subtree: true});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { remember(); audio.pause(); }
  else if (wanted) start();
});
window.addEventListener('pagehide', () => { pageActive = false; remember(); audio.pause(); });
window.addEventListener('pageshow', event => { pageActive = true; if (event.persisted && wanted) start(); });
window.addEventListener('storage', event => {
  if (event.key === ownerKey && event.newValue !== tabId && wanted) {
    wanted = false;
    audio.pause();
    remember();
    draw();
  }
});
musicShader = mountMusicShader(panel, () => ({
  playing: wanted && !audio.paused,
  pauseIcon: wanted && !blocked,
  muted: muted || volume === 0,
  blocked,
}), getLevels);
draw();
if (wanted) start();

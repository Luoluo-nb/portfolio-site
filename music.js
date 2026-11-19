import { mountMusicShader } from './music-shader.js';

const source = './media/bgm-robot-loop.mp3';
const preferenceKey = 'portfolio-music-volume';
const sessionKey = 'portfolio-music-session';
const ownerKey = 'portfolio-music-owner';
let volume = 0.35;
let muted = false;
let wanted = false;
let resumeTime = 0;
let unavailable = false;
let pageActive = true;
let tabId = `music-${Date.now()}-${Math.random().toString(36).slice(2)}`;
try {
  const preference = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
  if (Number.isFinite(preference?.volume)) volume = Math.max(0, Math.min(1, preference.volume));
  muted = Boolean(preference?.muted);
  const previous = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
  wanted = Boolean(previous?.playing);
  resumeTime = previous?.source === source ? Number(previous.time) || 0 : 0;
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
let previousSpectrum;
let analysisPending;
let analysisUnavailable = false;
let sampledAt = 0;
// Audio Analyze -> Select(snare-like onset) -> Lag -> Speed.
// This is a spectral approximation, not instrument/source separation.
const SNARE_ANALYSIS = Object.freeze({
  bodyHz: [180, 350], noiseHz: [1200, 6000], hatHz: [6000, 12000], kickHz: [35, 150],
  warmupSeconds: .28, refractorySeconds: .20, holdSeconds: .075,
  bodyAttackSeconds: .08, attackSeconds: .05, releaseSeconds: .60, adaptiveSeconds: 1.8, speedGain: 7.0,
});
const levels = {bass: 0, mid: 0, treble: 0, active: false,
  snare: 0, snareConfidence: 0, snareLag: 0, speed: 0, snareCount: 0, onsetTime: 0,
  snareBodyFlux: 0, snareNoiseFlux: 0};
let spectrumPrimed = false, audibleSince = 0, lastOnset = -1000, heldSnare = 0;
let bodyMean = .006, bodyDeviation = .003, noiseMean = .01, noiseDeviation = .005;
let recentBodyAttack = 0;
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
    nextAnalyser.fftSize = 2048;
    nextAnalyser.smoothingTimeConstant = 0.28;
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
      previousSpectrum = new Float32Array(nextData.length);
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
  const active = Boolean(analyser && audioContext?.state === 'running' && wanted && !audio.paused
    && !audio.muted && audio.volume > 0 && pageActive && !document.hidden);
  // Multiple visual consumers share one sample, rather than flattening flux by
  // repeatedly comparing the same FFT frame within a browser frame.
  if (now - sampledAt < 16 && active === levels.active) return {...levels};
  const seconds = Math.min(.12, Math.max(.001, (now - sampledAt) / 1000));
  sampledAt = now;
  const targets = [0, 0, 0];
  if (active) {
    analyser.getByteFrequencyData(frequencyData);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    [[45, 200], [200, 2200], [2200, 9000]].forEach(([low, high], band) => {
      const begin = Math.max(1, Math.floor(low / binHz));
      const end = Math.min(frequencyData.length - 1, Math.ceil(high / binHz));
      let energy = 0;
      for (let bin = begin; bin <= end; bin++) energy += (frequencyData[bin] / 255) ** 2;
      targets[band] = Math.sqrt(energy / Math.max(1, end - begin + 1));
    });
    const bands = [SNARE_ANALYSIS.bodyHz, SNARE_ANALYSIS.noiseHz, SNARE_ANALYSIS.hatHz, SNARE_ANALYSIS.kickHz]
      .map(([low, high]) => ({low, high, flux:0, energy:0, count:0}));
    for (let bin = 1; bin < frequencyData.length; bin++) {
      const hz = bin * binHz, current = frequencyData[bin] / 255;
      const increase = Math.max(0, current - previousSpectrum[bin]);
      for (const band of bands) if (hz >= band.low && hz <= band.high) {
        band.flux += increase; band.energy += current * current; band.count++;
      }
      previousSpectrum[bin] = current;
    }
    for (const band of bands) { band.flux /= Math.max(1, band.count); band.energy = Math.sqrt(band.energy / Math.max(1, band.count)); }
    const [bodyBand, noiseBand, hatBand, kickBand] = bands;
    recentBodyAttack = Math.max(bodyBand.flux, recentBodyAttack * Math.exp(-seconds / SNARE_ANALYSIS.bodyAttackSeconds));
    let confidence = 0;
    if (!spectrumPrimed) {
      spectrumPrimed = true; audibleSince = now;
      bodyMean = .006; bodyDeviation = .003; noiseMean = .01; noiseDeviation = .005;
    } else {
      const bodyThreshold = Math.max(.005, bodyMean * .65 + bodyDeviation * .25);
      const noiseThreshold = Math.max(.006, noiseMean * 1.25 + noiseDeviation * .65);
      // A noisy mid/high attack must coincide with drum-body energy. Sustained
      // bass can mask its separate attack, so body presence is a soft qualifier.
      // An isolated kick lacks the noisy attack; an isolated hat lacks the body.
      const balanced = bodyBand.energy > Math.max(.045, hatBand.energy * .18, noiseBand.energy * .12)
        && noiseBand.energy > Math.max(.05, hatBand.energy * .38)
        && noiseBand.flux > kickBand.flux * .06;
      // A short peak window tolerates the body/noise components landing in
      // adjacent FFT frames and a body partly masked by sustained bass.
      if (balanced && noiseBand.flux > noiseThreshold) {
        const attack = Math.min(1, recentBodyAttack / Math.max(.014, bodyThreshold * 2));
        const presence = Math.min(1, Math.max(0, (bodyBand.energy - .045) / .22));
        const bodyStrength = Math.max(attack, presence * .72);
        const noiseStrength = Math.min(1, (noiseBand.flux / noiseThreshold - 1) / 1.5);
        confidence = Math.sqrt(bodyStrength * noiseStrength);
      }
      if (now - audibleSince > SNARE_ANALYSIS.warmupSeconds * 1000
          && now - lastOnset > SNARE_ANALYSIS.refractorySeconds * 1000 && confidence > .20) {
        lastOnset = now; levels.onsetTime = now / 1000; levels.snareCount++; heldSnare = confidence;
      }
      const adapt = 1 - Math.exp(-seconds / SNARE_ANALYSIS.adaptiveSeconds);
      bodyDeviation += (Math.abs(bodyBand.flux - bodyMean) - bodyDeviation) * adapt;
      noiseDeviation += (Math.abs(noiseBand.flux - noiseMean) - noiseDeviation) * adapt;
      bodyMean += (bodyBand.flux - bodyMean) * adapt;
      noiseMean += (noiseBand.flux - noiseMean) * adapt;
    }
    const audibleGain = Math.min(1, Math.sqrt(audio.volume / .35));
    levels.snareBodyFlux = bodyBand.flux; levels.snareNoiseFlux = noiseBand.flux;
    levels.snareConfidence = confidence;
    // Select: hold the normalized snare onset briefly, then send zero to Lag.
    levels.snare = now - lastOnset < SNARE_ANALYSIS.holdSeconds * 1000 ? heldSnare * audibleGain : 0;
    const lagSeconds = levels.snare > levels.snareLag ? SNARE_ANALYSIS.attackSeconds : SNARE_ANALYSIS.releaseSeconds;
    levels.snareLag += (levels.snare - levels.snareLag) * (1 - Math.exp(-seconds / lagSeconds));
    if (levels.snareLag < .0001) levels.snareLag = 0;
    // Speed: only the lagged snare drives this output; no raw FFT/bass bypass.
    levels.speed = levels.snareLag * SNARE_ANALYSIS.speedGain;
    for (let band = 0; band < targets.length; band++) targets[band] *= audio.volume;
  } else {
    spectrumPrimed = false; audibleSince = 0; heldSnare = 0; recentBodyAttack = 0;
    // Explicit user silence/backgrounding gates the chain. It does not integrate
    // a tail later on resume or reuse stale pre-pause FFT differences.
    levels.snare = levels.snareConfidence = levels.snareLag = levels.speed = 0;
    levels.snareBodyFlux = levels.snareNoiseFlux = 0;
  }
  ['bass', 'mid', 'treble'].forEach((band, index) => {
    const easing = 1 - Math.exp(-seconds / (targets[index] > levels[band] ? 0.07 : 0.12));
    levels[band] += (targets[index] - levels[band]) * easing;
    if (levels[band] < 0.001) levels[band] = 0;
  });
  levels.active = active;
  return {...levels};
}
window.PortfolioAudioAnalysis = Object.freeze({getLevels, snareSettings:SNARE_ANALYSIS});
audio.addEventListener('pause', () => getLevels());
audio.addEventListener('volumechange', () => { if (audio.muted || audio.volume === 0) getLevels(); });
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
  credit.innerHTML = '<span>背景音乐</span><a href="https://peritune.com/blog/2015/09/16/robot/" target="_blank" rel="noopener noreferrer" title="Robot — PeriTune" data-no-translate>Robot · PeriTune</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" data-no-translate>CC BY 4.0</a><span>格式转换与响度调整</span>';
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
  panel.dataset.blocked = 'false';
  toggle.innerHTML = wanted ? pauseIcon : playIcon;
  toggle.disabled = false;
  const action = wanted ? '暂停背景音乐' : '播放背景音乐';
  toggle.setAttribute('aria-label', action);
  toggle.title = action;
  toggle.setAttribute('aria-pressed', String(wanted));
  mute.innerHTML = muted || volume === 0 ? silentIcon : soundIcon;
  mute.setAttribute('aria-pressed', String(muted));
  const muteAction = muted ? '取消背景音乐静音' : '静音背景音乐';
  mute.setAttribute('aria-label', muteAction);
  mute.title = muteAction;
  slider.style.setProperty('--music-volume', `${Math.round(volume * 100)}%`);
  status.textContent = unavailable ? '音乐暂时无法加载，请稍后重试。' : playing ? '背景音乐正在播放' : '背景音乐已暂停';
  musicShader?.refresh();
}
function remember() {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify({volume, muted}));
    sessionStorage.setItem(sessionKey, JSON.stringify({playing: wanted, time: audio.currentTime || resumeTime, tabId, source}));
  } catch { /* Playback does not depend on storage. */ }
}
function claimAudio() {
  try { localStorage.setItem(ownerKey, tabId); } catch {}
}
async function start() {
  if (!wanted || document.hidden || !pageActive) return draw();
  unavailable = false;
  try {
    if (mediaSource && audioContext.state !== 'running' && audioContext.state !== 'closed') {
      // Browsers may suspend an existing graph while a page is in the background.
      audioContext.resume().catch(() => {});
    }
    await audio.play();
    if (!wanted || document.hidden || !pageActive) audio.pause();
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
  // Embedded Bilibili playback never changes the visitor's BGM selection.
  // Only audible native videos retain their existing volume ducking behavior.
  const nativeVideoPlaying = [...document.querySelectorAll('video')].some(video => !video.paused && !video.ended && !video.muted && video.volume > 0);
  adjustVolume(volume * (nativeVideoPlaying ? 0.18 : 1));
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
  if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('video') || node.querySelector('video'))))) syncMedia();
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
  pauseIcon: wanted,
  muted: muted || volume === 0,
  blocked: false,
}), getLevels);
draw();
if (wanted) start();

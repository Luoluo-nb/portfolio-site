import { mountMusicShader } from './music-shader.js';
import { createPercussionDetector, PERCUSSION_SETTINGS as SNARE_ANALYSIS } from './audio-onsets.js';
import { createSpectrumMixer } from './audio-spectrum.js';

const source = './media/bgm-new-days-hope-loop.mp3';
const preferenceKey = 'portfolio-music-volume';
const sessionKey = 'portfolio-music-session';
const ownerKey = 'portfolio-music-owner';
const ENTRY_FADE_SECONDS = 2;
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

let entryIntro;
let outputGain;
let mediaVolume = volume;
let outputVolume = volume;
let volumeAnimation;

function applyOutputVolume() {
  outputVolume = mediaVolume * (entryIntro?.level ?? 1);
  // Use the audio graph for volume where available, including on devices
  // whose native media elements do not support programmatic volume changes.
  if (outputGain) outputGain.gain.value = outputVolume;
  else audio.volume = outputVolume;
  audio.muted = muted || Boolean(entryIntro && outputVolume === 0);
}

function clearEntryIntro() {
  if (!entryIntro) return;
  cancelAnimationFrame(entryIntro.frame);
  entryIntro = undefined;
}

function beginEntryFade() {
  const intro = entryIntro;
  if (!intro || intro.phase === 'waiting' || intro.frame || audio.paused || audio.seeking || !playbackAllowed()) return;
  intro.phase = 'fading';
  function fade() {
    intro.frame = 0;
    if (entryIntro !== intro || !playbackAllowed()) return;
    // Drive the ramp with the media clock so a buffering pause cannot use up
    // the fade before sound starts.
    intro.level = Math.min(1, audio.currentTime / ENTRY_FADE_SECONDS);
    if (intro.level === 1) clearEntryIntro();
    applyOutputVolume();
    drawVolume();
    if (entryIntro === intro) intro.frame = requestAnimationFrame(fade);
  }
  intro.frame = requestAnimationFrame(fade);
}

async function continueEntryIntro() {
  const intro = entryIntro;
  if (!intro) return;
  if (intro.phase === 'waiting') {
    await window.PortfolioStartGate.skyReady;
    if (entryIntro !== intro || intro.phase !== 'waiting' || !playbackAllowed() || audio.paused) return;
    intro.phase = 'rewinding';
    if (audio.currentTime > 0) audio.currentTime = 0;
  }
  beginEntryFade();
}

// Analyse only this soundtrack when playback is wanted and the page is active.
// Native playback survives Web Audio permission/capability failures.
let audioContext;
let mediaSource;
let analyser;
let frequencyData;
let mixMusicSpectrum;
let waveformData;
let analysisPending;
let analysisRequest = 0, activityGeneration = 0, playbackRequest = 0;
let analysisUnavailable = false;
let sampledAt = 0;
// Actual linear-amplitude drum attacks -> lag -> integrated visual speed.
const percussion = createPercussionDetector();
const levels = {bass: 0, mid: 0, treble: 0, loudness: 0, outputVolume: 0, active: false,
  snare: 0, snareConfidence: 0, snareLag: 0, speed: 0, snareCount: 0, onsetTime: 0,
  snareBodyFlux: 0, snareNoiseFlux: 0, kick: 0, kickConfidence: 0, kickLag: 0, kickCount: 0,
  kickFlux: 0, kickThreshold: 0, beat: 0, beatLag: 0, beatCount: 0, beatTime: 0, sampleId: 0};
const playbackAllowed = () => wanted && pageActive && !document.hidden && !window.PortfolioStartGate?.active;
function suspendAnalysis() {
  if (audioContext && audioContext.state !== 'closed') audioContext.suspend().catch(() => {});
}
function pausePlayback() {
  playbackRequest++; activityGeneration++; analysisPending = 0;
  audio.pause();
  if (entryIntro) {
    cancelAnimationFrame(entryIntro.frame);
    entryIntro.frame = 0;
    if (entryIntro.phase === 'waiting') audio.currentTime = 0;
  }
  applyOutputVolume();
  suspendAnalysis();
}
async function enableAnalysis(fromGesture = false) {
  if (analysisUnavailable || (analysisPending && !fromGesture) || !playbackAllowed()) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) { analysisUnavailable = true; return; }
  const request = ++analysisRequest, generation = activityGeneration;
  analysisPending = request;
  try {
    if (!audioContext) audioContext = new Context({latencyHint: 'playback'});
    // Do not reroute audio into a context that has not successfully resumed.
    // A denied/pending automatic resume can be retried on the next real gesture.
    if (audioContext.state !== 'running') {
      try { await audioContext.resume(); } catch { return; }
    }
    if (generation !== activityGeneration || !playbackAllowed()) {
      if (!playbackAllowed()) suspendAnalysis();
      return;
    }
    if (audioContext.state !== 'running' || mediaSource) return;
    const nextAnalyser = audioContext.createAnalyser();
    const nextGain = audioContext.createGain();
    nextGain.gain.value = outputVolume;
    nextAnalyser.fftSize = 2048;
    nextAnalyser.smoothingTimeConstant = 0.28;
    nextAnalyser.minDecibels = -85;
    nextAnalyser.maxDecibels = -15;
    const nextData = new Float32Array(nextAnalyser.frequencyBinCount);
    const nextWaveform = new Float32Array(nextAnalyser.fftSize);
    // Connect the downstream path first; createMediaElementSource is called once.
    nextAnalyser.connect(audioContext.destination);
    mediaSource = audioContext.createMediaElementSource(audio);
    try {
      nextGain.connect(nextAnalyser);
      mediaSource.connect(nextGain);
    } catch {
      // The media element is already attached: preserve a direct audible route.
      mediaSource.connect(audioContext.destination);
      nextAnalyser.disconnect();
      analysisUnavailable = true;
      return;
    }
    outputGain = nextGain;
    audio.volume = 1;
    applyOutputVolume();
    analyser = nextAnalyser;
    frequencyData = nextData;
    waveformData = nextWaveform;
    mixMusicSpectrum = createSpectrumMixer(audioContext.sampleRate, analyser.fftSize);
  } catch (error) {
    analysisUnavailable = error.name !== 'NotAllowedError' && error.name !== 'AbortError';
  } finally { if (analysisPending === request) analysisPending = 0; }
}
function getLevels() {
  const now = performance.now();
  // Expose the audible element gain separately from the track's RMS envelope.
  // Refresh before the FFT cache return; native playback also works without FFT.
  const audible = playbackAllowed() && !audio.paused && !audio.ended && !audio.muted
    && (!mediaSource || audioContext?.state === 'running');
  levels.outputVolume = audible ? outputVolume : 0;
  const active = Boolean(analyser && audioContext?.state === 'running' && wanted && !audio.paused
    && !audio.muted && outputVolume > 0 && pageActive && !document.hidden);
  // Multiple visual consumers share one sample, rather than flattening flux by
  // repeatedly comparing the same FFT frame within a browser frame.
  if (now - sampledAt < 16 && active === levels.active) return {...levels};
  const seconds = Math.min(.12, Math.max(.001, (now - sampledAt) / 1000));
  sampledAt = now;
  levels.sampleId++;
  const targets = [0, 0, 0];
  if (active) {
    analyser.getFloatFrequencyData(frequencyData);
    analyser.getFloatTimeDomainData(waveformData);
    const binHz = audioContext.sampleRate / analyser.fftSize;
    [[45, 200], [200, 2200], [2200, 9000]].forEach(([low, high], band) => {
      const begin = Math.max(1, Math.floor(low / binHz));
      const end = Math.min(frequencyData.length - 1, Math.ceil(high / binHz));
      let energy = 0;
      for (let bin = begin; bin <= end; bin++) {
        const displayValue = Math.max(0, Math.min(1, (frequencyData[bin] + 85) / 70));
        energy += displayValue * displayValue;
      }
      targets[band] = Math.sqrt(energy / Math.max(1, end - begin + 1));
    });
    let power = 0;
    for (const sample of waveformData) power += sample * sample;
    const rms = Math.sqrt(power / waveformData.length);
    // The analyser receives the current output gain, including fade and ducking.
    // Fixed gain preserves quiet passages instead of normalizing them upward.
    const loudnessTarget = Math.min(1, rms * 6);
    const loudnessEase = 1 - Math.exp(-seconds / (loudnessTarget > levels.loudness ? .05 : .24));
    levels.loudness += (loudnessTarget - levels.loudness) * loudnessEase;
    Object.assign(levels, percussion.update(frequencyData, rms, now, seconds, binHz, outputVolume));
    for (let band = 0; band < targets.length; band++) targets[band] *= outputVolume;
  } else {
    // Explicit silence/backgrounding discards stale FFT and envelope history.
    levels.loudness = 0;
    Object.assign(levels, percussion.reset());
  }
  ['bass', 'mid', 'treble'].forEach((band, index) => {
    const easing = 1 - Math.exp(-seconds / (targets[index] > levels[band] ? 0.07 : 0.12));
    levels[band] += (targets[index] - levels[band]) * easing;
    if (levels[band] < 0.001) levels[band] = 0;
  });
  levels.active = active;
  return {...levels};
}
// The header reads the same post-volume FFT frame as the other visuals.
function readSpectrum(bands, trace) {
  bands.fill(0);
  if (!bands.length || !mixMusicSpectrum) return;
  try {
    if (!getLevels().active) return;
    mixMusicSpectrum(frequencyData, bands);
    if (!trace?.length) return;
    // Start on a rising zero crossing, then attenuate bass in the display trace.
    // This runs on the analyser data only, after the audio output is connected.
    const span = waveformData.length >> 1;
    const bassBlend = 1 - Math.exp(-2 * Math.PI * 340 / audioContext.sampleRate);
    let start = 0;
    let bass = waveformData[0];
    for (let i = 1; i < span; i++) {
      if (waveformData[i - 1] <= 0 && waveformData[i] > 0) { start = i; break; }
    }
    for (let i = 0; i < start; i++) bass += (waveformData[i] - bass) * bassBlend;
    for (let i = 0; i < trace.length; i++) {
      const first = start + Math.floor(i * span / trace.length);
      const end = Math.max(first + 1, start + Math.floor((i + 1) * span / trace.length));
      let sum = 0;
      for (let j = first; j < end; j++) {
        const sample = waveformData[j];
        bass += (sample - bass) * bassBlend;
        sum += sample - bass * .88;
      }
      trace[i] = sum / (end - first);
    }
  } catch { /* Keep the display at rest when spectrum data is unavailable. */ }
}
window.PortfolioAudioAnalysis = Object.freeze({getLevels, readSpectrum, snareSettings:SNARE_ANALYSIS, beatSettings:SNARE_ANALYSIS});
audio.addEventListener('pause', () => getLevels());
audio.addEventListener('volumechange', () => { if (audio.muted || audio.volume === 0) getLevels(); });
// Keep a gesture retry available if an automatic cross-page resume was denied.
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, () => {
  if (wanted && (!mediaSource || audioContext?.state !== 'running')) enableAnalysis(true);
}, {passive: true});
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
const creditTarget = document.querySelector('.detail-footer, #about');
if (creditTarget) {
  const credit = document.createElement('p');
  credit.className = 'music-credit';
  credit.innerHTML = '<span>背景音乐</span><a href="https://soundcloud.com/keysofmoon/new-days-hope-upbeat-electronic-background-music-free-download" target="_blank" rel="noopener noreferrer" title="New Day’s Hope — Keys of Moon (Serjo De Lua)" data-no-translate>New Day’s Hope · Keys of Moon</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" data-no-translate>CC BY 4.0</a><span>循环剪辑与响度调整</span>';
  creditTarget.append(credit);
}
const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
const playIcon = icon('<path d="m9 6.5 8.5 5.5-8.5 5.5Z"/>');
const pauseIcon = icon('<path d="M9 6.5v11M15 6.5v11"/>');
const soundIcon = icon('<path d="M4.5 9h3l4.5-3.5v13L7.5 15h-3Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>');
const silentIcon = icon('<path d="M4.5 9h3l4.5-3.5v13L7.5 15h-3Z"/><path d="m16 9 5 6m0-6-5 6"/>');
let drawnVolume;
function drawVolume() {
  const fraction = entryIntro?.followSlider ? entryIntro.level : 1;
  const value = String(Math.round(volume * fraction * 100));
  if (value === drawnVolume && slider.value === value) return;
  drawnVolume = value;
  slider.value = value;
  slider.style.setProperty('--music-volume', value + '%');
}

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
  drawVolume();
  status.textContent = unavailable ? '音乐暂时无法加载，请稍后重试。' : playing ? '背景音乐正在播放' : '背景音乐已暂停';
  musicShader?.refresh();
}
function remember() {
  try {
    const time = entryIntro && entryIntro.phase !== 'fading' ? 0 : audio.currentTime || resumeTime;
    localStorage.setItem(preferenceKey, JSON.stringify({volume, muted}));
    sessionStorage.setItem(sessionKey, JSON.stringify({playing: wanted, time, tabId, source}));
  } catch { /* Playback does not depend on storage. */ }
}
function claimAudio() {
  try { localStorage.setItem(ownerKey, tabId); } catch {}
}
async function start() {
  if (!playbackAllowed()) return draw();
  const request = ++playbackRequest;
  unavailable = false;
  try {
    if (mediaSource) enableAnalysis();
    await audio.play();
    if (request !== playbackRequest) {
      if (!playbackAllowed()) audio.pause();
      return;
    }
    if (!playbackAllowed()) pausePlayback();
    else { claimAudio(); enableAnalysis(); continueEntryIntro(); }
  } catch (error) {
    if (request !== playbackRequest) return;
    if (error.name === 'NotAllowedError') wanted = false;
    else if (error.name !== 'AbortError') { unavailable = true; wanted = false; }
    if (!wanted) pausePlayback();
  }
  remember();
  draw();
}
// START unlocks the media element silently. Rewind and open the gain only
// when both the starfield reveal and the first playback request are ready.
function enterWithSound() {
  clearEntryIntro();
  cancelAnimationFrame(volumeAnimation);
  entryIntro = {level: 0, phase: 'waiting', frame: 0, followSlider: true};
  wanted = true;
  muted = false;
  volume = 1;
  resumeTime = 0;
  audio.currentTime = 0;
  mediaVolume = targetMediaVolume();
  applyOutputVolume();
  enableAnalysis(true);
  start();
  remember();
  draw();
}
window.addEventListener('portfolio:enter', event => {
  if (event.detail?.userInitiated) enterWithSound();
});
toggle.addEventListener('click', () => {
  wanted = !wanted;
  if (wanted) { enableAnalysis(true); start(); }
  else pausePlayback();
  remember();
  draw();
});
mute.addEventListener('click', () => {
  muted = !muted;
  applyOutputVolume();
  remember();
  draw();
});
function adjustVolume(target) {
  cancelAnimationFrame(volumeAnimation);
  const from = mediaVolume;
  const began = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - began) / 180);
    mediaVolume = from + (target - from) * progress;
    applyOutputVolume();
    if (progress < 1) volumeAnimation = requestAnimationFrame(frame);
  }
  volumeAnimation = requestAnimationFrame(frame);
}
function targetMediaVolume() {
  // Embedded Bilibili playback never changes the visitor's BGM selection.
  // Only audible native videos retain their existing volume ducking behavior.
  const nativeVideoPlaying = [...document.querySelectorAll('video')].some(video => !video.paused && !video.ended && !video.muted && video.volume > 0);
  return volume * (nativeVideoPlaying ? 0.18 : 1);
}
function syncMedia() {
  adjustVolume(targetMediaVolume());
  draw();
}
slider.addEventListener('input', () => {
  // A direct adjustment owns the control for the rest of this fade.
  if (entryIntro) entryIntro.followSlider = false;
  volume = Number(slider.value) / 100;
  if (volume > 0) muted = false;
  applyOutputVolume();
  syncMedia();
  remember();
});
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration) && resumeTime > 0) audio.currentTime = resumeTime % audio.duration;
  resumeTime = 0;
});
audio.addEventListener('seeked', beginEntryFade);
audio.addEventListener('play', draw);
audio.addEventListener('pause', draw);
audio.addEventListener('error', () => { unavailable = true; wanted = false; pausePlayback(); remember(); draw(); });
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
  if (document.hidden) { remember(); pausePlayback(); }
  else if (wanted) start();
});
window.addEventListener('pagehide', () => { pageActive = false; remember(); pausePlayback(); });
window.addEventListener('pageshow', event => { pageActive = true; if (event.persisted && wanted) start(); });
window.addEventListener('storage', event => {
  if (event.key === ownerKey && event.newValue !== tabId && wanted) {
    wanted = false;
    pausePlayback();
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
// A skipped gate can finish before this module arrives; native playback may then
// require another gesture, which the existing header play control provides.
if (window.PortfolioStartGate?.started) enterWithSound();
else if (wanted) start();

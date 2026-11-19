// Original, short oscillator cues. UI audio never changes media playback.
export const UI_AUDIO_CONFIG = Object.freeze({ intervalMs: 90, maxVoices: 3, peakGain: .022 });
const tones = Object.freeze({
  select: { duration: .115, partials: [[880, 1060, .74, 0], [1760, 1880, .26, 0]] },
  close: { duration: .100, partials: [[540, 360, .82, 0], [1080, 720, .18, 0]] },
  copy: { duration: .185, partials: [[1046.5, 1174.7, .65, 0], [1568, 1760, .35, .045]] },
});

// Shared by live playback and OfflineAudioContext checks; no recorded samples.
export function scheduleUiTone(context, destination, kind, level = 1, ended = () => {}) {
  const tone = tones[kind] || tones.select;
  const start = context.currentTime + .003;
  const output = context.createGain();
  output.gain.value = Math.max(0, Math.min(1, level)) * UI_AUDIO_CONFIG.peakGain;
  output.connect(destination);
  const nodes = [];
  let remaining = tone.partials.length, finished = false;
  const finish = () => {
    if (finished || --remaining > 0) return;
    finished = true;
    for (const { oscillator, envelope } of nodes) { oscillator.disconnect(); envelope.disconnect(); }
    output.disconnect(); ended();
  };
  for (const [frequency, finalFrequency, weight, delay] of tone.partials) {
    const oscillator = context.createOscillator(), envelope = context.createGain();
    const at = start + delay, end = start + tone.duration;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(finalFrequency, end);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(weight, at + .004);
    envelope.gain.exponentialRampToValueAtTime(.0001, end - .008);
    envelope.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(envelope); envelope.connect(output);
    oscillator.onended = finish;
    oscillator.start(at); oscillator.stop(end + .005);
    nodes.push({ oscillator, envelope });
  }
  return {
    duration: tone.duration,
    stop(immediate = false) {
      if (finished) return;
      const now = context.currentTime;
      if (immediate) {
        output.gain.cancelScheduledValues(now); output.gain.setValueAtTime(0, now);
        for (const { oscillator } of nodes) { try { oscillator.stop(now); } catch { /* Already ended. */ } }
        remaining = 1; finish(); return;
      }
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + .006);
      for (const { oscillator } of nodes) { try { oscillator.stop(now + .008); } catch { /* Already ended. */ } }
    },
  };
}

function mountUiAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const voices = new Set(), pendingCopies = new Set();
  let context, master, resumePending, audioElement;
  let activePage = !document.hidden, generation = 0, lastActivation = -Infinity;
  const stats = { played: 0, throttled: 0, dropped: 0, maxVoices: 0, events: [] };
  const volume = () => {
    const music = document.getElementById('background-music');
    return music?.muted ? 0 : Math.max(0, Math.min(1, music?.volume ?? .35));
  };
  const clearVoices = (immediate = false) => { for (const voice of voices) voice.stop(immediate); };
  const updateVolume = () => {
    if (!master) return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(volume(), now + .008);
    if (!volume()) clearVoices();
  };
  const observeVolume = () => {
    const next = document.getElementById('background-music');
    if (next === audioElement) return;
    audioElement?.removeEventListener('volumechange', updateVolume);
    audioElement = next;
    audioElement?.addEventListener('volumechange', updateVolume);
  };
  function enable() {
    if (!AudioContext || !activePage || document.hidden || !volume()) return Promise.resolve(false);
    try {
      if (!context) {
        context = new AudioContext({ latencyHint: 'interactive' });
        master = context.createGain(); master.gain.value = volume(); master.connect(context.destination);
      }
      observeVolume(); updateVolume();
      if (context.state === 'running') return Promise.resolve(true);
      if (!resumePending) resumePending = context.resume().then(() => {
        if (!activePage || document.hidden) { context.suspend().catch(() => {}); return false; }
        return context.state === 'running';
      }).catch(() => false).finally(() => { resumePending = null; });
      return resumePending;
    } catch { return Promise.resolve(false); }
  }
  function play(kind, token, requestedAt) {
    if (token !== generation || !activePage || document.hidden || !volume() || context?.state !== 'running' || performance.now() - requestedAt > 250) return;
    if (voices.size >= UI_AUDIO_CONFIG.maxVoices) { stats.dropped++; return; }
    updateVolume();
    try {
      const voice = scheduleUiTone(context, master, kind, 1, () => voices.delete(voice));
      voices.add(voice);
      stats.played++; stats.maxVoices = Math.max(stats.maxVoices, voices.size);
      stats.events.push({ kind, at: performance.now(), volume: volume(), duration: voice.duration });
      if (stats.events.length > 20) stats.events.shift();
    } catch { /* A browser without functioning Web Audio keeps all UI usable. */ }
  }
  function copyConfirmation(control, ready, token) {
    // The existing clipboard handler adds this class only after writeText succeeds.
    // Observe the actual result, not a click that might fail clipboard permission.
    let timer, observer;
    const cancel = () => { clearTimeout(timer); observer.disconnect(); pendingCopies.delete(cancel); };
    observer = new MutationObserver(() => {
      if (!control.classList.contains('is-copied')) return;
      cancel(); const confirmedAt = performance.now();
      ready.then(ok => { if (ok) play('copy', token, confirmedAt); });
    });
    observer.observe(control, { attributes: true, attributeFilter: ['class'] });
    timer = setTimeout(cancel, 1800); pendingCopies.add(cancel);
  }
  document.addEventListener('click', event => {
    if (!event.isTrusted || !activePage || document.hidden || !volume()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],.music-panel,.music-button,#music-volume')) return;
    const control = target.closest('button,a[href],[role="button"]');
    if (!control || control.matches(':disabled,[aria-disabled="true"]') || control.closest('[inert],[hidden]')) return;
    const now = performance.now();
    if (now - lastActivation < UI_AUDIO_CONFIG.intervalMs) { stats.throttled++; return; }
    lastActivation = now;
    const token = generation, ready = enable();
    if (control.matches('[data-copy-value]')) { copyConfirmation(control, ready, token); return; }
    const kind = control.matches('.close-player,.image-viewer-close,[data-ui-audio="close"]') ? 'close' : 'select';
    ready.then(ok => { if (ok) play(kind, token, now); });
  }, { capture: true });
  function suspend() {
    activePage = false; generation++;
    for (const cancel of pendingCopies) cancel();
    clearVoices(true);
    // Silence immediately before suspending, including bfcache entry.
    if (master) { master.gain.cancelScheduledValues(context.currentTime); master.gain.setValueAtTime(0, context.currentTime); }
    if (context && context.state !== 'closed') context.suspend().catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else activePage = true; });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', () => { activePage = !document.hidden; });
  return Object.freeze({
    snapshot: () => ({ ...stats, events: stats.events.map(event => ({ ...event })), available: !!AudioContext,
      initialized: !!context, state: context?.state || 'uninitialized', activeVoices: voices.size,
      volume: volume(), activePage, config: UI_AUDIO_CONFIG }),
  });
}

// Module caching plus this guard also protects bfcache/import-with-query callers.
if (!window.PortfolioUIAudio) window.PortfolioUIAudio = mountUiAudio();

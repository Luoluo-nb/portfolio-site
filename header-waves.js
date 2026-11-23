/**
 * Pulse Waves (uNiversal, 2015), based on Waves Remix (ADOB, 2015).
 * Canvas adaptation. Sources and CC BY-NC-SA 3.0 terms in media/third-party-licenses.txt.
 */
// The gray ramp encodes horizontal position. Its green-channel lookup samples
// the same wave as the canvas, displacing native text vertically by at most 1px.
function createLabelWarp(dock, header) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(namespace, 'defs');
  svg.append(defs);
  dock.append(svg);
  const gradient = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 1" width="256" height="1" preserveAspectRatio="none"><linearGradient id="g"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient><rect width="256" height="1" fill="url(#g)"/></svg>';
  const ramp = 'data:image/svg+xml,' + encodeURIComponent(gradient);
  const labels = new Map();
  let nextId = 0;

  function element(tag, attributes, parent) {
    const node = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    parent.append(node);
    return node;
  }

  function measure(origin, width) {
    for (const control of header.querySelectorAll('.brand-caption, nav a, .language-switch button')) {
      let label = control;
      if (!control.matches('.brand-caption')) {
        label = control.querySelector('.header-wave-text');
        if (!label) {
          const text = Array.from(control.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          if (!text) continue;
          label = document.createElement('span');
          label.className = 'header-wave-text';
          text.before(label);
          label.append(text);
        }
      }
      let item = labels.get(label);
      if (!item) {
        const id = 'header-text-wave-' + nextId++;
        const filter = element('filter', {id, x:'-12%', width:'124%', y:'-20%', height:'140%', 'color-interpolation-filters':'sRGB'}, defs);
        element('feImage', {href:ramp, preserveAspectRatio:'none', result:'position'}, filter);
        const transfer = element('feComponentTransfer', {in:'position', result:'field'}, filter);
        element('feFuncR', {type:'linear', slope:'0', intercept:'.5'}, transfer);
        const lookup = element('feFuncG', {type:'table', tableValues:'.5 .5'}, transfer);
        element('feDisplacementMap', {in:'SourceGraphic', in2:'field', scale:'2', xChannelSelector:'R', yChannelSelector:'G'}, filter);
        item = {filter, lookup, url:'url(#' + id + ')', values:new Float32Array(13), active:false};
        labels.set(label, item);
      }
      const rect = label.getBoundingClientRect();
      item.start = (rect.left - origin.left - rect.width * .12) / width;
      item.span = rect.width * 1.24 / width;
    }
    for (const [label, item] of labels) {
      if (!header.contains(label)) { item.filter.remove(); labels.delete(label); }
    }
  }

  function update(gain, sample, dt) {
    const ease = 1 - Math.exp(-dt / .13);
    for (const [label, item] of labels) {
      if (!item.span || gain === 0) {
        if (item.active) { label.style.removeProperty('filter'); item.values.fill(0); item.active = false; }
        continue;
      }
      const values = item.values;
      for (let i = 0; i < values.length; i++) {
        const u = Math.max(0, Math.min(1, item.start + item.span * i / (values.length - 1)));
        values[i] += (sample(u) * gain - values[i]) * ease;
      }
      // SVG samples the source in reverse: a rising wave needs a positive lookup offset.
      const table = Array.from(values, value => (.5 - .48 * value).toFixed(3)).join(' ');
      if (item.table !== table) { item.lookup.setAttribute('tableValues', table); item.table = table; }
      if (!item.active) { label.style.filter = item.url; item.active = true; }
    }
  }
  return {measure, update};
}

export function mountHeaderWaves(dock, header) {
  const canvas = document.createElement('canvas');
  canvas.className = 'header-waves';
  canvas.setAttribute('aria-hidden', 'true');
  dock.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d');
  const labelWarp = createLabelWarp(dock, header);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const bands = new Float32Array(32);
  const trace = new Float32Array(96);
  const envelope = new Float32Array(5);
  const smoothedTrace = new Float32Array(trace.length);
  const bandEdges = [0, 5, 11, 18, 25, 32];
  const bandWeights = [.22, .45, .85, 1, .75];
  const mainRibbon = {band:2, offset:0, tint:'240 249 255', core:.84, motionSpeed:1, lightSpeed:5.45};
  const ribbons = [
    {band:1, offset:-.038, tint:'167 216 246', core:.56, motionSpeed:.84, lightSpeed:4.7},
    {band:3, offset:.046, tint:'194 230 252', core:.58, motionSpeed:1.13, lightSpeed:6.15},
    mainRibbon
  ];
  const flowPower = 18;
  let width = 0, height = 0, dirty = true, running = false;
  let frame = 0, last = 0, phase = 0;
  let coverage = 0, maskY = 0, readMask = true;
  const maskTransitions = new Set();
  let resting = false;

  // Cache a distance mask in CSS-pixel space. Only layout changes need new pixels.
  function layout() {
    dirty = false;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    const origin = header.getBoundingClientRect();
    labelWarp.measure(origin, width);
    if (!maskCtx) return;
    const step = 3;
    mask.width = Math.ceil(width / step);
    mask.height = Math.ceil(height / step);
    const pixels = maskCtx.createImageData(mask.width, mask.height);
    const feather = width < 720 ? 27 : 52;
    for (const el of header.querySelectorAll('.brand, nav a, .music-controls, .language-switch')) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const left = rect.left - origin.left, top = rect.top - origin.top;
      const halfW = rect.width / 2, halfH = rect.height / 2;
      for (let y = Math.max(0, Math.floor((top - feather - 6) / step)); y < mask.height && y * step < top + rect.height + feather + 6; y++) {
        for (let x = Math.max(0, Math.floor((left - feather - 6) / step)); x < mask.width && x * step < left + rect.width + feather + 6; x++) {
          const dx = Math.max(0, Math.abs((x + .5) * step - left - halfW) - halfW);
          const dy = Math.max(0, Math.abs((y + .5) * step - top - halfH) - halfH);
          const t = Math.max(0, Math.min(1, (Math.hypot(dx, dy) - 5) / feather));
          const alpha = (y * mask.width + x) * 4 + 3;
          pixels.data[alpha] = Math.max(pixels.data[alpha], 255 * (1 - t * t * (3 - 2 * t)));
        }
      }
    }
    maskCtx.putImageData(pixels, 0, 0);
  }

  function flowNoise(x) {
    const cell = Math.floor(x);
    const mix = x - cell;
    const ease = mix * mix * (3 - 2 * mix);
    const a = Math.sin(cell * 127.1 + 41.7) * 43758.5453;
    const b = Math.sin((cell + 1) * 127.1 + 41.7) * 43758.5453;
    return 2 * ((a - Math.floor(a)) * (1 - ease) + (b - Math.floor(b)) * ease) - 1;
  }

  function waveOffset(u, ribbon) {
    const {band, motionSpeed} = ribbon;
    const travel = phase * motionSpeed;
    const traveled = u * Math.PI * 2 - travel;
    const angle = traveled + (band - 2) * .21;
    const noisePosition = u * 8.5 - travel * 1.65 + band * .37;
    const noise = .78 * flowNoise(noisePosition) + .22 * flowNoise(noisePosition * 2.25 + 6);
    const shape = .86 * Math.sin(angle + .2 * noise) + .14 * Math.sin(angle * 2 + .9);
    const pos = u * (trace.length - 1), index = Math.floor(pos);
    const a = smoothedTrace[index], b = smoothedTrace[Math.min(index + 1, trace.length - 1)];
    const signal = Math.tanh(3 * (a + (b - a) * (pos - index)));
    const energy = envelope[band];
    const fineMotion = .015 + envelope[3] * .036 + envelope[4] * .022;
    // Keep bass movement broad and slow, using the already smoothed low bands.
    const bassMotion = (envelope[0] * .13 + envelope[1] * .027) * flowNoise(u * 3.1 - travel * .42 + band * .57);
    return (.055 + energy * .22) * shape + .04 * signal + fineMotion * noise + bassMotion;
  }
  function midWave(u) { return Math.max(-1, Math.min(1, waveOffset(u, mainRibbon) / .23)); }

  function ribbonLight(ribbon, energy) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const isMainRibbon = ribbon === mainRibbon;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const travel = u * 6.8 - phase * ribbon.lightSpeed + ribbon.band * 1.27;
      const pulse = .5 + .5 * Math.cos(travel);
      const crest = Math.pow(pulse, flowPower);
      const shoulder = Math.pow(pulse, 4) * (isMainRibbon ? .20 : .12);
      const base = isMainRibbon ? .16 : .085;
      const alpha = base + energy * .14 + shoulder + crest * (isMainRibbon ? .57 : .42);
      gradient.addColorStop(u, `rgb(${ribbon.tint} / ${alpha})`);
    }
    return gradient;
  }

  function paint(now) {
    const changed = dirty;
    if (dirty) layout();
    if (!width || !height) return;
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;
    bands.fill(0);
    trace.fill(0);
    if (!motion.matches) {
      window.PortfolioAudioAnalysis?.readSpectrum?.(bands, trace);
      window.PortfolioUIAudio?.mixSpectrum?.(bands);
    } else {
      envelope.fill(0);
      smoothedTrace.fill(0);
    }
    const attack = 1 - Math.exp(-dt / .085), release = 1 - Math.exp(-dt / .23);
    let peak = 0;
    for (let i = 0; i < envelope.length; i++) {
      let level = 0;
      for (let b = bandEdges[i]; b < bandEdges[i + 1]; b++) level += bands[b];
      level *= bandWeights[i] / (bandEdges[i + 1] - bandEdges[i]);
      envelope[i] += (level - envelope[i]) * (level > envelope[i] ? attack : release);
      peak = Math.max(peak, envelope[i]);
    }
    const target = header.inert ? 0 : 1;
    const quiet = peak < .001;
    let maskChanged = false;
    if (changed || readMask || maskTransitions.size) {
      // Follow the actual CSS transition, including a hover that reverses it midway.
      const style = getComputedStyle(header);
      const opacity = Number(style.opacity);
      const y = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42;
      maskChanged = opacity !== coverage || (opacity > 0 && y !== maskY);
      coverage = opacity;
      maskY = y;
      readMask = false;
    }
    if (quiet && resting && !maskChanged && !changed) return;
    resting = quiet;
    if (!quiet) phase += dt * (.52 + peak * 1.6);
    const traceEase = 1 - Math.exp(-dt / .16);
    for (let i = 0; i < trace.length; i++) {
      const filtered = (trace[Math.max(0, i - 1)] + 2 * trace[i] + trace[Math.min(trace.length - 1, i + 1)]) * .25;
      smoothedTrace[i] += (filtered - smoothedTrace[i]) * traceEase;
    }
    labelWarp.update(target && !quiet ? Math.min(1, peak * 1.2) : 0, midWave, dt);

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    const steps = Math.max(64, Math.min(180, Math.ceil(width / 10)));
    for (const ribbon of ribbons) {
      const energy = envelope[ribbon.band];
      const path = new Path2D();
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const y = height * (.47 + ribbon.offset + waveOffset(u, ribbon));
        if (i === 0) path.moveTo(0, y);
        else path.lineTo(u * width, y);
      }
      ctx.strokeStyle = ribbonLight(ribbon, energy);
      ctx.globalAlpha = .09 + energy * .10;
      ctx.lineWidth = 4;
      ctx.stroke(path);
      ctx.globalAlpha = .20 + energy * .14;
      ctx.lineWidth = 2.2;
      ctx.stroke(path);
      ctx.globalAlpha = 1;
      ctx.lineWidth = ribbon.core;
      ctx.stroke(path);
    }
    if (maskCtx && coverage > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = coverage;
      ctx.drawImage(mask, 0, maskY, width, height);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (now - last >= 32 || dirty || readMask) paint(now);
    if (!motion.matches) frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    if (running && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function invalidate() { dirty = true; sync(); }
  const resize = window.ResizeObserver && new ResizeObserver(invalidate);
  function observeControls() {
    resize?.disconnect();
    for (const el of [canvas, header, ...header.querySelectorAll('.brand, nav, .header-tools, .music-controls, .language-switch')]) resize?.observe(el);
    invalidate();
  }
  observeControls();
  new MutationObserver(changes => {
    if (changes.some(change => change.target === header || change.target.matches?.('.header-tools'))) observeControls();
  }).observe(header, {childList:true, subtree:true});
  window.addEventListener('resize', invalidate);
  window.addEventListener('portfolio:languagechange', invalidate);
  document.fonts?.ready.then(invalidate);
  motion.addEventListener('change', invalidate);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => cancelAnimationFrame(frame));
  function refreshMask() { readMask = true; sync(); }
  function onRevealTransition(event) {
    if (event.target !== header || !['opacity', 'transform'].includes(event.propertyName)) return;
    if (event.type === 'transitionrun') maskTransitions.add(event.propertyName);
    else maskTransitions.delete(event.propertyName);
    refreshMask();
  }
  for (const event of ['transitionrun', 'transitionend', 'transitioncancel']) {
    header.addEventListener(event, onRevealTransition);
  }
  window.addEventListener('pageshow', () => { readMask = true; invalidate(); });
  new MutationObserver(refreshMask).observe(header, {attributes:true, attributeFilter:['inert']});
  function start() { running = true; dock.classList.add('waves-ready'); invalidate(); }
  if (window.PortfolioStartGate?.active) window.addEventListener('portfolio:enter', start, {once:true});
  else start();
}

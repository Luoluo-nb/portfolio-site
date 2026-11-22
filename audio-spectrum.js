// Map each source's FFT bins to the same display frequencies before combining levels.
export function createSpectrumMixer(sampleRate, fftSize) {
  const binCount = fftSize / 2;
  const binHz = sampleRate / fftSize;
  const highHz = Math.min(14000, sampleRate / 2);
  let boundaries = new Uint16Array(0);

  return function mixSpectrum(frequencies, bands) {
    if (boundaries.length !== bands.length + 1) {
      boundaries = new Uint16Array(bands.length + 1);
      for (let i = 0; i <= bands.length; i++) {
        const hz = 540 * Math.pow((highHz + 500) / 540, i / bands.length) - 500;
        boundaries[i] = Math.min(binCount, Math.max(1, Math.round(hz / binHz)));
      }
    }
    for (let i = 0; i < bands.length; i++) {
      const first = Math.min(boundaries[i], binCount - 1);
      const end = Math.max(first + 1, boundaries[i + 1]);
      let energy = 0;
      for (let bin = first; bin < end; bin++) {
        const level = Math.max(0, Math.min(1, (frequencies[bin] + 80) / 65));
        energy += level * level;
      }
      bands[i] = Math.min(1, Math.sqrt(bands[i] * bands[i] + energy / (end - first)));
    }
  };
}

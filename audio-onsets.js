// Percussive novelty in linear amplitude, not the analyser's display dB scale.
// The quiet floor is referenced to the soundtrack at its default 35% volume.
export const PERCUSSION_SETTINGS = Object.freeze({
  bodyHz: [180, 350], noiseHz: [1200, 6000], hatHz: [6000, 12000], kickHz: [35, 150],
  warmupSeconds: .30, refractorySeconds: .24, kickRefractorySeconds: .24,
  beatRefractorySeconds: .18, holdSeconds: .045, attackSeconds: .010,
  releaseSeconds: .13, adaptiveSeconds: 2.4, speedGain: 16,
  minimumConfidence: .42,
  rmsFloor: .018, snareEnergyFloor: .00018, snareFluxFloor: .00007,
  kickEnergyFloor: .0042, kickFluxFloor: .00115,
});

const clamp = value => Math.max(0, Math.min(1, value));
export function createPercussionDetector() {
  let previous, primed = false, began = 0, lastSnare = -1e9, lastKick = -1e9, lastBeat = -1e9;
  let noiseMean = 0, noiseDev = 0, kickMean = 0, kickDev = 0;
  let heldSnare = 0, heldKick = 0, heldBeat = 0;
  const output = {snare:0, snareLag:0, snareConfidence:0, snareCount:0, onsetTime:0,
    kick:0, kickLag:0, kickConfidence:0, kickCount:0, beat:0, beatLag:0, beatCount:0,
    beatTime:0, speed:0, snareBodyFlux:0, snareNoiseFlux:0, kickFlux:0, kickThreshold:0,
    signalRms:0, snareEnergy:0, kickEnergy:0};
  function reset() {
    primed = false; heldSnare = heldKick = heldBeat = 0;
    lastSnare = lastKick = lastBeat = -1e9;
    for (const key of ['snare','snareLag','snareConfidence','kick','kickLag','kickConfidence',
      'beat','beatLag','speed','snareBodyFlux','snareNoiseFlux','kickFlux','kickThreshold','signalRms','snareEnergy','kickEnergy']) output[key] = 0;
    return {...output};
  }
  function update(spectrum, rms, now, seconds, binHz, volume) {
    const settings = PERCUSSION_SETTINGS;
    if (!previous || previous.length !== spectrum.length) { previous = new Float32Array(spectrum.length); primed = false; }
    const gain = Math.max(.02, volume) / .35;
    const bands = [settings.bodyHz,settings.noiseHz,settings.hatHz,settings.kickHz]
      .map(([low,high])=>({low,high,energy:0,flux:0,count:0}));
    for (let bin=1;bin<spectrum.length;bin++) {
      const current = Math.pow(10, spectrum[bin]/20) / gain;
      const rise = Math.max(0, current - previous[bin]), hz=bin*binHz;
      for (const band of bands) if (hz>=band.low && hz<=band.high) {
        band.energy += current*current; band.flux += rise*rise; band.count++;
      }
      previous[bin] = current;
    }
    for (const band of bands) {
      band.energy = Math.sqrt(band.energy / Math.max(1,band.count));
      band.flux = Math.sqrt(band.flux / Math.max(1,band.count));
    }
    const [body,noise,hat,kick] = bands, signalRms = rms/gain;
    let snareConfidence=0,kickConfidence=0;
    const noiseThreshold = Math.max(settings.snareFluxFloor, noiseMean*1.7+noiseDev*1.4);
    const kickThreshold = Math.max(settings.kickFluxFloor, kickMean*1.8+kickDev*1.3);
    const ready = primed && now-began>settings.warmupSeconds*1000;
    // A held note or a loud pad is not an onset: require a substantial fresh
    // band attack, absolute energy and a percussion-specific spectral balance.
    if (ready && signalRms>settings.rmsFloor) {
      if (noise.energy>settings.snareEnergyFloor && noise.flux>noiseThreshold
          && noise.flux/noise.energy>.30 && body.energy>.00075
          && noise.energy>hat.energy*1.3) {
        const energy=clamp((noise.energy-settings.snareEnergyFloor)/.00017);
        const attack=clamp((noise.flux/noiseThreshold-1)/1.4);
        snareConfidence=Math.sqrt(energy*attack);
      }
      if (kick.energy>settings.kickEnergyFloor && kick.flux>kickThreshold
          && kick.flux/kick.energy>.28) {
        const energy=clamp((kick.energy-settings.kickEnergyFloor)/.0030);
        const attack=clamp((kick.flux/kickThreshold-1)/1.1);
        kickConfidence=Math.sqrt(energy*attack);
      }
    }
    let accepted=0;
    if (snareConfidence>settings.minimumConfidence && now-lastSnare>settings.refractorySeconds*1000) {
      lastSnare=now; heldSnare=snareConfidence; output.snareCount++; output.onsetTime=now/1000;
      accepted=snareConfidence;
    } else if (now-lastSnare<55 && snareConfidence>heldSnare) {
      heldSnare=snareConfidence; accepted=snareConfidence;
    }
    if (kickConfidence>settings.minimumConfidence && now-lastKick>settings.kickRefractorySeconds*1000) {
      lastKick=now; heldKick=kickConfidence; output.kickCount++;
      accepted=Math.max(accepted,kickConfidence);
    } else if (now-lastKick<55 && kickConfidence>heldKick) {
      heldKick=kickConfidence; accepted=Math.max(accepted,kickConfidence);
    }
    if (accepted && now-lastBeat>settings.beatRefractorySeconds*1000) {
      lastBeat=now; output.beatCount++; output.beatTime=now/1000;
      // No minimum pulse: weak accepted hits stay weak instead of becoming
      // half-strength surges. The exponent emphasizes clear drum transients.
      heldBeat=Math.pow(accepted,1.45);
    } else if (accepted && now-lastBeat<55) {
      heldBeat=Math.max(heldBeat,Math.pow(accepted,1.45));
    }
    if (!primed) { began=now; primed=true; noiseMean=noiseDev=kickMean=kickDev=0; }
    else {
      const adapt=1-Math.exp(-seconds/settings.adaptiveSeconds);
      noiseDev+=(Math.abs(noise.flux-noiseMean)-noiseDev)*adapt;
      kickDev+=(Math.abs(kick.flux-kickMean)-kickDev)*adapt;
      noiseMean+=(noise.flux-noiseMean)*adapt;
      kickMean+=(kick.flux-kickMean)*adapt;
    }
    const audibleGain=Math.min(1,Math.sqrt(volume/.35));
    output.snare=now-lastSnare<settings.holdSeconds*1000?heldSnare*audibleGain:0;
    output.kick=now-lastKick<settings.holdSeconds*1000?heldKick*audibleGain:0;
    output.beat=now-lastBeat<settings.holdSeconds*1000?heldBeat*audibleGain:0;
    for (const band of ['snare','kick','beat']) {
      const lag=band+'Lag',tau=output[band]>output[lag]?settings.attackSeconds:settings.releaseSeconds;
      output[lag]+=(output[band]-output[lag])*(1-Math.exp(-seconds/tau));
      if (output[lag]<.0001) output[lag]=0;
    }
    Object.assign(output,{snareConfidence,kickConfidence,signalRms,snareEnergy:noise.energy,
      kickEnergy:kick.energy,snareBodyFlux:body.flux,snareNoiseFlux:noise.flux,kickFlux:kick.flux,
      kickThreshold,speed:output.beatLag*settings.speedGain});
    return {...output};
  }
  return {update,reset};
}

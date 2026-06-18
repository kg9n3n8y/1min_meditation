export function createGuideAudio() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const SOUND_PRESETS = {
    inhale: {
      baseFrequency: 760,
      partials: [0.5, 1, 2.4, 3.35, 4.5],
      partialGains: [0.88, 1, 0.46, 0.32, 0.2],
      partialDelays: [0, 0, 0, 0, 0],
      duration: 4.1,
      attack: 0.02,
      release: 3.4,
      gain: 0.63,
      filter: { type: 'bandpass', frequency: 1100, Q: 9.5 },
      detuneSpread: 1.0,
      strike: { duration: 0.16, gain: 0.38, frequency: 2100, Q: 4.5, type: 'bandpass' },
      modulation: { frequency: 0.3, depth: 0.06, delay: 0.6, type: 'sine' },
    },
    hold: {
      baseFrequency: 560,
      partials: [0.5, 1, 2.15, 2.92, 4.1],
      partialGains: [0.86, 1, 0.44, 0.3, 0.18],
      partialDelays: [0, 0, 0, 0, 0],
      duration: 3.9,
      attack: 0.024,
      release: 3.2,
      gain: 0.58,
      filter: { type: 'bandpass', frequency: 850, Q: 8.8 },
      detuneSpread: 0.7,
      strike: { duration: 0.15, gain: 0.32, frequency: 1750, Q: 3.8, type: 'bandpass' },
      modulation: { frequency: 0.26, depth: 0.06, delay: 0.8, type: 'sine' },
    },
    exhale: {
      baseFrequency: 420,
      partials: [0.5, 1, 2.05, 2.78, 3.95, 5.3],
      partialGains: [0.84, 1, 0.5, 0.32, 0.2, 0.12],
      partialDelays: [0, 0, 0, 0, 0, 0],
      duration: 5.0,
      attack: 0.022,
      release: 4.4,
      gain: 0.68,
      filter: { type: 'bandpass', frequency: 720, Q: 9.2 },
      detuneSpread: 0.9,
      strike: { duration: 0.18, gain: 0.34, frequency: 1600, Q: 4.2, type: 'bandpass' },
      modulation: { frequency: 0.24, depth: 0.08, delay: 0.9, type: 'sine' },
    },
    end: {
      baseFrequency: 470,
      partials: [1, 1.95, 2.4, 3.2],
      partialGains: [1, 0.52, 0.28, 0.16],
      partialDelays: [0, 0, 0.03, 0.05],
      duration: 1.25,
      attack: 0.005,
      release: 0.55,
      gain: 0.9,
      filter: { type: 'bandpass', frequency: 710, Q: 6.4 },
      detuneSpread: 0.08,
      strike: { duration: 0.08, gain: 0.62, frequency: 1280, Q: 2.8, type: 'bandpass' },
      modulation: { frequency: 0.12, depth: 0.04, delay: 0.12, type: 'sine' },
    },
    countdown: {
      baseFrequency: 680,
      partials: [0.5, 1, 2.2, 3.05],
      partialGains: [0.8, 1, 0.46, 0.28],
      partialDelays: [0, 0, 0, 0],
      duration: 2.6,
      attack: 0.018,
      release: 2.0,
      gain: 0.52,
      filter: { type: 'bandpass', frequency: 900, Q: 8.5 },
      detuneSpread: 0.7,
      strike: { duration: 0.14, gain: 0.3, frequency: 1750, Q: 3.6, type: 'bandpass' },
      modulation: { frequency: 0.3, depth: 0.06, delay: 0.6, type: 'sine' },
    },
  };

  let context = null;
  let masterGain = null;
  let isMuted = false;
  let unlocked = false;

  function ensureMasterGain(ctx) {
    if (!masterGain) {
      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(isMuted ? 0 : 1, ctx.currentTime);
      masterGain.connect(ctx.destination);
    }
    return masterGain;
  }

  function ensureContext() {
    if (!AudioContextCtor) {
      return Promise.reject(new Error('Web Audio API is not available.'));
    }
    if (context && context.state === 'closed') {
      context = null;
      masterGain = null;
    }
    if (!context) {
      try {
        context = new AudioContextCtor();
      } catch (error) {
        return Promise.reject(error);
      }
      ensureMasterGain(context);
    }
    if (context.state === 'running') {
      unlocked = true;
      return Promise.resolve(context);
    }
    return context.resume().then(() => {
      unlocked = context.state === 'running';
      return context;
    }).catch(() => context);
  }

  function scheduleTone(ctx, preset) {
    if (!preset) return false;
    const now = ctx.currentTime;
    ensureMasterGain(ctx);

    const attack = Math.max(0.003, Number.isFinite(preset.attack) ? preset.attack : 0.01);
    const release = Math.max(0.08, Number.isFinite(preset.release) ? preset.release : 0.4);
    const duration = Math.max(attack + release, Number.isFinite(preset.duration) ? preset.duration : 1.2);
    const peakGain = Math.min(1, Math.max(0.05, Number.isFinite(preset.gain) ? preset.gain : 0.6));

    const envelopeGain = ctx.createGain();
    const cleanupCallbacks = [];
    envelopeGain.gain.cancelScheduledValues(now);
    envelopeGain.gain.setValueAtTime(0.0001, now);
    envelopeGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    envelopeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    cleanupCallbacks.push(() => {
      try { envelopeGain.disconnect(); } catch (_) {}
    });

    let destinationNode = masterGain;
    let filterNode = null;
    if (preset.filter && typeof preset.filter === 'object') {
      filterNode = ctx.createBiquadFilter();
      filterNode.type = preset.filter.type || 'bandpass';
      const filterFreq = Number.isFinite(preset.filter.frequency)
        ? preset.filter.frequency
        : (Number.isFinite(preset.baseFrequency) ? preset.baseFrequency * 2 : 1200);
      filterNode.frequency.setValueAtTime(filterFreq, now);
      if (Number.isFinite(preset.filter.Q)) {
        filterNode.Q.setValueAtTime(preset.filter.Q, now);
      }
      if (Number.isFinite(preset.filter.gain)) {
        filterNode.gain.setValueAtTime(preset.filter.gain, now);
      }
      destinationNode = filterNode;
      cleanupCallbacks.push(() => {
        try { filterNode.disconnect(); } catch (_) {}
      });
    }

    if (preset.modulation && typeof preset.modulation === 'object') {
      const modulationConfig = preset.modulation;
      const modulationGain = ctx.createGain();
      modulationGain.gain.setValueAtTime(1, now);
      const depthGain = ctx.createGain();
      const modulationDepth = Math.max(0, Math.min(0.8, Number.isFinite(modulationConfig.depth) ? modulationConfig.depth : 0.25));
      depthGain.gain.setValueAtTime(modulationDepth, now);
      const lfo = ctx.createOscillator();
      lfo.type = modulationConfig.type || 'sine';
      const modulationFrequency = Math.max(0.05, Number.isFinite(modulationConfig.frequency) ? modulationConfig.frequency : 0.6);
      lfo.frequency.setValueAtTime(modulationFrequency, now);
      const modulationDelay = Math.max(0, Number.isFinite(modulationConfig.delay) ? modulationConfig.delay : 0);
      const modulationStopTime = now + duration + 1.2;

      depthGain.connect(modulationGain.gain);
      lfo.connect(depthGain);
      envelopeGain.connect(modulationGain);
      modulationGain.connect(destinationNode);

      const modulationStartTime = now + modulationDelay;
      lfo.start(modulationStartTime);
      lfo.stop(modulationStopTime);

      lfo.addEventListener('ended', () => {
        try { lfo.disconnect(); } catch (_) {}
        try { depthGain.disconnect(); } catch (_) {}
      });
      cleanupCallbacks.push(() => {
        try { modulationGain.disconnect(); } catch (_) {}
      });
    } else {
      envelopeGain.connect(destinationNode);
    }

    if (filterNode) {
      filterNode.connect(masterGain);
    }

    const partials = Array.isArray(preset.partials) && preset.partials.length
      ? preset.partials
      : [1];
    const baseFrequency = Number.isFinite(preset.baseFrequency)
      ? preset.baseFrequency
      : (Number.isFinite(preset.frequency) ? preset.frequency : 660);
    const partialGains = Array.isArray(preset.partialGains) ? preset.partialGains : [];
    const partialDelays = Array.isArray(preset.partialDelays) ? preset.partialDelays : [];
    const detuneSpread = Number.isFinite(preset.detuneSpread) ? preset.detuneSpread : 0;

    let strikeDuration = 0;
    if (preset.strike && typeof preset.strike === 'object') {
      const strikeConfig = preset.strike;
      const strikeGain = ctx.createGain();
      const strikeFilter = ctx.createBiquadFilter();
      strikeFilter.type = strikeConfig.type || 'highpass';
      const strikeFreq = Number.isFinite(strikeConfig.frequency) ? strikeConfig.frequency : 2000;
      strikeFilter.frequency.setValueAtTime(strikeFreq, now);
      if (Number.isFinite(strikeConfig.Q)) {
        strikeFilter.Q.setValueAtTime(strikeConfig.Q, now);
      }
      strikeGain.gain.setValueAtTime(0.0001, now);
      const strikePeakGain = Math.max(0.05, Math.min(1, Number.isFinite(strikeConfig.gain) ? strikeConfig.gain : 0.8));
      const resolvedStrikeDuration = Math.max(0.05, Number.isFinite(strikeConfig.duration) ? strikeConfig.duration : 0.1);
      strikeDuration = resolvedStrikeDuration;
      strikeGain.gain.linearRampToValueAtTime(strikePeakGain, now + 0.005);
      strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + resolvedStrikeDuration);

      const channelLength = Math.max(1, Math.ceil(ctx.sampleRate * resolvedStrikeDuration));
      const noiseBuffer = ctx.createBuffer(1, channelLength, ctx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < channelLength; i += 1) {
        noiseData[i] = (Math.random() * 2) - 1;
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = false;

      noiseSource.connect(strikeFilter);
      strikeFilter.connect(strikeGain);
      const strikeTarget = filterNode || masterGain;
      strikeGain.connect(strikeTarget);

      noiseSource.start(now);
      noiseSource.stop(now + resolvedStrikeDuration + 0.05);

      noiseSource.addEventListener('ended', () => {
        try { noiseSource.disconnect(); } catch (_) {}
        try { strikeFilter.disconnect(); } catch (_) {}
        try { strikeGain.disconnect(); } catch (_) {}
      });
    }

    const cleanupDelayMs = Math.ceil((duration + strikeDuration + 1.2) * 1000);

    partials.forEach((multiplier, index) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      const delay = Number.isFinite(partialDelays[index]) ? Math.max(0, partialDelays[index]) : 0;
      const startTime = now + delay;
      const partialDuration = Math.max(0.4, duration - delay);
      const detune = detuneSpread
        ? detuneSpread * (index - ((partials.length - 1) / 2))
        : 0;

      const partialGainValue = Math.max(
        0.0001,
        Number.isFinite(partialGains[index])
          ? partialGains[index]
          : (1 / Math.pow(index + 1.1, 1.35))
      );

      osc.type = preset.oscillatorType || 'sine';
      osc.frequency.setValueAtTime(baseFrequency * multiplier, startTime);
      if (detune) {
        osc.detune.setValueAtTime(detune, startTime);
      }

      oscGain.gain.setValueAtTime(partialGainValue, startTime);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, startTime + partialDuration);

      osc.connect(oscGain);
      oscGain.connect(envelopeGain);

      osc.start(startTime);
      osc.stop(startTime + partialDuration + 0.1);

      osc.addEventListener('ended', () => {
        try { osc.disconnect(); } catch (_) {}
        try { oscGain.disconnect(); } catch (_) {}
      });
    });

    const timerHost = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
      ? window
      : globalThis;
    timerHost.setTimeout(() => {
      cleanupCallbacks.forEach((callback) => {
        try { callback(); } catch (_) {}
      });
    }, cleanupDelayMs);

    return true;
  }

  function playGuide(kind) {
    if (isMuted) return Promise.resolve(false);
    const preset = SOUND_PRESETS[kind];
    if (!preset) return Promise.resolve(false);

    return ensureContext().then((ctx) => {
      if (!ctx) return false;
      const needsResume = ctx.state === 'suspended' || ctx.state === 'interrupted';
      const ensureRunning = needsResume
        ? ctx.resume().catch(() => ctx)
        : Promise.resolve(ctx);
      return ensureRunning.then((activeCtx) => {
        if (!activeCtx || activeCtx.state !== 'running') {
          return false;
        }
        const played = scheduleTone(activeCtx, preset);
        if (played) {
          unlocked = true;
        }
        return played;
      });
    }).catch((error) => {
      console.warn('Audio play failed:', error);
      return false;
    });
  }

  function setMuted(value) {
    isMuted = Boolean(value);
    if (masterGain && context && context.state !== 'closed') {
      const targetGain = isMuted ? 0 : 1;
      masterGain.gain.setTargetAtTime(targetGain, context.currentTime, 0.02);
    }
    return isMuted;
  }

  function refreshOutput() {
    if (!context) {
      return ensureContext();
    }
    const oldContext = context;
    context = null;
    masterGain = null;
    unlocked = false;
    return oldContext.close().catch(() => null).then(() => ensureContext()).catch(() => null);
  }

  function resumeIfNeeded() {
    if (!context) {
      return ensureContext().catch(() => null);
    }
    if (context.state === 'running') {
      unlocked = true;
      return Promise.resolve(context);
    }
    return context.resume().then(() => {
      unlocked = context.state === 'running';
      return context;
    }).catch(() => context);
  }

  function poke() {
    return ensureContext().then((ctx) => {
      if (!ctx) return false;
      ensureMasterGain(ctx);
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const now = ctx.currentTime;

      gainNode.gain.setValueAtTime(0, now);

      oscillator.frequency.setValueAtTime(440, now);
      oscillator.connect(gainNode);
      gainNode.connect(masterGain);

      oscillator.start(now);
      oscillator.stop(now + 0.05);

      return new Promise((resolve) => {
        oscillator.addEventListener('ended', () => {
          try { oscillator.disconnect(); } catch (_) {}
          try { gainNode.disconnect(); } catch (_) {}
          unlocked = unlocked || ctx.state === 'running';
          resolve(ctx.state === 'running');
        });
      });
    }).catch(() => false);
  }

  return {
    ensureContext,
    playGuide,
    setMuted,
    refreshOutput,
    resumeIfNeeded,
    poke,
  };
}

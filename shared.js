(function (factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Maru = api;
})(function () {
  function clampInt(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  function defaultSettings() {
    return {
      frameW: 48,
      frameH: 48,
      scale: 2,
      speed: 72,
      floorGap: 12,
      sideMargin: 18,
      powerSave: false,
      petEnabled: false,
      xRatio: 0.18,
      facing: 1,
      displayId: null,
      clips: {
        idle: { start: 0, count: 6, fps: 6 },
        walk: { start: 6, count: 6, fps: 10 },
        sit: { start: 12, count: 6, fps: 6 }
      }
    };
  }

  function clampClip(clip, total, required) {
    const c = clip || {};
    const fps = clampInt(c.fps, 1, 24, 6);
    if (total <= 0) return { start: 0, count: required ? 1 : 0, fps };
    let start = clampInt(c.start, 0, total - 1, 0);
    let count = clampInt(c.count, 0, total, required ? 1 : 0);
    if (required && count < 1) count = 1;
    if (start + count > total) count = total - start;
    if (required && count < 1) {
      start = 0;
      count = Math.min(total, 1);
    }
    return { start, count, fps };
  }

  function cleanDisplayId(value) {
    if (value == null || value === '' || value === 'primary') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clampSettings(input, totalFrames) {
    const d = defaultSettings();
    const src = input || {};
    const clips = src.clips || {};
    const total = Math.max(0, totalFrames | 0);
    const facing = src.facing === -1 || src.facing === '-1' ? -1 : 1;
    const ratio = Number(src.xRatio);
    return {
      frameW: clampInt(src.frameW, 8, 512, d.frameW),
      frameH: clampInt(src.frameH, 8, 512, d.frameH),
      scale: clampInt(src.scale, 1, 8, d.scale),
      speed: clampInt(src.speed, 10, 240, d.speed),
      floorGap: clampInt(src.floorGap, 0, 240, d.floorGap),
      sideMargin: clampInt(src.sideMargin, 0, 480, d.sideMargin),
      powerSave: !!src.powerSave,
      petEnabled: !!src.petEnabled,
      xRatio: Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : d.xRatio)),
      facing: facing,
      displayId: cleanDisplayId(src.displayId),
      clips: {
        idle: clampClip(clips.idle, total, true),
        walk: clampClip(clips.walk, total, true),
        sit: clampClip(clips.sit, total, false)
      }
    };
  }

  function sheetLayout(imgW, imgH, frameW, frameH) {
    const fw = Math.max(1, frameW | 0);
    const fh = Math.max(1, frameH | 0);
    const w = imgW | 0;
    const h = imgH | 0;
    if (w < fw || h < fh) return { cols: 0, rows: 0, total: 0 };
    const cols = Math.floor(w / fw);
    const rows = Math.floor(h / fh);
    return { cols: cols, rows: rows, total: cols * rows };
  }

  function frameIndex(clip, elapsedMs, fpsCap) {
    if (!clip || clip.count <= 0) return clip ? clip.start | 0 : 0;
    const cap = fpsCap == null ? clip.fps : fpsCap;
    const fps = Math.max(1, Math.min(clip.fps | 0 || 1, cap | 0 || clip.fps));
    const i = Math.floor(Math.max(0, elapsedMs) / (1000 / fps)) % clip.count;
    return (clip.start | 0) + i;
  }

  function nextBehavior(current, hasSit) {
    if (current !== 'walk') return 'walk';
    if (hasSit && Math.random() < 0.38) return 'sit';
    return 'idle';
  }

  function behaviorDuration(state) {
    if (state === 'walk') return 2800 + Math.random() * 3400;
    if (state === 'sit') return 2200 + Math.random() * 2800;
    return 900 + Math.random() * 1600;
  }

  function createWalker(settings, totalFrames) {
    let total = Math.max(0, totalFrames | 0);
    let s = clampSettings(settings, total);
    let state = 'walk';
    let facing = s.facing;
    let xRatio = s.xRatio;
    let stateLeft = behaviorDuration('walk');
    let anim = 0;
    let bobT = 0;

    function clipName() {
      if (state === 'sit' && s.clips.sit.count > 0) return 'sit';
      if (state === 'walk' && s.clips.walk.count > 0) return 'walk';
      if (s.clips.idle.count > 0) return 'idle';
      return 'walk';
    }

    return {
      configure(next, nextTotal, place) {
        total = Math.max(0, nextTotal | 0);
        s = clampSettings(next, total);
        if (place) {
          xRatio = s.xRatio;
          facing = s.facing;
        }
      },
      place(ratio, face) {
        const n = Number(ratio);
        if (Number.isFinite(n)) xRatio = Math.max(0, Math.min(1, n));
        if (face === 1 || face === -1) facing = face;
      },
      exportState() {
        return { xRatio: xRatio, facing: facing };
      },
      tick(dt, walkable) {
        const step = Math.max(0, Math.min(120, Number(dt) || 0));
        if (state === 'sit' && s.clips.sit.count <= 0) {
          state = 'idle';
          stateLeft = behaviorDuration('idle');
          anim = 0;
        }
        stateLeft -= step;
        if (stateLeft <= 0) {
          state = nextBehavior(state, s.clips.sit.count > 0);
          stateLeft = behaviorDuration(state);
          anim = 0;
        }
        if (state === 'walk' && walkable > 0) {
          xRatio += (facing * s.speed * step) / 1000 / walkable;
          if (xRatio >= 1) {
            xRatio = 1;
            facing = -1;
            anim = 0;
          } else if (xRatio <= 0) {
            xRatio = 0;
            facing = 1;
            anim = 0;
          }
        }
        anim += step;
        bobT += step;
        const name = clipName();
        const clip = s.clips[name] && s.clips[name].count > 0 ? s.clips[name] : s.clips.idle;
        let frame = frameIndex(clip, anim, s.powerSave ? 8 : 24);
        if (total > 0) frame = Math.max(0, Math.min(total - 1, frame));
        const bob = name === 'walk' ? Math.round(Math.sin(bobT / 150) * 2) : 0;
        return { xRatio: xRatio, facing: facing, state: name, frame: frame, bob: bob };
      }
    };
  }

  return {
    defaultSettings: defaultSettings,
    clampSettings: clampSettings,
    sheetLayout: sheetLayout,
    frameIndex: frameIndex,
    nextBehavior: nextBehavior,
    behaviorDuration: behaviorDuration,
    createWalker: createWalker
  };
});

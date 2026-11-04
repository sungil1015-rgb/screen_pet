const $ = (id) => document.getElementById(id);

let settings = Maru.defaultSettings();
let sheet = { dataUrl: '', width: 0, height: 0 };
let cols = 1;
let rows = 1;
let total = 0;
let applying = false;
let saveTimer = null;
let demoTimer = null;
let demoLast = 0;
let demoOn = true;

const sim = {
  x: 24,
  y: 24,
  facing: 1,
  state: 'walk',
  stateLeft: 2400,
  anim: 0,
  platform: 0,
  jump: null,
  dragging: false,
  dragMoved: false,
  grabX: 0,
  grabY: 0,
  lastClick: 0
};

const stage = $('stage');
const actor = $('actor');

function setStatus(text) {
  $('status').textContent = text;
}

function num(id, fallback) {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function clipRaw(name) {
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    start: num(name + 'Start', settings.clips[name].start),
    count: num(name + 'Count', settings.clips[name].count),
    fps: num(name + 'Fps', settings.clips[name].fps)
  };
}

function readFormRaw() {
  return {
    frameW: num('frameW', settings.frameW),
    frameH: num('frameH', settings.frameH),
    scale: num('scale', settings.scale),
    speed: num('speed', settings.speed),
    floorGap: num('floorGap', settings.floorGap),
    sideMargin: num('sideMargin', settings.sideMargin),
    powerSave: $('powerSave').checked,
    petEnabled: settings.petEnabled,
    xRatio: settings.xRatio,
    facing: sim.facing || settings.facing,
    displayId: $('display').value === '' ? null : Number($('display').value),
    clips: {
      idle: clipRaw('idle'),
      walk: clipRaw('walk'),
      sit: clipRaw('sit')
    }
  };
}

function fillForm() {
  applying = true;
  $('frameW').value = settings.frameW;
  $('frameH').value = settings.frameH;
  $('scale').value = settings.scale;
  $('speed').value = settings.speed;
  $('floorGap').value = settings.floorGap;
  $('sideMargin').value = settings.sideMargin;
  $('powerSave').checked = !!settings.powerSave;
  $('scaleVal').textContent = String(settings.scale);
  $('speedVal').textContent = String(settings.speed);
  ['idle', 'walk', 'sit'].forEach((name) => {
    $(name + 'Start').value = settings.clips[name].start;
    $(name + 'Count').value = settings.clips[name].count;
    $(name + 'Fps').value = settings.clips[name].fps;
  });
  if ($('display').options.length) {
    const wanted = settings.displayId == null ? '' : String(settings.displayId);
    let matched = false;
    for (const opt of $('display').options) {
      if (settings.displayId == null) {
        if (opt.dataset.primary === '1') {
          opt.selected = true;
          matched = true;
        }
      } else if (opt.value === wanted) {
        opt.selected = true;
        matched = true;
      }
    }
    if (!matched && $('display').options[0]) $('display').options[0].selected = true;
  }
  applying = false;
}

function fillDisplays(list, selected) {
  const sel = $('display');
  const prev = selected == null ? sel.value : String(selected);
  sel.innerHTML = '';
  (list || []).forEach((d) => {
    const opt = document.createElement('option');
    opt.value = String(d.id);
    opt.textContent = d.label;
    opt.dataset.primary = d.primary ? '1' : '0';
    sel.appendChild(opt);
  });
  if (selected == null) {
    const primary = Array.from(sel.options).find((opt) => opt.dataset.primary === '1');
    if (primary) primary.selected = true;
  } else {
    sel.value = prev;
    if (sel.value !== prev && sel.options[0]) sel.options[0].selected = true;
  }
}

function recomputeSheet(frameW, frameH) {
  const layout = Maru.sheetLayout(sheet.width, sheet.height, frameW, frameH);
  cols = layout.cols;
  rows = layout.rows;
  total = layout.total;
  $('sheetInfo').textContent = sheet.width
    ? '시트 ' + sheet.width + '×' + sheet.height + ' · 열 ' + layout.cols + ' · 행 ' + layout.rows + ' · 프레임 ' + layout.total
    : '시트가 없습니다';
  const warn = [];
  if (!sheet.width) warn.push('시트를 넣어 주세요.');
  else if (layout.total <= 0) warn.push('프레임 크기가 시트보다 큽니다.');
  else if (sheet.width % frameW !== 0 || sheet.height % frameH !== 0) warn.push('나누어 떨어지지 않는 가장자리는 무시됩니다.');
  $('sheetWarn').textContent = warn.join(' ');
  return layout;
}

function disp() {
  return {
    w: settings.frameW * settings.scale,
    h: settings.frameH * settings.scale
  };
}

function platformsOf() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const floorY = h - 36;
  const list = [{ id: 'floor', x: 0, w: w, y: floorY }];
  const l1w = Math.max(70, Math.min(150, Math.round(w * 0.32)));
  const l2w = Math.max(64, Math.min(128, Math.round(w * 0.26)));
  list.push({ id: 'l1', x: 16, w: l1w, y: floorY - 74 });
  list.push({ id: 'l2', x: Math.max(16, w - 16 - l2w), w: l2w, y: floorY - 122 });
  if (w >= 560) {
    const l3w = Math.max(60, Math.min(110, Math.round(w * 0.2)));
    list.push({ id: 'l3', x: Math.round(w * 0.38), w: l3w, y: floorY - 168 });
  }
  return { w: w, h: h, list: list };
}

function syncLedges(list) {
  const nodes = stage.querySelectorAll('.ledge');
  for (let i = 0; i < nodes.length; i++) {
    const p = list[i + 1];
    if (!p) {
      nodes[i].style.display = 'none';
      continue;
    }
    nodes[i].style.display = 'block';
    nodes[i].style.left = p.x + 'px';
    nodes[i].style.top = p.y + 'px';
    nodes[i].style.width = p.w + 'px';
    nodes[i].style.height = '18px';
  }
}

function demoMargin(stageW, dw) {
  const maxMargin = Math.max(0, Math.floor((stageW - dw) / 2) - 8);
  return Math.min(settings.sideMargin, maxMargin);
}

function feetY(p) {
  if (p.id === 'floor') return p.y - settings.floorGap;
  return p.y;
}

function xLimits(p, dw, stageW) {
  const inset = p.id === 'floor' ? demoMargin(stageW, dw) : 4;
  const min = p.x + inset;
  const max = p.x + p.w - inset - dw;
  if (max < min) {
    const mid = p.x + (p.w - dw) / 2;
    return { min: mid, max: mid };
  }
  return { min: min, max: max };
}

function applySheetToActor() {
  const d = disp();
  actor.style.width = d.w + 'px';
  actor.style.height = d.h + 'px';
  actor.style.backgroundImage = sheet.dataUrl ? 'url("' + sheet.dataUrl + '")' : 'none';
  actor.style.backgroundSize = (Math.max(1, cols) * d.w) + 'px ' + (Math.max(1, rows) * d.h) + 'px';
  actor.style.visibility = total > 0 ? 'visible' : 'hidden';
}

function activeClip() {
  if (sim.jump) return 'walk';
  if (sim.state === 'sit' && settings.clips.sit.count > 0) return 'sit';
  if (sim.state === 'walk' && settings.clips.walk.count > 0) return 'walk';
  return 'idle';
}

function renderDemo() {
  const d = disp();
  const name = activeClip();
  const clip = settings.clips[name] && settings.clips[name].count > 0 ? settings.clips[name] : settings.clips.idle;
  let frame = Maru.frameIndex(clip, sim.anim, settings.powerSave ? 8 : 24);
  if (total > 0) frame = Math.max(0, Math.min(total - 1, frame));
  const c = Math.max(1, cols);
  const col = frame % c;
  const row = Math.floor(frame / c);
  actor.style.left = Math.round(sim.x) + 'px';
  actor.style.top = Math.round(sim.y) + 'px';
  actor.style.transform = 'scaleX(' + (sim.facing < 0 ? -1 : 1) + ')';
  actor.style.backgroundPosition = (-col * d.w) + 'px ' + (-row * d.h) + 'px';
}

function layoutStage(resetPlace) {
  const box = platformsOf();
  if (box.w < 10) return;
  syncLedges(box.list);
  const d = disp();
  if (resetPlace || sim.platform == null || !box.list[sim.platform]) sim.platform = 0;
  const p = box.list[sim.platform] || box.list[0];
  const lim = xLimits(p, d.w, box.w);
  if (resetPlace) {
    sim.jump = null;
    sim.facing = settings.facing === -1 ? -1 : 1;
    const span = Math.max(0, lim.max - lim.min);
    sim.x = lim.min + Math.max(0, Math.min(1, settings.xRatio)) * span;
  } else if (!sim.dragging && !sim.jump) {
    sim.x = Math.max(lim.min, Math.min(lim.max, sim.x));
  }
  if (!sim.dragging && !sim.jump) sim.y = feetY(p) - d.h;
  applySheetToActor();
  renderDemo();
}

function startJump(list, d) {
  if (list.length < 2) return false;
  let to = sim.platform;
  for (let n = 0; n < 5 && to === sim.platform; n++) to = Math.floor(Math.random() * list.length);
  if (to === sim.platform) return false;
  const target = list[to];
  const lim = xLimits(target, d.w, stage.clientWidth);
  const span = Math.max(0, lim.max - lim.min);
  sim.jump = {
    t: 0,
    dur: 460,
    x0: sim.x,
    y0: sim.y,
    x1: lim.min + Math.random() * span,
    y1: feetY(target) - d.h,
    to: to
  };
  sim.facing = sim.jump.x1 >= sim.jump.x0 ? 1 : -1;
  sim.state = 'walk';
  sim.anim = 0;
  return true;
}

function updateDemo(dt) {
  if (stage.clientWidth < 10 || sim.dragging) return;
  sim.anim += dt;
  const box = platformsOf();
  const d = disp();
  if (sim.jump) {
    sim.jump.t += dt;
    const t = Math.min(1, sim.jump.t / sim.jump.dur);
    sim.x = sim.jump.x0 + (sim.jump.x1 - sim.jump.x0) * t;
    const base = sim.jump.y0 + (sim.jump.y1 - sim.jump.y0) * t;
    sim.y = base - Math.sin(t * Math.PI) * 26;
    sim.facing = sim.jump.x1 >= sim.jump.x0 ? 1 : -1;
    if (t >= 1) {
      sim.platform = sim.jump.to;
      sim.jump = null;
      sim.state = 'walk';
      sim.stateLeft = Maru.behaviorDuration('walk');
      sim.anim = 0;
      const landed = box.list[sim.platform] || box.list[0];
      const lim = xLimits(landed, d.w, box.w);
      sim.x = Math.max(lim.min, Math.min(lim.max, sim.x));
      sim.y = feetY(landed) - d.h;
    }
    return;
  }
  sim.stateLeft -= dt;
  const p = box.list[sim.platform] || box.list[0];
  sim.platform = Math.max(0, box.list.indexOf(p));
  if (sim.stateLeft <= 0) {
    if (sim.state === 'walk' && Math.random() < 0.3 && startJump(box.list, d)) return;
    sim.state = Maru.nextBehavior(sim.state, settings.clips.sit.count > 0);
    sim.stateLeft = Maru.behaviorDuration(sim.state);
    sim.anim = 0;
  }
  if (sim.state === 'walk') {
    sim.x += sim.facing * settings.speed * dt / 1000;
    const lim = xLimits(p, d.w, box.w);
    if (sim.x >= lim.max) {
      sim.x = lim.max;
      sim.facing = -1;
      sim.anim = 0;
    } else if (sim.x <= lim.min) {
      sim.x = lim.min;
      sim.facing = 1;
      sim.anim = 0;
    }
  }
  sim.y = feetY(p) - d.h;
}

function stopDemo() {
  if (demoTimer) clearTimeout(demoTimer);
  demoTimer = null;
}

function startDemo() {
  if (demoTimer || !demoOn) return;
  demoLast = performance.now();
  const step = () => {
    if (!demoOn) {
      demoTimer = null;
      return;
    }
    const delay = settings.powerSave ? 100 : 50;
    demoTimer = setTimeout(step, delay);
    const now = performance.now();
    const dt = Math.min(80, now - demoLast);
    demoLast = now;
    updateDemo(dt);
    renderDemo();
  };
  demoTimer = setTimeout(step, 50);
}

function tagsFor(i) {
  const tags = [];
  ['idle', 'walk', 'sit'].forEach((name) => {
    const c = settings.clips[name];
    if (c.count > 0 && i >= c.start && i < c.start + c.count) tags.push(name);
  });
  return tags;
}

function buildPreview() {
  const root = $('preview');
  root.innerHTML = '';
  if (total <= 0 || !sheet.dataUrl) return;
  const shown = Math.min(total, 180);
  const cell = 36;
  const sx = cell / settings.frameW;
  const sy = cell / settings.frameH;
  for (let i = 0; i < shown; i++) {
    const el = document.createElement('div');
    const tags = tagsFor(i);
    el.className = 'cell' + (tags.length > 1 ? ' mix ' + tags[0] : tags.length ? ' ' + tags[0] : '');
    el.style.backgroundImage = 'url("' + sheet.dataUrl + '")';
    el.style.backgroundSize = (cols * settings.frameW * sx) + 'px ' + (rows * settings.frameH * sy) + 'px';
    const col = i % cols;
    const row = Math.floor(i / cols);
    el.style.backgroundPosition = (-col * settings.frameW * sx) + 'px ' + (-row * settings.frameH * sy) + 'px';
    root.appendChild(el);
  }
  if (shown < total) {
    const more = document.createElement('div');
    more.className = 'meta';
    more.textContent = '외 ' + (total - shown) + '프레임';
    root.appendChild(more);
  }
}

function ratioFromDemo() {
  const w = Math.max(1, stage.clientWidth);
  const d = disp();
  const margin = demoMargin(w, d.w);
  const walkable = Math.max(1, w - margin * 2 - d.w);
  return Math.max(0, Math.min(1, (sim.x - margin) / walkable));
}

function refreshVisuals() {
  recomputeSheet(settings.frameW, settings.frameH);
  $('scaleVal').textContent = String(settings.scale);
  $('speedVal').textContent = String(settings.speed);
  buildPreview();
  layoutStage(false);
}

function onEdit(commit) {
  if (applying) return;
  const raw = readFormRaw();
  const sized = Maru.clampSettings(raw, 0);
  const layout = Maru.sheetLayout(sheet.width, sheet.height, sized.frameW, sized.frameH);
  settings = Maru.clampSettings(raw, layout.total);
  if (commit) fillForm();
  refreshVisuals();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!window.maru) return;
    window.maru.saveSettings(settings).then(() => setStatus('저장됨')).catch((err) => {
      setStatus(err.message || '저장 실패');
    });
  }, 280);
}

function setPetButton(on) {
  settings.petEnabled = !!on;
  const btn = $('togglePet');
  btn.textContent = on ? '내리기' : '띄우기';
  btn.classList.toggle('on', !!on);
  $('petState').textContent = on
    ? '화면 위에 떠 있음. 캐릭터 위를 클릭해도 아래 창이 눌립니다.'
    : '내려가 있음. 캐릭터 위를 클릭해도 아래 창이 눌립니다.';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
    img.src = url;
  });
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다'));
    reader.readAsDataURL(file);
  });
}

async function useSheet(dataUrl, width, height) {
  sheet = { dataUrl: dataUrl, width: width, height: height };
  const layout = recomputeSheet(settings.frameW, settings.frameH);
  settings = Maru.clampSettings(settings, layout.total);
  fillForm();
  refreshVisuals();
}

async function loadFile(file) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) {
    setStatus('이미지 파일만 넣을 수 있습니다');
    return;
  }
  const dataUrl = await readDataUrl(file);
  const img = await loadImage(dataUrl);
  const saved = await window.maru.setSprite({ dataUrl: dataUrl, width: img.width, height: img.height });
  await useSheet(saved.dataUrl || dataUrl, saved.width, saved.height);
  setStatus('시트를 넣었습니다');
}

function snapPlatform() {
  const box = platformsOf();
  const d = disp();
  const feet = sim.y + d.h;
  let best = 0;
  let bestScore = Infinity;
  box.list.forEach((p, i) => {
    const cx = Math.max(p.x, Math.min(sim.x + d.w / 2, p.x + p.w));
    const score = Math.abs(feet - p.y) + Math.abs(sim.x + d.w / 2 - cx) * 0.12;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  sim.platform = best;
  const p = box.list[best];
  const lim = xLimits(p, d.w, box.w);
  sim.x = Math.max(lim.min, Math.min(lim.max, sim.x));
  sim.y = feetY(p) - d.h;
  sim.jump = null;
}

async function savePlace(silent) {
  settings.xRatio = ratioFromDemo();
  settings.facing = sim.facing;
  if (!window.maru) return;
  await window.maru.saveSettings(Object.assign({}, settings, { place: true }));
  if (settings.petEnabled) await window.maru.placePet({ xRatio: settings.xRatio, facing: sim.facing });
  if (!silent) setStatus('위치를 저장했습니다');
}

function bind() {
  ['frameW', 'frameH', 'floorGap', 'sideMargin', 'idleStart', 'idleCount', 'idleFps', 'walkStart', 'walkCount', 'walkFps', 'sitStart', 'sitCount', 'sitFps'].forEach((id) => {
    $(id).addEventListener('input', () => onEdit(false));
    $(id).addEventListener('change', () => onEdit(true));
  });
  $('scale').addEventListener('input', () => onEdit(true));
  $('speed').addEventListener('input', () => onEdit(true));
  $('powerSave').addEventListener('change', () => {
    onEdit(true);
    stopDemo();
    startDemo();
  });
  $('display').addEventListener('change', () => onEdit(true));
  $('pickSprite').addEventListener('click', () => $('spriteFile').click());
  $('spriteFile').addEventListener('change', () => {
    const file = $('spriteFile').files && $('spriteFile').files[0];
    $('spriteFile').value = '';
    if (file) loadFile(file).catch((err) => setStatus(err.message || '시트를 넣지 못했습니다'));
  });
  $('resetSprite').addEventListener('click', async () => {
    const saved = await window.maru.clearSprite();
    await useSheet(saved.dataUrl, saved.width, saved.height);
    setStatus('기본 시트로 되돌렸습니다');
  });
  $('savePlace').addEventListener('click', () => {
    savePlace(false).catch((err) => setStatus(err.message || '저장 실패'));
  });
  $('togglePet').addEventListener('click', async () => {
    const next = !$('togglePet').classList.contains('on');
    $('togglePet').disabled = true;
    try {
      if (next) {
        settings.xRatio = ratioFromDemo();
        settings.facing = sim.facing;
        await window.maru.saveSettings(Object.assign({}, settings, { place: true }));
      }
      const enabled = await window.maru.setPetEnabled(next);
      setPetButton(enabled);
      setStatus(enabled ? '띄웠습니다' : '내렸습니다');
    } catch (err) {
      setStatus(err.message || '바꾸지 못했습니다');
    } finally {
      $('togglePet').disabled = false;
    }
  });
  $('quitApp').addEventListener('click', () => window.maru.quit());
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file).catch((err) => setStatus(err.message || '시트를 넣지 못했습니다'));
  });
  actor.addEventListener('pointerdown', (e) => {
    const rect = stage.getBoundingClientRect();
    sim.dragging = true;
    sim.dragMoved = false;
    sim.grabX = e.clientX - rect.left - sim.x;
    sim.grabY = e.clientY - rect.top - sim.y;
    actor.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  actor.addEventListener('pointermove', (e) => {
    if (!sim.dragging) return;
    const rect = stage.getBoundingClientRect();
    const nx = e.clientX - rect.left - sim.grabX;
    const ny = e.clientY - rect.top - sim.grabY;
    if (Math.abs(nx - sim.x) + Math.abs(ny - sim.y) > 3) sim.dragMoved = true;
    sim.x = nx;
    sim.y = ny;
    sim.jump = null;
    renderDemo();
  });
  actor.addEventListener('pointerup', (e) => {
    if (!sim.dragging) return;
    sim.dragging = false;
    try { actor.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!sim.dragMoved) {
      const now = performance.now();
      if (now - sim.lastClick < 280) return;
      sim.lastClick = now;
      if (settings.clips.sit.count > 0) {
        sim.state = sim.state === 'sit' ? 'walk' : 'sit';
      } else {
        sim.state = 'idle';
      }
      sim.stateLeft = Maru.behaviorDuration(sim.state);
      sim.anim = 0;
      sim.jump = null;
      renderDemo();
      return;
    }
    snapPlatform();
    renderDemo();
    savePlace(true).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopDemo();
    else startDemo();
  });
  if (window.maru) {
    window.maru.onStudioVisibility((visible) => {
      demoOn = !!visible;
      if (visible) startDemo();
      else stopDemo();
    });
    window.maru.onPetEnabled((enabled) => setPetButton(enabled));
    window.maru.onDisplays((list) => fillDisplays(list, settings.displayId));
  }
  const ro = new ResizeObserver(() => layoutStage(false));
  ro.observe(stage);
}

async function boot() {
  if (!window.maru) {
    setStatus('마루펫 실행 파일로 열어 주세요');
    return;
  }
  const state = await window.maru.getState();
  settings = Maru.clampSettings(state.settings, 0);
  sheet = { dataUrl: state.dataUrl, width: state.width, height: state.height };
  fillDisplays(state.displays, settings.displayId);
  const layout = recomputeSheet(settings.frameW, settings.frameH);
  settings = Maru.clampSettings(settings, layout.total);
  fillForm();
  setPetButton(state.petEnabled);
  refreshVisuals();
  layoutStage(true);
  bind();
  startDemo();
  setStatus('준비됨');
}

boot().catch((err) => setStatus(err.message || '시작 오류'));

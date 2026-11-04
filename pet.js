const pet = document.getElementById('pet');
let config = null;
let readySent = false;

function markReady() {
  if (readySent || !window.maru) return;
  readySent = true;
  window.maru.petReady();
}

function applyConfig(cfg) {
  config = cfg;
  const dw = cfg.frameW * cfg.scale;
  const dh = cfg.frameH * cfg.scale;
  pet.style.width = dw + 'px';
  pet.style.height = dh + 'px';
  pet.style.backgroundSize = (cfg.cols * dw) + 'px ' + (cfg.rows * dh) + 'px';
  pet.style.visibility = cfg.total > 0 && cfg.dataUrl ? 'visible' : 'hidden';
  if (!cfg.dataUrl) {
    pet.style.backgroundImage = 'none';
    markReady();
    return;
  }
  const img = new Image();
  img.onload = function () {
    pet.style.backgroundImage = 'url("' + cfg.dataUrl + '")';
    markReady();
  };
  img.onerror = function () {
    pet.style.backgroundImage = 'none';
    markReady();
  };
  img.src = cfg.dataUrl;
}

function applyPose(pose) {
  if (!config || !pose) return;
  const dw = config.frameW * config.scale;
  const dh = config.frameH * config.scale;
  const cols = Math.max(1, config.cols | 0);
  const frame = Math.max(0, pose.frame | 0);
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  pet.style.backgroundPosition = (-col * dw) + 'px ' + (-row * dh) + 'px';
  const flip = pose.facing < 0 ? -1 : 1;
  pet.style.transform = 'scaleX(' + flip + ') translateY(' + (-(pose.bob | 0)) + 'px)';
}

if (window.maru) {
  window.maru.onPetConfig(applyConfig);
  window.maru.onPose(applyPose);
}

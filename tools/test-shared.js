const assert = require('assert');
const Maru = require('../shared');

const clamped = Maru.clampSettings({
  frameW: 0,
  frameH: 9999,
  scale: 40,
  speed: -5,
  xRatio: 3,
  facing: -1,
  clips: {
    idle: { start: 99, count: 0, fps: 0 },
    walk: { start: -4, count: 100, fps: 80 },
    sit: { start: 3, count: 0, fps: 6 }
  }
}, 18);

assert.strictEqual(clamped.frameW, 8);
assert.strictEqual(clamped.frameH, 512);
assert.strictEqual(clamped.scale, 8);
assert.strictEqual(clamped.speed, 10);
assert.strictEqual(clamped.xRatio, 1);
assert.strictEqual(clamped.facing, -1);
assert.strictEqual(clamped.clips.idle.start, 17);
assert.ok(clamped.clips.idle.count >= 1);
assert.strictEqual(clamped.clips.idle.fps, 1);
assert.strictEqual(clamped.clips.walk.start, 0);
assert.strictEqual(clamped.clips.walk.count, 18);
assert.strictEqual(clamped.clips.walk.fps, 24);
assert.strictEqual(clamped.clips.sit.count, 0);

const layout = Maru.sheetLayout(288, 144, 48, 48);
assert.deepStrictEqual(layout, { cols: 6, rows: 3, total: 18 });
assert.deepStrictEqual(Maru.sheetLayout(40, 40, 48, 48), { cols: 0, rows: 0, total: 0 });
assert.strictEqual(Maru.frameIndex({ start: 6, count: 6, fps: 10 }, 250), 8);
assert.strictEqual(Maru.frameIndex({ start: 6, count: 6, fps: 10 }, 0), 6);

const walker = Maru.createWalker(Maru.defaultSettings(), 18);
const pose = walker.tick(50, 800);
assert.ok(pose.xRatio > 0);
assert.ok(pose.frame >= 0 && pose.frame < 18);
walker.place(0.4, -1);
assert.strictEqual(walker.exportState().facing, -1);
console.log('shared ok');

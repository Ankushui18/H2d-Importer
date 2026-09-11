import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/code.js", import.meta.url), "utf8");
assert.match(source, /options\.renderCommitted\s*=\s*true/, "render transaction must commit before optional post-processing");
assert.match(source, /!failedImport\.renderCommitted/, "rollback must not remove committed artboards");
const sandbox = {
  __html__: "",
  console,
  setTimeout,
  clearTimeout,
  figma: {
    mixed: Symbol("mixed"),
    showUI() {},
    ui: { postMessage() {}, onmessage: null },
    currentPage: { selection: [] },
    clientStorage: { async getAsync() {}, async setAsync() {} }
  }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "code.js" });

function plain(value) { return JSON.parse(JSON.stringify(value)); }

const whiteFade = sandbox.gradientPaint("linear-gradient(180deg, rgba(255,255,255,.8) 0%, rgba(0,0,0,0) 42%)", 68, 68);
assert.deepEqual(plain(whiteFade.gradientStops[1].color), { r: 1, g: 1, b: 1, a: 0 }, "white fade must not acquire transparent black");

const blackFade = sandbox.gradientPaint("linear-gradient(180deg, rgba(0,0,0,.8) 0%, rgba(0,0,0,0) 100%)", 100, 50);
assert.deepEqual(plain(blackFade.gradientStops[1].color), { r: 0, g: 0, b: 0, a: 0 }, "black fade must stay black");

const blueFade = sandbox.radialGradientPaint("radial-gradient(circle, rgba(0,128,255,1) 0%, rgba(0,0,0,0) 100%)");
assert.equal(blueFade.gradientStops[1].color.b, 1, "colored transparent stop must inherit visible RGB");

const diagonal = sandbox.gradientPaint("linear-gradient(35deg, #ffffff 0%, #000000 100%)", 353, 137);
assert.ok(Math.abs(diagonal.gradientTransform[0][1]) > Math.abs(diagonal.gradientTransform[0][0]), "non-square diagonal gradient must retain its compensated handle geometry");

const filter = sandbox.cssFilterEffects("blur(4px) drop-shadow(0 6px 12px rgba(0,0,0,.35))");
assert.equal(filter.effects.length, 2, "nested rgba drop-shadow must parse beside blur");

assert.match(sandbox.semanticLayerName({ tag: "::before", x: 0, y: 0, width: 1, height: 1 }), /Pseudo \/ Before/);
assert.equal(sandbox.semanticLayerName({tag:"span",classList:["report-icon"]}),"Icon / Report");
assert.equal(sandbox.semanticLayerName({tag:"svg",name:"icon-flag"}),"Icon / Flag");

const ordered = sandbox.orderedSourceChildren({ children: [
  { type: "FRAME", styles: { zIndex: "10" } },
  { type: "FRAME", styles: { zIndex: "-1" } },
  { type: "FRAME", styles: { zIndex: "10" } }
] });
assert.equal(ordered[0].styles.zIndex, "-1", "negative z-index must paint first");
assert.equal(ordered[1].styles.zIndex, "10", "equal z-index must retain DOM order");

const stableA = sandbox.sourceNodeId({ tag: "button", classList: ["cta"], x: 10, y: 20, width: 100, height: 40 });
const stableB = sandbox.sourceNodeId({ tag: "button", classList: ["cta"], x: 10, y: 20, width: 100, height: 40 });
assert.equal(stableA, stableB, "generated source mapping IDs must be deterministic");

console.log("H2D regression suite passed: 13 checks");

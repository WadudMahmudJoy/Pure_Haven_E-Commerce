import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createPhase6MediaFixture, type MediaFixtureKind } from "./helpers/mediaFixtures";

const kinds: readonly MediaFixtureKind[] = [
  "photo",
  "text-packaging",
  "fine-texture",
  "dark-gradient",
  "transparent",
  "icc-profile",
];

test("phase 6 fixtures are non-empty deterministic decodable and dimension-correct", async () => {
  for (const kind of kinds) {
    const a = await createPhase6MediaFixture(kind, 640, 480);
    const b = await createPhase6MediaFixture(kind, 640, 480);
    assert.ok(a.byteLength > 0, `${kind} must be non-empty`);
    assert.deepEqual(a, b, `${kind} must be deterministic`);
    const metadata = await sharp(a).metadata();
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 480);
  }
});

test("fixture classes expose the requested representative properties", async () => {
  const outputs = new Map<MediaFixtureKind, Uint8Array>();
  for (const kind of kinds) {
    outputs.set(kind, await createPhase6MediaFixture(kind, 768, 512));
  }

  assert.notDeepEqual(outputs.get("photo"), outputs.get("text-packaging"));
  assert.notDeepEqual(outputs.get("text-packaging"), outputs.get("fine-texture"));
  assert.notDeepEqual(outputs.get("fine-texture"), outputs.get("dark-gradient"));

  const transparentMeta = await sharp(outputs.get("transparent")!).metadata();
  assert.equal(transparentMeta.hasAlpha, true);

  const profiledMeta = await sharp(outputs.get("icc-profile")!).metadata();
  assert.ok(profiledMeta.icc && profiledMeta.icc.length > 0, "icc-profile fixture must carry ICC/profile metadata");
});

test("class-specific pixel and statistics assertions validate visual representation", async () => {
  // Transparent fixture must contain transparent (0), partial, and opaque alpha values
  const transparentBytes = await createPhase6MediaFixture("transparent", 100, 100);
  const { data: transRaw } = await sharp(transparentBytes).raw().toBuffer({ resolveWithObject: true });
  let hasZeroAlpha = false;
  let hasPartialAlpha = false;
  let hasOpaqueAlpha = false;
  for (let i = 3; i < transRaw.length; i += 4) {
    const a = transRaw[i];
    if (a === 0) hasZeroAlpha = true;
    else if (a > 0 && a < 255) hasPartialAlpha = true;
    else if (a === 255) hasOpaqueAlpha = true;
  }
  assert.ok(hasZeroAlpha, "transparent fixture must contain alpha=0");
  assert.ok(hasPartialAlpha, "transparent fixture must contain partial alpha (0 < alpha < 255)");
  assert.ok(hasOpaqueAlpha, "transparent fixture must contain alpha=255");

  // Dark gradient fixture must be dark (< 90 everywhere) and non-uniform (gradient exists)
  const darkBytes = await createPhase6MediaFixture("dark-gradient", 100, 100);
  const { data: darkRaw } = await sharp(darkBytes).raw().toBuffer({ resolveWithObject: true });
  let darkMax = 0;
  let darkMin = 255;
  for (let i = 0; i < darkRaw.length; i += 4) {
    const r = darkRaw[i];
    if (r > darkMax) darkMax = r;
    if (r < darkMin) darkMin = r;
  }
  assert.ok(darkMax <= 90, `dark gradient max channel should be <= 90, got ${darkMax}`);
  assert.ok(darkMax - darkMin > 10, `dark gradient must have variance > 10, got ${darkMax - darkMin}`);

  // Text packaging fixture must contain high-contrast features (near-black and near-white pixels)
  const textBytes = await createPhase6MediaFixture("text-packaging", 100, 100);
  const { data: textRaw } = await sharp(textBytes).raw().toBuffer({ resolveWithObject: true });
  let hasNearBlack = false;
  let hasNearWhite = false;
  for (let i = 0; i < textRaw.length; i += 4) {
    const lum = 0.299 * textRaw[i] + 0.587 * textRaw[i + 1] + 0.114 * textRaw[i + 2];
    if (lum < 30) hasNearBlack = true;
    if (lum > 220) hasNearWhite = true;
  }
  assert.ok(hasNearBlack && hasNearWhite, "text-packaging fixture must contain high contrast black and white text elements");

  // Fine texture fixture must have high-frequency pixel deltas between neighbors
  const textureBytes = await createPhase6MediaFixture("fine-texture", 100, 100);
  const { data: texRaw } = await sharp(textureBytes).raw().toBuffer({ resolveWithObject: true });
  let highFreqDiffs = 0;
  for (let i = 0; i < texRaw.length - 4; i += 4) {
    const diff = Math.abs(texRaw[i] - texRaw[i + 4]);
    if (diff > 40) highFreqDiffs++;
  }
  assert.ok(highFreqDiffs > 500, "fine-texture fixture must exhibit high-frequency pixel variations");
});

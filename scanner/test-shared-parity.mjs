// Parity test for the Phase-1 radar-shared.js consolidation.
//
// The EXPECTED tables below were captured from the scanner's ORIGINAL verbatim
// copies of nexradToDbz / rvToDbz / haversine / bearingDeg / degToDir (the code
// that lived in detect.js before it was moved into docs/js/radar-shared.js).
// This test asserts that:
//   1. the shared module (required as CommonJS) reproduces every value exactly,
//   2. the scanner's detect.js re-exports point at that same shared code.
// A mismatch means the move changed behavior — which Phase 1 must never do.
//
// Run: node scanner/test-shared-parity.mjs   (exit 0 = pass, 1 = fail)

import { createRequire } from 'module';
import * as detect from './detect.js';

const require = createRequire(import.meta.url);
const shared = require('../docs/js/radar-shared.js');

// [r, g, b, a] -> expected dBZ (captured from the pre-move implementation).
const NEXRAD_EXPECTED = [
  [[0, 0, 0, 0], 0], [[10, 10, 10, 255], 0], [[255, 255, 255, 255], 0],
  [[100, 210, 230, 255], 5], [[136, 221, 238, 255], 5], [[54, 186, 229, 255], 10],
  [[0, 100, 150, 255], 10], [[0, 160, 230, 255], 15], [[0, 145, 65, 255], 20],
  [[0, 75, 0, 255], 30], [[255, 255, 33, 255], 35], [[255, 238, 0, 255], 35],
  [[255, 115, 0, 255], 42], [[255, 0, 0, 255], 45], [[150, 0, 0, 255], 55],
  [[175, 0, 150, 255], 55], [[230, 100, 230, 255], 60], [[12, 34, 56, 200], 25],
  [[200, 50, 50, 255], 0], [[90, 200, 220, 128], 5], [[3, 3, 3, 255], 0],
];
const RV_EXPECTED = [
  [[0, 0, 0, 10], 0], [[5, 210, 5, 255], 75], [[250, 250, 250, 255], 65],
  [[210, 150, 210, 255], 57], [[210, 120, 210, 255], 59], [[210, 90, 210, 255], 61],
  [[255, 220, 10, 255], 35], [[255, 180, 10, 255], 37], [[255, 150, 10, 255], 39],
  [[255, 110, 10, 255], 42], [[200, 50, 10, 255], 50], [[230, 50, 10, 255], 47],
  [[140, 50, 10, 255], 52], [[160, 170, 200, 255], 15], [[100, 210, 220, 255], 16],
  [[0, 160, 120, 255], 20], [[0, 130, 120, 255], 22], [[0, 90, 120, 255], 28],
  [[100, 90, 70, 100], 13], [[50, 150, 220, 255], 20], [[50, 170, 250, 255], 18],
  [[206, 192, 135, 255], 10], [[0, 163, 224, 255], 18], [[193, 0, 0, 255], 50],
  [[123, 45, 67, 90], 0], [[80, 80, 80, 200], 0],
];
// [lat1, lon1, lat2, lon2] -> expected miles.
const HAVERSINE_EXPECTED = [
  [[40, -105, 40, -105], 0],
  [[40, -105, 41, -105], 69.09758508645551],
  [[40, -105, 40, -104], 52.93154349932376],
  [[34.05, -118.25, 40.71, -74.01], 2445.9048441968594],
  [[51.5074, -0.1278, 48.8566, 2.3522], 213.48900374983265],
];
// [lat1, lon1, lat2, lon2] -> expected bearing (deg).
const BEARING_EXPECTED = [
  [[40, -105, 41, -105], 0],
  [[40, -105, 40, -104], 89.67860140748968],
  [[40, -105, 39, -105], 180],
  [[40, -105, 40, -106], 270.3213985925103],
  [[34.05, -118.25, 40.71, -74.01], 65.92064337414627],
];
// deg -> expected 16-point compass.
const DEGTODIR_EXPECTED = [
  [0, 'N'], [22, 'NNE'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'], [359, 'N'],
];

let failures = 0;
const EPS = 1e-9;

function assertEq(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    failures++;
  }
}
function assertClose(label, actual, expected) {
  if (Math.abs(actual - expected) > EPS) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    failures++;
  }
}

// 1) Shared module reproduces the captured pre-move values exactly.
for (const [rgba, exp] of NEXRAD_EXPECTED) {
  assertEq(`shared.nexradToDbz(${rgba})`, shared.nexradToDbz(...rgba), exp);
}
for (const [rgba, exp] of RV_EXPECTED) {
  assertEq(`shared.rvToDbz(${rgba})`, shared.rvToDbz(...rgba), exp);
}
for (const [args, exp] of HAVERSINE_EXPECTED) {
  assertClose(`shared.haversine(${args})`, shared.haversine(...args), exp);
}
for (const [args, exp] of BEARING_EXPECTED) {
  assertClose(`shared.bearingDeg(${args})`, shared.bearingDeg(...args), exp);
}
for (const [deg, exp] of DEGTODIR_EXPECTED) {
  assertEq(`shared.degToDir(${deg})`, shared.degToDir(deg), exp);
}

// 2) The scanner's detect.js re-exports resolve to the SAME shared code, so the
//    GitHub Actions scanner and the browser app decode radar identically.
for (const [rgba] of NEXRAD_EXPECTED) {
  assertEq(`detect.nexradToDbz(${rgba}) vs shared`, detect.nexradToDbz(...rgba), shared.nexradToDbz(...rgba));
}
for (const [rgba] of RV_EXPECTED) {
  assertEq(`detect.rvToDbz(${rgba}) vs shared`, detect.rvToDbz(...rgba), shared.rvToDbz(...rgba));
}
for (const [args] of HAVERSINE_EXPECTED) {
  assertClose(`detect.haversine(${args}) vs shared`, detect.haversine(...args), shared.haversine(...args));
}
for (const [args] of BEARING_EXPECTED) {
  assertClose(`detect.bearingDeg(${args}) vs shared`, detect.bearingDeg(...args), shared.bearingDeg(...args));
}
for (const [deg] of DEGTODIR_EXPECTED) {
  assertEq(`detect.degToDir(${deg}) vs shared`, detect.degToDir(deg), shared.degToDir(deg));
}
assertEq('detect.lonToTileX === shared', detect.lonToTileX(-105, 7), shared.lonToTileX(-105, 7));
assertEq('detect.latToTileY === shared', detect.latToTileY(40, 7), shared.latToTileY(40, 7));

const total =
  NEXRAD_EXPECTED.length + RV_EXPECTED.length + HAVERSINE_EXPECTED.length +
  BEARING_EXPECTED.length + DEGTODIR_EXPECTED.length;

if (failures === 0) {
  console.log(`PASS radar-shared parity — ${total} converter/geo cases + detect.js re-export checks all match.`);
  process.exit(0);
} else {
  console.error(`\n${failures} parity check(s) FAILED.`);
  process.exit(1);
}

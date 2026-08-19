// Generates every desktop app icon from build/icon.svg.
//
//   node scripts/make-app-icon.mjs
//
// Writes, all from one drawing:
//
//   build/icon-1024.png               the master tile, RGBA
//   build/icon.iconset/*.png          ten sizes, for inspection or iconutil
//   build/icon.icns                   macOS: Finder, Launchpad, DMG, Settings
//   build/icon.ico                    Windows: seven sizes in one file
//   electron/resources/app-icon.png   the Dock icon, set at runtime
//
// This script used to write the *iOS* icon, and carried a mascot path that
// build/icon.svg had long since stopped using — so running it replaced a
// correct icon with an outdated one, while the desktop files it never
// touched kept whatever they were last built from. That is how the shipped
// .icns ended up a release behind the artwork with the Dock icon current:
// two icons, two ages, and no single place to regenerate them. Every desktop
// target now comes out of one run, so they cannot drift apart again.
//
// iOS is deliberately NOT written here. It has its own source of truth in
// ios/App/Assets.xcassets/AppIcon.appiconset/icon-source.svg, and it is not
// this drawing scaled up: it is full-bleed (iOS masks its own corners and
// the App Store rejects an alpha channel), it is untilted, and its face
// marks are set heavier so they survive at 60pt. Rendering it from these
// numbers would quietly undo those decisions.
//
// Everything is drawn by hand — bezier flattening, scanline fill, the PNG,
// ICNS and ICO containers — because the alternative is an image-processing
// dependency in a project that has none, for files that change about never.
// The numbers below mirror build/icon.svg; if that changes, change these.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = join(ROOT, "build");
const ICONSET_DIR = join(BUILD_DIR, "icon.iconset");
const ELECTRON_RES = join(ROOT, "electron", "resources");

const SIZE = 1024;
const SS = 4; // supersampling; 4 is plenty at this size

// ── the artwork, from build/icon.svg ───────────────────────────────────
const TILE_STOPS = [
  { at: 0, color: [0x20, 0x22, 0x27] },
  { at: 0.56, color: [0x13, 0x14, 0x19] },
  { at: 1, color: [0x09, 0x0a, 0x0d] },
];
const MASK_STOPS = [
  { at: 0, color: [0xff, 0xff, 0xff] },
  { at: 0.28, color: [0xe6, 0xe8, 0xeb] },
  { at: 0.58, color: [0xb7, 0xbb, 0xc2] },
  { at: 0.82, color: [0x84, 0x8a, 0x94] },
  { at: 1, color: [0x5b, 0x61, 0x6b] },
];
const FACE = [0x10, 0x11, 0x14];

/** The mask outline, in its own 228.541-unit box. */
const MASK_BODY =
  "M 34.041 54 C 40.041 34 70.041 22 114.2705 22 C 158.5 22 188.5 34 194.5 54 " +
  "C 200 84 197 120 188 148 C 176 184 148 210 114.2705 214 " +
  "C 80.541 210 52.541 184 40.541 148 C 31.541 120 28.541 84 34.041 54 Z";
/** Brows are strokes at 34% — the only part of the drawing that is not opaque. */
const BROWS = ["M 58 94 Q 82 70 108 86", "M 170.541 94 Q 146.541 70 120.541 86"];
const BROW_WIDTH = 12;
const BROW_OPACITY = 0.34;
const EYES = [
  { cx: 88.5, cy: 126, rx: 12, ry: 20 },
  { cx: 140, cy: 126, rx: 12, ry: 20 },
];
const SMILE = "M 92 162 Q 114.2705 178 136.5 162";
const SMILE_WIDTH = 13;

// The macOS icon grid. A tile rather than full bleed, because a full-bleed
// icon renders noticeably larger than everything around it — but the grid
// moved. Big Sur's 824-unit tile with a 22.5% corner is what this drawing
// was built to, and beside icons drawn for macOS 26 it reads as visibly
// small: measuring the .icns of apps shipped for it — Claude 839, OneDrive
// 839, Obsidian 843, Ollama 836, all filling ~94.6% of their own box with a
// ~25.2% corner — puts the current tile at 839 with a rounder corner. The
// numbers below are that measurement, not a guess, and they are the reason
// the icon stopped looking a size down from its neighbours.
//
// Outside the tile is transparent: the Dock draws its own shadow there, and
// an opaque white margin painted into it is what put a white card behind
// this icon for a whole release.
const TILE_INSET = 92.5;
const TILE_SPAN = 839;
const TILE_SCALE = TILE_SPAN / 1024;
// 25.2% of the tile — matched to the fill fraction those apps measure at,
// which is what the eye actually reads as "the same size".
const TILE_RADIUS = TILE_SPAN * 0.252;

// `<svg x="62" y="36" width="900" height="900" viewBox="0 0 228.541 228.541">`
// inside the tile, with the group tilted -10° about the box's centre.
//
// 900 rather than the 800 this started at. macOS 26 masks every app icon to
// one shape, so the tile is the same size as every neighbour's whatever we
// draw — what reads as "small in the Dock" is the mark inside it, and at 800
// the mask filled about half a tile where Notes and Freeform fill theirs
// nearly edge to edge. 900 lands near where Claude's mark sits; past ~980
// the mask starts touching the tile edge and loses its air.
const ART_SCALE = 900 / 228.541;
const ART_OFFSET = [62, 36];
const TILT = -10;
const TILT_ABOUT = [114.2705, 114.2705];

const rotate = ([x, y], degrees, [cx, cy]) => {
  const a = (degrees * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};

/** Artwork point → canvas, through the tilt, the inner svg, and the grid. */
const place = ([x, y]) => {
  const [rx, ry] = rotate([x, y], TILT, TILT_ABOUT);
  return [
    TILE_INSET + (ART_OFFSET[0] + rx * ART_SCALE) * TILE_SCALE,
    TILE_INSET + (ART_OFFSET[1] + ry * ART_SCALE) * TILE_SCALE,
  ];
};
/** A length in artwork units → canvas units. */
const placeLength = (n) => n * ART_SCALE * TILE_SCALE;

// ── path handling ──────────────────────────────────────────────────────
/** M/L/Q/C/Z absolute, which is all build/icon.svg uses. */
function flatten(d, steps = 48) {
  const tokens = d.match(/[MLQCZmlqcz]|-?\d*\.?\d+/g) ?? [];
  const points = [];
  let cursor = [0, 0];
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i];
    if (command === "M" || command === "L") {
      cursor = [+tokens[i + 1], +tokens[i + 2]];
      points.push(cursor);
      i += 3;
    } else if (command === "Q") {
      const c = [+tokens[i + 1], +tokens[i + 2]];
      const end = [+tokens[i + 3], +tokens[i + 4]];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        points.push([
          u * u * cursor[0] + 2 * u * t * c[0] + t * t * end[0],
          u * u * cursor[1] + 2 * u * t * c[1] + t * t * end[1],
        ]);
      }
      cursor = end;
      i += 5;
    } else if (command === "C") {
      const c1 = [+tokens[i + 1], +tokens[i + 2]];
      const c2 = [+tokens[i + 3], +tokens[i + 4]];
      const end = [+tokens[i + 5], +tokens[i + 6]];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        points.push([
          u ** 3 * cursor[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0],
          u ** 3 * cursor[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1],
        ]);
      }
      cursor = end;
      i += 7;
    } else {
      i += 1;
    }
  }
  return points;
}

/** An ellipse as a polygon, in its own coordinates. */
function ellipse({ cx, cy, rx, ry }, steps = 72) {
  const points = [];
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    points.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return points;
}

/** A rounded rect as a polygon, in canvas coordinates. */
function roundedRect({ x, y, w, h, r }, steps = 24) {
  const points = [];
  const corners = [
    [x + w - r, y + r, -90, 0],
    [x + w - r, y + h - r, 0, 90],
    [x + r, y + h - r, 90, 180],
    [x + r, y + r, 180, 270],
  ];
  for (const [cx, cy, from, to] of corners) {
    for (let s = 0; s <= steps; s++) {
      const a = ((from + ((to - from) * s) / steps) * Math.PI) / 180;
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return points;
}

/** A stroked polyline as fillable polygons, with round caps and joins. */
function strokeToPolygons(points, width) {
  const half = width / 2;
  const polys = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    polys.push([
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ]);
  }
  for (const [x, y] of points) {
    const circle = [];
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      circle.push([x + Math.cos(t) * half, y + Math.sin(t) * half]);
    }
    polys.push(circle);
  }
  return polys;
}

/** Even-odd would hole out overlapping stroke quads, so: coverage by union. */
function rasterise(polygons, width) {
  const mask = new Uint8Array(width * width);
  for (const poly of polygons) {
    const ys = poly.map((p) => p[1]);
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(width - 1, Math.ceil(Math.max(...ys)));
    for (let y = top; y <= bottom; y++) {
      const sy = y + 0.5;
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        if (y0 === y1) continue;
        if (sy < Math.min(y0, y1) || sy >= Math.max(y0, y1)) continue;
        xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil(xs[i] - 0.5));
        const to = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = from; x <= to; x++) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

const sample = (stops, t) => {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped <= stops[i + 1].at) {
      const a = stops[i];
      const b = stops[i + 1];
      const local = (clamped - a.at) / (b.at - a.at || 1);
      return a.color.map((c, k) => c + (b.color[k] - c) * local);
    }
  }
  return stops[stops.length - 1].color;
};

// ── draw, once, at supersampled resolution ─────────────────────────────
const big = SIZE * SS;
const toBig = ([x, y]) => [(x / SIZE) * big, (y / SIZE) * big];
const bigLength = (n) => (n / SIZE) * big;

const bodyPoly = flatten(MASK_BODY).map(place).map(toBig);
const browPolys = BROWS.flatMap((d) =>
  strokeToPolygons(flatten(d).map(place).map(toBig), bigLength(placeLength(BROW_WIDTH))),
);
const eyePolys = EYES.map((e) => ellipse(e).map(place).map(toBig));
const smilePolys = strokeToPolygons(
  flatten(SMILE).map(place).map(toBig),
  bigLength(placeLength(SMILE_WIDTH)),
);

const tilePoly = roundedRect({
  x: TILE_INSET,
  y: TILE_INSET,
  w: TILE_SPAN,
  h: TILE_SPAN,
  r: TILE_RADIUS,
}).map(toBig);

// `<rect x="8" y="8" width="1008" height="1008" rx="222.4" stroke-width="16">`
// in tile units — a hairline of light just inside the edge, drawn as the gap
// between two rounded rects because the rasteriser fills, it does not stroke.
const hairline = (spread) =>
  roundedRect({
    x: TILE_INSET + (8 - spread) * TILE_SCALE,
    y: TILE_INSET + (8 - spread) * TILE_SCALE,
    w: (1008 + spread * 2) * TILE_SCALE,
    h: (1008 + spread * 2) * TILE_SCALE,
    r: TILE_RADIUS - 8 * TILE_SCALE + spread * TILE_SCALE,
  }).map(toBig);

const tileMask = rasterise([tilePoly], big);
const bodyMask = rasterise([bodyPoly], big);
const browMask = rasterise(browPolys, big);
const faceMask = rasterise([...eyePolys, ...smilePolys], big);
const hairMask = rasterise([hairline(8)], big);
const hairHole = rasterise([hairline(-8)], big);

// the mask's linear gradient runs 18%,10% → 84%,94% of its own bounding box
const bx = bodyPoly.map((p) => p[0]);
const by = bodyPoly.map((p) => p[1]);
const bounds = { x0: Math.min(...bx), x1: Math.max(...bx), y0: Math.min(...by), y1: Math.max(...by) };
const gradFrom = [bounds.x0 + (bounds.x1 - bounds.x0) * 0.18, bounds.y0 + (bounds.y1 - bounds.y0) * 0.1];
const gradTo = [bounds.x0 + (bounds.x1 - bounds.x0) * 0.84, bounds.y0 + (bounds.y1 - bounds.y0) * 0.94];
const gradVec = [gradTo[0] - gradFrom[0], gradTo[1] - gradFrom[1]];
const gradLenSq = gradVec[0] ** 2 + gradVec[1] ** 2;

// the tile's radial gradient: 68%,36% of the tile, radius 92%
const tileCentre = [
  bigLength(TILE_INSET + TILE_SPAN * 0.68),
  bigLength(TILE_INSET + TILE_SPAN * 0.36),
];
const tileRadius = bigLength(TILE_SPAN * 0.92);

/** Colour of one supersample, or null outside the tile — which is where the
 *  transparency comes from, and the whole reason this file has an alpha
 *  channel at all. */
function shade(index, px, py) {
  if (!tileMask[index]) return null;
  let colour;
  if (bodyMask[index]) {
    if (faceMask[index]) {
      colour = FACE;
    } else {
      const t =
        ((px - gradFrom[0]) * gradVec[0] + (py - gradFrom[1]) * gradVec[1]) / (gradLenSq || 1);
      colour = sample(MASK_STOPS, t);
      if (browMask[index]) colour = colour.map((c, i) => c + (FACE[i] - c) * BROW_OPACITY);
    }
  } else {
    const d = Math.hypot(px - tileCentre[0], py - tileCentre[1]) / tileRadius;
    colour = sample(TILE_STOPS, d);
  }
  // The hairline, lit from the upper left rather than drawn evenly round.
  //
  // macOS 26 lays its own specular sheen over every app icon, and that sheen
  // is directional: measuring what the system actually draws, Claude's rim
  // reads 86 at the upper left and 63 at the lower right but only 19 at the
  // other two corners, and Music and Freeform agree within a few points.
  // That diagonal is what makes a tile look like a lit surface instead of a
  // sticker.
  //
  // An even rim fights it. At a flat 28% this icon measured 183/84/87/142
  // against Claude's 86/19/19/63 — brighter everywhere, and brightest in the
  // two corners that are supposed to fall away, which flattens the whole
  // thing back out. So the rim is weighted by how much a point faces the
  // light: full strength towards the upper left, nothing across the
  // perpendicular, and 80% along the lower right where a curved surface
  // catches the bounce.
  const HAIR_PEAK = 0.42;
  if (hairMask[index] && !hairHole[index]) {
    const nx = px - big / 2;
    const ny = py - big / 2;
    const len = Math.hypot(nx, ny) || 1;
    const facing = (-nx - ny) / (len * Math.SQRT2); // 1 upper-left, -1 lower-right
    const weight = facing >= 0 ? facing : -facing * 0.8;
    colour = colour.map((c) => c + (255 - c) * HAIR_PEAK * weight);
  }
  return colour;
}

/** Render at `size`, box-filtering the one supersampled grid. Colour is
 *  averaged over the covered samples only, so the edge does not darken
 *  towards the transparent surround. */
function render(size) {
  const step = big / size;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      let covered = 0;
      let total = 0;
      const px1 = Math.min(big, Math.round((x + 1) * step));
      const py1 = Math.min(big, Math.round((y + 1) * step));
      for (let py = Math.round(y * step); py < py1; py++) {
        for (let px = Math.round(x * step); px < px1; px++) {
          total += 1;
          const colour = shade(py * big + px, px, py);
          if (!colour) continue;
          covered += 1;
          acc = acc.map((c, i) => c + colour[i]);
        }
      }
      if (covered === 0) continue; // transparent: leave the zeros
      const at = (y * size + x) * 4;
      rgba[at] = Math.round(acc[0] / covered);
      rgba[at + 1] = Math.round(acc[1] / covered);
      rgba[at + 2] = Math.round(acc[2] / covered);
      rgba[at + 3] = Math.round((covered / (total || 1)) * 255);
    }
  }
  return rgba;
}

// ── PNG ────────────────────────────────────────────────────────────────
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
};

/** RGBA in, PNG out. */
function encodePng(rgba, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICNS ───────────────────────────────────────────────────────────────
// A modern .icns is a container of PNGs: an 'icns' header, then one chunk
// per icon type. The four-character types are fixed by the format — `icp4`
// is 16pt, `ic10` is 512@2x — so they are spelled out rather than derived,
// because Finder ignores a wrong one in silence.
const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32], // 16@2x
  ["ic12", 64], // 32@2x
  ["ic07", 128],
  ["ic13", 256], // 128@2x
  ["ic08", 256],
  ["ic14", 512], // 256@2x
  ["ic09", 512],
  ["ic10", 1024], // 512@2x
];

function encodeIcns(pngFor) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const png = pngFor(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

// ── ICO ────────────────────────────────────────────────────────────────
// Windows has read PNG-compressed entries since Vista. 256 is written as 0
// in the directory, which is the format's way of saying "not 255".
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(pngFor) {
  const entries = ICO_SIZES.map((size) => ({ size, png: pngFor(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    directory.push(entry);
  }
  return Buffer.concat([header, ...directory, ...entries.map((e) => e.png)]);
}

// ── write ──────────────────────────────────────────────────────────────
const cache = new Map();
const pngFor = (size) => {
  if (!cache.has(size)) cache.set(size, encodePng(render(size), size));
  return cache.get(size);
};

mkdirSync(ICONSET_DIR, { recursive: true });
mkdirSync(ELECTRON_RES, { recursive: true });

const master = pngFor(SIZE);
writeFileSync(join(BUILD_DIR, "icon-1024.png"), master);
writeFileSync(join(ELECTRON_RES, "app-icon.png"), master);

// the .iconset folder Apple's iconutil expects, kept so the icns can be
// rebuilt or eyeballed without this script
const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  // 64 is not one of iconutil's names and it ignores the pair, but both
  // files are in the repo — and a file this script leaves alone is a file
  // that keeps the previous artwork forever, which is the exact failure
  // this rewrite exists to end. Write everything that is there.
  ["icon_64x64.png", 64],
  ["icon_64x64@2x.png", 128],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of ICONSET) writeFileSync(join(ICONSET_DIR, name), pngFor(size));

writeFileSync(join(BUILD_DIR, "icon.icns"), encodeIcns(pngFor));
writeFileSync(join(BUILD_DIR, "icon.ico"), encodeIco(pngFor));

console.log("wrote build/icon-1024.png, icon.iconset/ (10), icon.icns, icon.ico");
console.log("wrote electron/resources/app-icon.png");
console.log("iOS not written here — see ios/…/AppIcon.appiconset/icon-source.svg");

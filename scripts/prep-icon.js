// Turns www/icons/app_icon.png (a rectangular, white-background source) into the three square
// source assets @capacitor/assets expects for Custom Mode icon generation — see README.md's
// "Usage - Custom Mode" section. Run this, then `npm run icons`, whenever app_icon.png changes.
//
// FOREGROUND_FRACTION controls how much of the 1024x1024 canvas the artwork fills before
// Android's own adaptive-icon inset (baked into the generated XML, see capacitor-assets'
// android generator) shrinks it further for the home-screen grid. Tuned down from an earlier
// 0.98 after real-device testing showed the icon looking too large/cramped in practice — some
// launcher surfaces (e.g. the long-press app-info preview) don't appear to apply the same inset
// as the home-screen grid does, so extra margin baked directly into the bitmap is safer than
// relying on the XML inset alone.
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "www", "icons", "app_icon.png");
const OUT_DIR = path.join(ROOT, "assets");
const BG_HEX = "#F4EBDD"; // app's own --bg cream color, ties the icon to the app's palette
const CANVAS = 1024;
const FOREGROUND_FRACTION = 0.78;
// icon-only.png feeds the LEGACY square + round launcher icons, which get no automatic inset at
// all — the round variant masks with a circle inscribed exactly in the full tile, so content
// must fit that circle on its own. For this source's ~537:454 bounding box, corners start
// clipping past ~0.76; 0.70 keeps a safety margin since the silhouette isn't a filled rectangle
// out to its corners.
const ICON_ONLY_FRACTION = 0.70;

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  console.log("source:", width, "x", height, "channels:", channels);

  // Border flood-fill: only remove white/near-white pixels reachable from the image edge, so
  // the book's own white/cream interior pages (not touching the border) are left untouched.
  const isBg = (p) => data[p] > 235 && data[p + 1] > 235 && data[p + 2] > 235;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let qHead = 0, qTail = 0;

  function tryEnqueue(x, y) {
    const i = y * width + x;
    if (visited[i]) return;
    const p = i * channels;
    if (isBg(p)) {
      visited[i] = 1;
      queue[qTail++] = i;
    }
  }

  for (let x = 0; x < width; x++) { tryEnqueue(x, 0); tryEnqueue(x, height - 1); }
  for (let y = 0; y < height; y++) { tryEnqueue(0, y); tryEnqueue(width - 1, y); }

  while (qHead < qTail) {
    const i = queue[qHead++];
    const x = i % width, y = (i / width) | 0;
    if (x > 0) tryEnqueue(x - 1, y);
    if (x < width - 1) tryEnqueue(x + 1, y);
    if (y > 0) tryEnqueue(x, y - 1);
    if (y < height - 1) tryEnqueue(x, y + 1);
  }

  let removed = 0;
  for (let i = 0; i < width * height; i++) {
    if (visited[i]) { data[i * channels + 3] = 0; removed++; }
  }
  console.log("transparent pixels:", removed, "/", width * height, `(${((removed / (width * height)) * 100).toFixed(1)}%)`);

  const cutout = sharp(data, { raw: { width, height, channels } }).png();

  const trimmed = sharp(await cutout.toBuffer()).trim();
  const trimmedBuf = await trimmed.toBuffer();
  const trimmedMeta = await sharp(trimmedBuf).metadata();
  console.log("trimmed content:", trimmedMeta.width, "x", trimmedMeta.height);

  async function padToSquare(fraction) {
    const innerSize = Math.round(CANVAS * fraction);
    return sharp(trimmedBuf)
      .resize(innerSize, innerSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: Math.floor((CANVAS - innerSize) / 2),
        bottom: Math.ceil((CANVAS - innerSize) / 2),
        left: Math.floor((CANVAS - innerSize) / 2),
        right: Math.ceil((CANVAS - innerSize) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  const foregroundBuf = await padToSquare(FOREGROUND_FRACTION);
  fs.writeFileSync(path.join(OUT_DIR, "icon-foreground.png"), foregroundBuf);

  const bgRgb = hexToRgb(BG_HEX);
  const backgroundBuf = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { ...bgRgb, alpha: 1 } },
  }).png().toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "icon-background.png"), backgroundBuf);

  const iconOnlyForegroundBuf = await padToSquare(ICON_ONLY_FRACTION);
  const onlyBuf = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { ...bgRgb, alpha: 1 } },
  })
    .composite([{ input: iconOnlyForegroundBuf, gravity: "center" }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "icon-only.png"), onlyBuf);

  console.log("wrote icon-foreground.png, icon-background.png, icon-only.png to", OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Packages www/ into a versioned zip for @capgo/capacitor-updater and writes the manifest that
// src/updater.js polls on app launch. Run via `npm run release` (zips + writes manifest only)
// or `npm run deploy` (also runs `firebase deploy --only hosting`).
//
// Version is a UTC timestamp (YYYYMMDDHHmmss) — always increasing, no need to hand-track a
// semver bump for what's meant to be a quiet background update.
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const ROOT = path.join(__dirname, "..");
const WWW_DIR = path.join(ROOT, "www");
const HOSTING_UPDATES_DIR = path.join(ROOT, "hosting", "updates");
const HOSTING_BASE_URL = "https://mister-lapkins.web.app/updates";
const KEEP_PREVIOUS_BUNDLES = 3; // old zips beyond this are deleted so Hosting storage doesn't grow forever

function buildVersion(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function zipWwwDir(destPath){
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    // www/*.bundle.js are build output already inside www/, so they're included automatically —
    // nothing here needs to know about cloud-sync/audio/updater specifically.
    archive.directory(WWW_DIR, false);
    archive.finalize();
  });
}

// Zip names the live manifests still point at — never pruned, whichever channel just released.
function referencedBundles(){
  return ["version.json", "beta.json"].map((name) => {
    try{
      const m = JSON.parse(fs.readFileSync(path.join(HOSTING_UPDATES_DIR, name), "utf8"));
      return path.basename(m.url);
    }catch(e){
      return null;
    }
  }).filter(Boolean);
}

function pruneOldBundles(keepFile){
  const keep = referencedBundles().concat([keepFile]);
  const files = fs
    .readdirSync(HOSTING_UPDATES_DIR)
    .filter((f) => f.startsWith("bundle-") && f.endsWith(".zip") && keep.indexOf(f) === -1)
    .sort()
    .reverse();
  files.slice(KEEP_PREVIOUS_BUNDLES).forEach((f) => {
    fs.unlinkSync(path.join(HOSTING_UPDATES_DIR, f));
    console.log("release: pruned old bundle", f);
  });
}

async function main(){
  fs.mkdirSync(HOSTING_UPDATES_DIR, { recursive: true });

  const version = buildVersion();
  const zipName = `bundle-${version}.zip`;
  const zipPath = path.join(HOSTING_UPDATES_DIR, zipName);

  console.log("release: zipping", WWW_DIR, "->", zipPath);
  await zipWwwDir(zipPath);
  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`release: wrote ${zipName} (${sizeKb} KB)`);

  // --beta (npm run deploy:beta) writes beta.json instead — only BETA_DEVICE_IDS in
  // src/updater.js read it, everyone else stays on version.json.
  const manifestName = process.argv.includes("--beta") ? "beta.json" : "version.json";
  const manifest = { version: version, url: `${HOSTING_BASE_URL}/${zipName}` };
  fs.writeFileSync(path.join(HOSTING_UPDATES_DIR, manifestName), JSON.stringify(manifest, null, 2));
  console.log(`release: wrote ${manifestName} ->`, manifest);

  pruneOldBundles(zipName);
}

main().catch((e) => { console.error("release: failed", e); process.exit(1); });

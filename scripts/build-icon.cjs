const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");
const src = path.join(buildDir, "codex_bridge.png");
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function resizePng(size) {
  return sharp(src)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .ensureAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(src)) {
    console.error("Missing build/codex_bridge.png");
    process.exit(1);
  }

  const pngBuffers = await Promise.all(ICO_SIZES.map((size) => resizePng(size)));
  const png256 = pngBuffers[pngBuffers.length - 1];

  fs.writeFileSync(path.join(buildDir, "icon.png"), png256);
  fs.writeFileSync(path.join(publicDir, "icon.png"), png256);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), await pngToIco(pngBuffers));
  console.log("Generated build/icon.ico and public/icon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "electron", "assets");
const dest = path.join(root, "dist-electron", "assets");

if (!fs.existsSync(src)) {
  console.error(`[copy-electron-assets] missing ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[copy-electron-assets] copied ${src} -> ${dest}`);

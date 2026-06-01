const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;

const root = path.join(__dirname, "..");
const src = path.join(root, "build", "icon.png");
const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");

async function main() {
  if (!fs.existsSync(src)) {
    console.error("Missing build/icon.png");
    process.exit(1);
  }
  const png256 = await sharp(src).resize(256, 256).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, "icon.png"), png256);
  fs.writeFileSync(path.join(publicDir, "icon.png"), png256);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), await pngToIco(png256));
  console.log("Generated build/icon.ico and public/icon.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

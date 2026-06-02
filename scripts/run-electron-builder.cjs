const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const mirror =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
  "https://npmmirror.com/mirrors/electron-builder-binaries/";
const version = "2.6.0";
const cacheDir = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "electron-builder",
  "Cache",
  "winCodeSign"
);
const vendorDir = path.join(cacheDir, `winCodeSign-${version}`);
const archivePath = path.join(cacheDir, `winCodeSign-${version}.7z`);
const sevenZa = path.join(root, "node_modules", "7zip-bin", "win", "x64", "7za.exe");

process.env.ELECTRON_BUILDER_BINARIES_MIRROR = mirror;

function ensureWinCodeSign() {
  if (fs.existsSync(path.join(vendorDir, "rcedit-x64.exe"))) return;

  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    const url = `${mirror}winCodeSign-${version}/winCodeSign-${version}.7z`;
    const download = spawnSync(
      "curl.exe",
      ["-L", "--fail", "--retry", "3", "-o", archivePath, url],
      { stdio: "inherit" }
    );
    if (download.status !== 0) process.exit(download.status ?? 1);
  }

  fs.mkdirSync(vendorDir, { recursive: true });
  const extract = spawnSync(
    sevenZa,
    [
      "x",
      "-bd",
      archivePath,
      "rcedit-x64.exe",
      "rcedit-ia32.exe",
      "windows-10",
      "windows-6",
      "openssl-ia32",
      "appxAssets",
      `-o${vendorDir}`,
    ],
    { stdio: "inherit" }
  );
  if (extract.status !== 0) process.exit(extract.status ?? 1);
}

ensureWinCodeSign();

const cli = path.join(root, "node_modules", "electron-builder", "cli.js");
const result = spawnSync(process.execPath, [cli], {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

process.exit(result.status ?? 1);

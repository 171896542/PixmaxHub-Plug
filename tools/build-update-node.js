"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const UPDATE_PACKAGE_MARKER = "PIXMAX_CANVAS_CLONER_UPDATE_V1";
const FILES = [
  "manifest.json",
  "bridge.js",
  "content.js",
  "relay.js",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "likes.html",
  "likes.css",
  "likes.js",
  "README.md"
];

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const version = process.argv[2] || manifest.version;
  const tar = createTar(FILES.map((file) => ({
    data: fs.readFileSync(path.join(ROOT, file)),
    path: file
  })));
  const gzipped = zlib.gzipSync(tar, { level: 9 });
  const sha256 = crypto.createHash("sha256").update(gzipped).digest("hex");
  const body = [
    `Pixmax 更新包 ${version}`,
    UPDATE_PACKAGE_MARKER,
    JSON.stringify(
      {
        type: UPDATE_PACKAGE_MARKER,
        version,
        createdAt: new Date().toISOString(),
        archive: "tar",
        compression: "gzip",
        encoding: "base64",
        sha256,
        files: FILES,
        data: gzipped.toString("base64")
      },
      null,
      2
    )
  ].join("\n");
  const output = path.join(ROOT, `pixmax-update-node-${version}.txt`);
  fs.writeFileSync(output, body);
  console.log(`Wrote ${path.relative(ROOT, output)}`);
  console.log(`gzip bytes: ${gzipped.length}`);
  console.log(`base64 chars: ${gzipped.toString("base64").length}`);
  console.log(`sha256: ${sha256}`);
}

function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    chunks.push(createHeader(entry.path, entry.data.length));
    chunks.push(entry.data);
    chunks.push(Buffer.alloc(padLength(entry.data.length)));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function createHeader(name, size) {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  writeOctal(header, 148, 8, checksum);
  return header;
}

function writeString(buffer, offset, length, value) {
  buffer.write(String(value), offset, Math.min(length, Buffer.byteLength(String(value))), "utf8");
}

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function padLength(size) {
  return (512 - (size % 512)) % 512;
}

main();

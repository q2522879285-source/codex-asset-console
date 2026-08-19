import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleLocalRequestHeaders,
  assetConsoleRoute,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "../lib/asset-console-embed.mjs";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
const embedUrl = assetConsoleEmbedUrl(token);

test("embedded Asset Console routes only its own sandbox requests to localhost", () => {
  assert.equal(assetConsoleRoute(`${embedUrl}styles.css`, { token }), "/styles.css");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token, assetSession: true }), "/api/projects");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/media?path=a.png", { token, assetSession: true }), "/media?path=a.png");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/download?path=a.mp4", { token, assetSession: true }), "/download?path=a.mp4");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token }), null);
  assert.equal(assetConsoleRoute("https://example.com/api/projects", { token, assetSession: true }), null);
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/__codex_asset_console__/wrong-token/app.js", { token }), null);
  assert.throws(() => assetConsoleEmbedPrefix("predictable"), /Invalid Asset Console embed token/);
});

test("localhost Asset Console requests receive only the installed API token", () => {
  assert.deepEqual(assetConsoleLocalRequestHeaders({
    Origin: "https://web-sandbox.oaiusercontent.com",
    Referer: "https://web-sandbox.oaiusercontent.com/",
    "Content-Length": "999",
    "X-Asset-Console-Token": "untrusted-frame-value",
    Host: "attacker.invalid",
    Accept: "application/json",
  }, "installed-secret"), {
    Accept: "application/json",
    host: "127.0.0.1:5177",
    "x-asset-console-token": "installed-secret",
  });
  assert.equal(assetConsoleLocalRequestHeaders({ Range: "bytes=0-" }, "installed-secret", {
    maxOpenRangeBytes: 8 * 1024 * 1024,
  }).Range, "bytes=0-8388607");
  assert.equal(assetConsoleLocalRequestHeaders({ Range: "bytes=8388608-" }, "installed-secret", {
    maxOpenRangeBytes: 8 * 1024 * 1024,
  }).Range, "bytes=8388608-16777215");
  assert.equal(assetConsoleLocalRequestHeaders({ Range: "bytes=10-20" }, "installed-secret", {
    maxOpenRangeBytes: 8 * 1024 * 1024,
  }).Range, "bytes=10-20");
});

test("embedded Asset Console rewrites local assets and disables the unproxyable event stream", () => {
  const html = Buffer.from('<link href="/styles.css"><script src="/app.js"></script>');
  const rewrittenHtml = transformAssetConsoleBody(embedUrl, html, { token }).toString("utf8");
  assert.match(rewrittenHtml, new RegExp(`${token}/styles\\.css`));
  assert.match(rewrittenHtml, new RegExp(`${token}/app\\.js`));

  const script = Buffer.from("function configureLiveEvents() { if (!window.EventSource) return; }");
  const rewrittenScript = transformAssetConsoleBody(`${embedUrl}app.js`, script, { token }).toString("utf8");
  assert.match(rewrittenScript, /Embedded mode uses the existing timed refresh/);
});

test("proxied responses replace stale transport lengths", () => {
  const headers = responseHeadersForCdp({ "content-type": "text/css", "content-length": "1", connection: "close" }, 42);
  assert.deepEqual(headers, [
    { name: "content-type", value: "text/css" },
    { name: "content-length", value: "42" },
  ]);
});

test("the injector bounds buffered local responses instead of exhausting memory", async () => {
  const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");
  assert.match(source, /assetConsoleApiTokenPath[\s\S]+readFile\(assetConsoleApiTokenPath, "utf8"\)/);
  assert.match(source, /apiToken:\s*proxy\.apiToken/);
  assert.match(source, /isMediaRoute \? MAX_ASSET_CONSOLE_MEDIA_RANGE_BYTES : 0/);
  assert.match(source, /proxy\.apiToken\s*=\s*null/);
  assert.match(source, /MAX_BUFFERED_ASSET_CONSOLE_RESPONSE_BYTES\s*=\s*64\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /declaredLength\s*>\s*maxResponseBytes/);
  assert.match(source, /receivedBytes\s*>\s*maxResponseBytes/);
  assert.match(source, /response\.destroy\(new Error\(`Asset Console response exceeds/);
});

#!/usr/bin/env node
// Headless behavior tests for the popup: serves the repo over HTTP, drives
// headless Chrome over CDP, and evals scripts/draft-test.js and
// scripts/flush-test.js against the real dev harness (chrome.* stubs).
// Any assertion failure exits non-zero — this is the CI gate for "closing the
// popup must never lose the user's list".
//
// Usage: node scripts/run-tests.mjs        (CHROME=... to override the binary)

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8500 + (process.pid % 100);
const CHROME =
  process.env.CHROME ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nbd-test-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT + 1000}`,
  `--user-data-dir=${profile}`, "--no-first-run", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 60; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${PORT + 1000}/json`)).json(); break; }
  catch { await sleep(250); }
}
if (!list) { console.error("FAIL chrome devtools endpoint never came up"); process.exit(1); }
const page = list.find((t) => t.type === "page");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { ok, bad } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? bad(new Error(JSON.stringify(m.error))) : ok(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { ok: resolve, bad: reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + " timed out")); } }, 20000);
  });

await send("Page.enable");
await send("Runtime.enable");

const SEED = "https://seed.example.com/seed.zip";
const TYPED = "https://typed.example.com/x.zip\nhttps://typed.example.com/y.zip";
const TESTS = [
  {
    name: "draft-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&draft=${encodeURIComponent(SEED)}`,
    file: "draft-test.js",
    expect: {
      restored: SEED,
      labelAfterRestore: "Start Download · 1",
      savedAfterInput: TYPED,
      draftAfterStart: null,
      startSent: true,
    },
  },
  {
    name: "flush-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}`,
    file: "flush-test.js",
    expectAllTrue: true,
  },
];

let failed = 0;
for (const t of TESTS) {
  await send("Page.navigate", { url: t.url });
  await sleep(900); // let popup.js settle (draft restore is a storage callback)
  const res = await send("Runtime.evaluate", {
    expression: `(async()=>eval(await (await fetch('/scripts/${t.file}')).text()))()`,
    awaitPromise: true, returnByValue: true,
  });
  if (res.exceptionDetails) {
    console.log(`FAIL ${t.name}: threw ${JSON.stringify(res.exceptionDetails.exception?.description || "").slice(0, 200)}`);
    failed++;
    continue;
  }
  let got;
  try { got = JSON.parse(res.result.value); }
  catch (e) { console.log(`FAIL ${t.name}: no JSON result (${e.message})`); failed++; continue; }
  for (const [k, want] of Object.entries(t.expect || {})) {
    const pass = got[k] === want;
    console.log(`${pass ? "PASS" : "FAIL"} ${t.name}.${k}${pass ? "" : `: got ${JSON.stringify(got[k])} want ${JSON.stringify(want)}`}`);
    if (!pass) failed++;
  }
  if (t.expectAllTrue) {
    // boolean assertions must be true; numeric counters are only echoed —
    // the test's own derived assertions (e.g. noRedundantWrite) judge them
    const bools = Object.entries(got).filter(([, v]) => typeof v === "boolean");
    const bad = bools.filter(([, v]) => v !== true);
    for (const [k] of bad) { console.log(`FAIL ${t.name}.${k}`); failed++; }
    if (!bad.length) console.log(`PASS ${t.name} (${bools.length} boolean assertions; echoed: ${Object.entries(got).filter(([, v]) => typeof v !== "boolean").map(([k, v]) => k + "=" + v).join(",") || "none"})`);
  }
}

ws.close();
chrome.kill();
server.close();
await sleep(600); // let chrome release the profile dir on Windows
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(failed ? `\n${failed} FAILED` : "\nall behavior tests passed");
process.exit(failed ? 1 : 0);

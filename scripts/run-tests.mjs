#!/usr/bin/env node
// Headless behavior tests for the popup, dashboard, and background: serves the
// repo over HTTP, drives headless Chrome over CDP, and evals scripts/*-test.js
// against the real dev harnesses (chrome.* stubs). Any assertion failure exits
// non-zero — this is the CI gate for drafts/settings that never lose the
// user's work, a dashboard that can reveal large result sets, and the capped
// background log restating its skipped counts.
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
// Headless Chrome reports prefers-reduced-motion: reduce, and popup.css then
// force-disables every animation. Tests that assert on animation state would
// read "none" either way, so emulate the motion preference the product
// actually ships with.
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});

const SEED = "https://seed.example.com/seed.zip";
const TYPED = "https://typed.example.com/x.zip\nhttps://typed.example.com/y.zip";
const RUNNING = encodeURIComponent(JSON.stringify({
  running: true, paused: false, stats: { total: 2, ok: 0, fail: 0 },
  failed: 0, log: [], dropped: 0, pendingResume: 0,
}));
const RESUMABLE = encodeURIComponent(JSON.stringify({
  running: false, paused: false, stats: { total: 0, ok: 0, fail: 0 },
  failed: 0, log: [], dropped: 0, pendingResume: 2,
}));
const SAVED_FULL = encodeURIComponent(JSON.stringify({
  running: false, paused: false, stats: { total: 2, ok: 2, fail: 0 },
  failed: 0, log: [], dropped: 0, pendingResume: 0,
  folder: "BatchDL/2026-10-27",
  entries: { u0: { label: "alpha.txt", status: "ok" }, u1: { label: "beta.txt", status: "ok" } },
}));
const RACE_SEED = encodeURIComponent(JSON.stringify({ concurrency: 3, delay: 500, subfolder: false }));
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
  {
    name: "url-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}`,
    file: "url-test.js",
    expect: { label: "Start Download · 2", bomAccepted: true },
  },
  {
    name: "csv-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}`,
    file: "csv-test.js",
    expect: {
      value: "https://example.com/a.pdf\nhttps://example.com/b.pdf?x=1,2\n",
      label: "Start Download · 2",
      hasHeader: false,
      a: true,
      b: true,
      lines: 2,
    },
  },
  {
    name: "pause-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&state=${RUNNING}`,
    file: "pause-test.js",
    expect: {
      pauseVisible: true,
      pauseText: "Pause",
      resumeHidden: true,
      retryHidden: true,
      urlsDisabled: true,
      pauseSent: true,
    },
  },
  {
    name: "paused-state-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&state=${RUNNING}`,
    file: "paused-state-test.js",
    expect: {
      runningLed: "lampblink",
      runningBelt: "convey",
      pausedLed: "none",
      pausedBelt: "none",
      bodyPaused: true,
    },
  },
  {
    name: "draft-running-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&draft=${encodeURIComponent("https://next.example.com/n.zip")}&state=${RUNNING}`,
    file: "draft-running-test.js",
    expect: {
      whileRunning: "",
      disabledWhileRunning: true,
      pauseVisible: true,
      afterFinish: "https://next.example.com/n.zip",
      labelAfterFinish: "Start Download · 1",
      enabledAfterFinish: true,
    },
  },
  {
    name: "resume-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&state=${RESUMABLE}`,
    file: "resume-test.js",
    expect: {
      dismiss: "Discard",
      resume: "Resume",
      barVisible: true,
      doorVisible: true,
    },
  },
  {
    name: "settings-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}`,
    file: "settings-test.js",
    expect: {
      savedC: 3,
      savedD: 500,
      savedFolder: true,
      hiddenC: 200,
      hiddenD: 10000,
      folderOff: false,
      startC: 200,
      startD: 10000,
      startSubfolder: false,
      inputC: "200",
      inputD: "10000",
      startSent: true,
    },
  },
  {
    name: "settings-race-hidden-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&syncSlow=1500&sync=${RACE_SEED}`,
    file: "settings-race-hidden-test.js",
    expect: {
      beforeC: "10",
      beforeD: "0",
      beforeF: true,
      savedAfterHide: null,
      afterC: "3",
      afterD: "500",
      afterF: false,
      savedAfterLoad: null,
    },
  },
  {
    name: "settings-race-edit-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&syncSlow=1500&sync=${RACE_SEED}`,
    file: "settings-race-edit-test.js",
    expect: {
      savedAfterEdit: "7/600/true",
      afterC: "7",
      afterD: "600",
      afterF: true,
      savedAfterLoad: "7/600/true",
    },
  },
  {
    name: "settings-race-start-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness.html?ci=${Date.now()}&syncSlow=1500&sync=${RACE_SEED}`,
    file: "settings-race-start-test.js",
    expect: {
      beforeStartSent: false,
      startSent: true,
      startC: 3,
      startD: 500,
      startSubfolder: false,
      inputC: "3",
      inputD: "500",
    },
  },
  {
    name: "background-log-test",
    url: `http://127.0.0.1:${PORT}/scripts/background-harness.html?ci=${Date.now()}`,
    file: "background-log-test.js",
    expect: {
      smallLen: 3,
      largeLast: "Skipped 2 invalid URL(s)|Skipped 1 duplicate URL(s)",
      boundaryInv: 1,
      boundaryDup: 1,
      boundaryLen: 2,
    },
  },
  {
    name: "more-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness-dash.html?ci=${Date.now()}&big=401`,
    file: "more-test.js",
    expect: {
      beforeRows: 400,
      moreText: "Show more · 1",
      moreVisible: true,
      afterRows: 401,
      moreHidden: true,
    },
  },
  {
    name: "saved-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness-dash.html?ci=${Date.now()}&full=${SAVED_FULL}`,
    file: "saved-test.js",
    expect: {
      visible: true,
      hasFolder: true,
      rows: 2,
    },
  },
  {
    name: "sync-test",
    url: `http://127.0.0.1:${PORT}/scripts/dev-harness-dash.html?ci=${Date.now()}`,
    file: "sync-test.js",
    expect: {
      afterRapidNow: 0,
      afterRapid: 1,
      afterHidden: 1,
      afterVisible: 2,
      afterFinal: 3,
      rows: 2,
      finalOk: "2",
    },
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

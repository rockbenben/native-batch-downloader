// Real-install smoke test: loads this repo as an unpacked extension in a
// throwaway Chrome profile, then verifies through CDP that the service worker
// registers, the context menu exists, the dashboard's getFull round-trips
// with v2 entries, and the popup renders idle state (door hidden).
//
//   node scripts/smoke.mjs        (CHROME=/path/to/browser to override)
//
// Requires Chrome for Testing or another build that honors --load-extension
// (branded stable Chrome >= 137 ignores it). Local gate only: CI runners
// carry the same branded-Chrome restriction.
//
// Chrome gotchas this script routes around:
//  - Chrome's built-in "Gemini in Chrome" component also owns a
//    background.js service worker; candidates are claimed by checking
//    the manifest version through one of OUR extension pages.
//  - A dormant MV3 service worker has no execution context; we identify
//    via an open extension page instead, and the popup's own message
//    wakes the worker for the contextMenus probe.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHROME =
  process.env.CHROME ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");
const PORT = 9500 + (process.pid % 200);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nbd-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEMINI = "admccjkmockfdflocgggjfgdacdodkdf"; // Chrome's own background.js owner
const EXPECT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;

const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  return ok;
};

const ws = { sock: null, pending: new Map(), id: 0 };
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const i = ++ws.id;
    const msg = { id: i, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.pending.set(i, { res, rej });
    ws.sock.send(JSON.stringify(msg));
    setTimeout(() => {
      if (ws.pending.has(i)) { ws.pending.delete(i); rej(new Error(`${method} timeout`)); }
    }, 15000);
  });
}
async function evalIn(sessionId, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) {
    return { err: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 160) };
  }
  return r.result && r.result.value;
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, "--no-first-run",
    `--load-extension=${ROOT}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    let ver = null;
    for (let i = 0; i < 60 && !ver; i++) {
      await sleep(250);
      try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch {}
    }
    if (!ver) throw new Error("chrome devtools endpoint never came up");
    ws.sock = new WebSocket(ver.webSocketDebuggerUrl);
    ws.sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && ws.pending.has(m.id)) {
        const p = ws.pending.get(m.id); ws.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
    await new Promise((r) => (ws.sock.onopen = r));

    // Claim our extension by opening each candidate's dashboard page and
    // reading its manifest version (pages are live even while the SW sleeps).
    let extId = null, dashSession = null;
    const tried = new Set();
    for (let i = 0; i < 40 && !extId; i++) {
      await sleep(400);
      let list = [];
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { continue; }
      const ids = [...new Set(
        list.filter((t) => /chrome-extension:\/\/[^/]+\/background\.js$/.test(t.url))
            .map((t) => t.url.split("/")[2]),
      )].filter((x) => x !== GEMINI && !tried.has(x));
      if (!ids.length && tried.size && i > 20) break;
      for (const cand of ids) {
        tried.add(cand);
        try {
          const { targetId } = await send("Target.createTarget", { url: `chrome-extension://${cand}/dashboard.html` });
          const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
          await send("Runtime.enable", {}, sessionId);
          let mv = null;
          for (let k = 0; k < 12; k++) {
            await sleep(400);
            mv = await evalIn(sessionId, `chrome.runtime && chrome.runtime.getManifest() ? chrome.runtime.getManifest().version : null`);
            if (typeof mv === "string") break;
          }
          if (mv === EXPECT_VERSION) { extId = cand; dashSession = sessionId; break; }
          await send("Target.closeTarget", { targetId });
        } catch {}
      }
    }
    if (!check("extension installed & dashboard loads", !!extId, extId || "never loaded — branded Chrome ignores --load-extension; use Chrome for Testing (CHROME=...)")) {
      throw new Error("extension never loaded");
    }

    const dash = await evalIn(dashSession, `(async () => {
      const full = await new Promise(res => chrome.runtime.sendMessage({ cmd: "getFull" }, res));
      return { title: document.title,
        fullOk: !!(full && full.state && full.state.entries),
        menuApi: typeof chrome.contextMenus?.update === "function" };
    })()`);
    check("dashboard: getFull round-trips v2 entries via real SW", dash && dash.fullOk, JSON.stringify(dash));
    check("dashboard: localized title", dash && dash.title && dash.title.length > 3, dash && dash.title);

    // contextMenus entry: the popup's getState message has woken the worker.
    let menuProbe = null;
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const swT = list.find((x) => x.type === "service_worker" && x.url.includes(extId) && x.url.endsWith("/background.js"));
      if (swT) {
        const { sessionId } = await send("Target.attachToTarget", { targetId: swT.id, flatten: true });
        await send("Runtime.enable", {}, sessionId);
        menuProbe = await evalIn(sessionId, `chrome.contextMenus.update("addlink", { enabled: true }).then(() => ({ ok: true })).catch((e) => ({ ok: false, err: String(e && e.message || e) }))`);
      }
    } catch {}
    check("SW: context menu addlink registered", menuProbe && menuProbe.ok === true, JSON.stringify(menuProbe));

    const { targetId: popT } = await send("Target.createTarget", { url: `chrome-extension://${extId}/popup.html` });
    const { sessionId: popS } = await send("Target.attachToTarget", { targetId: popT, flatten: true });
    await send("Runtime.enable", {}, popS);
    let v = null;
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      v = await evalIn(popS, `(async () => {
        try {
          const st = await new Promise(res => chrome.runtime.sendMessage({ cmd: "getState" }, res));
          return { href: location.href,
            got: !!(st && st.state), idle: !!(st && st.state && !st.state.running && st.state.stats.total === 0),
            logOk: Array.isArray(st && st.state && st.state.log),
            doorHidden: document.getElementById("dashBtn") ? document.getElementById("dashBtn").hidden : "no-el" };
        } catch (e) { return { err: e.message, href: location.href }; }
      })()`);
      if (v && v.href && v.href.includes("popup.html") && !v.err && v.got) break;
    }
    check("popup: getState round-trip via real SW", v && v.got && v.idle && v.logOk, JSON.stringify(v));
    check("popup: dashboard door hidden while idle", v && v.doorHidden === true);
  } finally {
    ws.sock && ws.sock.close();
    chrome.kill();
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch {}
    }
  }
  const fails = results.filter((l) => l.startsWith("FAIL")).length;
  console.log(results.join("\n"));
  console.log(fails ? `SMOKE FAIL (${fails})` : "SMOKE PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error("SMOKE FAIL", e.message); process.exit(1); });

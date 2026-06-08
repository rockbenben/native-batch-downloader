// background.js — batch download queue running in the MV3 service worker.
// The queue keeps running after the popup is closed; the popup is a pure view
// that syncs state on open and receives live updates while it is open.

const M = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

const LOG_CAP = 500;

// In-memory state, mirrored to chrome.storage.session so it survives a
// service-worker restart. `launching` is the count of downloads whose
// chrome.downloads.download callback has not yet returned an id; it reserves
// concurrency slots and is intentionally NOT persisted.
let state = null;
let statePromise = null;
let launching = 0;
let epoch = 0; // batch generation; bumped on every start/stop so stale download() callbacks can be ignored

function blankState() {
  return {
    running: false,
    aborted: false,
    concurrency: 1,
    delay: 0,
    stats: { total: 0, ok: 0, fail: 0 },
    queue: [],   // URLs not yet started
    active: {},  // downloadId -> label
    log: [],     // {text, cls}, oldest first
    dropped: 0,  // count of log entries trimmed off the front (for the view's delta)
  };
}

function loadState() {
  if (state) return Promise.resolve(state);
  // Cache the in-flight promise so concurrent events (e.g. two onChanged firing
  // on a cold worker) share ONE load and the SAME state object — otherwise each
  // builds its own snapshot and the last persist() wins, losing updates and
  // stranding entries in `active` (which hangs the batch).
  if (!statePromise) {
    statePromise = chrome.storage.session.get("dlState").then((stored) => {
      state = stored.dlState || blankState();
      return state;
    });
  }
  return statePromise;
}

function persist() {
  chrome.storage.session.set({ dlState: state });
}

function publicState() {
  return { running: state.running, stats: state.stats, log: state.log, dropped: state.dropped || 0 };
}

function broadcast() {
  // Rejects with "Receiving end does not exist" when no popup is open — ignore.
  chrome.runtime.sendMessage({ evt: "sync", state: publicState() }).catch(() => {});
}

function pushLog(text, cls) {
  state.log.push({ text, cls });
  if (state.log.length > LOG_CAP) {
    const drop = state.log.length - LOG_CAP;
    state.dropped += drop;
    state.log.splice(0, drop);
  }
}

function activeCount() {
  return Object.keys(state.active).length;
}

function filenameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").pop();
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    return (decoded.includes("/") || decoded.includes("\\")) ? null : decoded;
  } catch {
    return null;
  }
}

function startDownload(url) {
  const filename = filenameFromUrl(url);
  const opts = { url, saveAs: false };
  // Only override Chrome's own naming (Content-Disposition / URL) when the URL
  // path actually looks like a filename — otherwise we'd clobber a good
  // server-provided name with an extension-less path segment.
  if (filename && filename.includes(".")) opts.filename = filename;
  const label = filename || url;
  const myEpoch = epoch;
  pushLog(`${M("downloading")}: ${label}`, "info");

  chrome.downloads.download(opts, (downloadId) => {
    if (myEpoch !== epoch) {
      // batch was stopped/replaced before this callback ran — cancel and ignore
      if (!chrome.runtime.lastError && downloadId != null) {
        chrome.downloads.cancel(downloadId, () => void chrome.runtime.lastError);
      }
      return;
    }
    launching--;
    if (chrome.runtime.lastError) {
      state.stats.fail++;
      pushLog(`${label}  — ${chrome.runtime.lastError.message}`, "err");
      onSettle();
      return;
    }
    state.active[downloadId] = label;
    persist();
    broadcast();
  });
}

function pump() {
  if (!state.running) return;
  while (!state.aborted && activeCount() + launching < state.concurrency && state.queue.length) {
    launching++;
    startDownload(state.queue.shift());
  }
  persist();
  broadcast();
}

function onSettle() {
  persist();
  broadcast();
  if (state.aborted) {
    checkDone();
    return;
  }
  if (state.delay > 0 && state.queue.length) {
    setTimeout(() => {
      pump();
      checkDone();
    }, state.delay);
  } else {
    pump();
    checkDone();
  }
}

function checkDone() {
  if (!state.running) return;
  if (activeCount() === 0 && launching === 0 && (state.aborted || state.queue.length === 0)) {
    state.running = false;
    if (state.aborted) {
      pushLog(M("stopped"), "err");
    } else {
      pushLog(M("doneAll", state.stats.ok, state.stats.fail), state.stats.fail ? "err" : "ok");
    }
    persist();
    broadcast();
  }
}

function start({ urls, concurrency, delay, invalid = 0, dups = 0 }) {
  if (state.running) return; // a batch is already in progress; don't clobber it
  state.running = true;
  state.aborted = false;
  launching = 0;
  epoch++;
  state.concurrency = Math.max(1, Math.min(200, concurrency || 1));
  state.delay = Math.max(0, delay || 0);
  state.stats = { total: urls.length, ok: 0, fail: 0 };
  state.queue = urls.slice();
  state.active = {};
  state.log = [];
  state.dropped = 0;
  pushLog(M("startLog", urls.length, state.concurrency), "info");
  if (invalid || dups) pushLog(M("filtered", invalid, dups), "info");
  persist();
  broadcast();
  pump();
}

function stop() {
  if (!state.running) return;
  state.aborted = true;
  epoch++;
  state.queue = [];
  // Cancel in-flight downloads (best-effort) and finalize the batch right here.
  // Relying on each cancellation's onChanged event to re-enable Start is fragile:
  // one dropped/late event under heavy load would leave the batch stuck running.
  const ids = Object.keys(state.active).map(Number);
  for (const id of ids) {
    chrome.downloads.cancel(id, () => void chrome.runtime.lastError);
  }
  state.stats.fail += ids.length + launching;
  state.active = {};
  launching = 0;
  state.running = false;
  pushLog(M("stopped"), "err");
  persist();
  broadcast();
}

chrome.downloads.onChanged.addListener(async (delta) => {
  await loadState();
  if (!delta.state || !(delta.id in state.active)) return;
  const label = state.active[delta.id];
  if (delta.state.current === "complete") {
    state.stats.ok++;
    pushLog(label, "ok");
    delete state.active[delta.id];
    onSettle();
  } else if (delta.state.current === "interrupted") {
    state.stats.fail++;
    pushLog(`${label}  — ${M("interrupted")}`, "err");
    delete state.active[delta.id];
    onSettle();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await loadState();
    if (msg.cmd === "start") {
      start(msg);
      sendResponse({ ok: true });
    } else if (msg.cmd === "stop") {
      stop();
      sendResponse({ ok: true });
    } else if (msg.cmd === "getState") {
      sendResponse({ state: publicState() });
      // Resume a queue that paused because the worker was evicted during a
      // post-download delay gap (no in-flight download left to wake it).
      if (state.running && activeCount() === 0 && launching === 0 && state.queue.length) {
        pump();
      }
    }
  })();
  return true; // keep the message channel open for the async response
});

// No startup reconciliation is needed: when the service worker is suspended
// mid-batch, chrome.storage.session keeps the state and Chrome redelivers any
// downloads.onChanged events to the woken worker (the listener is registered at
// top level), so completions are processed normally and the queue resumes via
// onSettle -> pump. An extra reconcile pass here would double-count the very
// download whose onChanged event woke the worker.

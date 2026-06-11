// background.js — batch download queue running in the MV3 service worker.
// The queue keeps running after the popup is closed; the popup is a pure view
// that syncs state on open and receives live updates while it is open.

const M = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

const LOG_CAP = 500;

// Sun-yellow on ink, matching the popup's "running" lamp — the icon itself is
// cobalt, so a cobalt badge would blend straight into it.
chrome.action.setBadgeBackgroundColor({ color: "#f5b80c" });
chrome.action.setBadgeTextColor({ color: "#20242e" });

// In-memory state, mirrored to chrome.storage.session so it survives a
// service-worker restart. `launching` is the count of downloads whose
// chrome.downloads.download callback has not yet returned an id; it reserves
// concurrency slots and is intentionally NOT persisted.
let state = null;
let statePromise = null;
let launching = 0;
let epoch = 0; // batch generation; bumped on every start/stop so stale download() callbacks can be ignored
let nextLaunchTimer = null; // pending inter-launch gap timer (delay mode)
let lastLaunch = -Infinity; // Date.now() of the most recent launch, for min-gap spacing
// URLs whose download() callback hasn't returned yet (companion to `launching`,
// also not persisted). Lets stop() record them as failed, and lets
// onDeterminingFilename claim a download that races ahead of our callback.
let launchingUrls = new Set();

function blankState() {
  return {
    running: false,
    concurrency: 1,
    delay: 0,
    folder: null, // "BatchDL/YYYY-MM-DD" when this batch saves into a subfolder
    stats: { total: 0, ok: 0, fail: 0 },
    queue: [],   // URLs not yet started
    active: {},  // downloadId -> {url, label}
    failed: [],  // URLs that errored, were interrupted, or were abandoned by Stop
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
  return {
    running: state.running,
    stats: state.stats,
    failed: state.failed.length,
    log: state.log,
    dropped: state.dropped || 0,
  };
}

// Remaining count on the toolbar icon, so progress is visible with the popup
// closed; cleared when the batch ends.
function updateBadge() {
  const remaining = state.stats.total - state.stats.ok - state.stats.fail;
  const text = state.running ? (remaining > 999 ? "999+" : String(remaining)) : "";
  chrome.action.setBadgeText({ text });
}

function broadcast() {
  updateBadge();
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
    // Names that chrome.downloads.download rejects in `filename` with
    // "Invalid filename" (net::IsSafePortableBasename): illegal characters
    // (e.g. a %3A colon in "report 12:30.pdf"), a trailing dot/space, or a
    // Windows reserved device name ("aux.pdf" — a real French word). Without
    // an override Chrome sanitizes and succeeds, so fall back to its naming
    // rather than turning a downloadable URL into a failure.
    if (
      /[\/\\:*?"<>|\x00-\x1f]/.test(decoded) ||
      /[. ]$/.test(decoded) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(decoded)
    ) {
      return null;
    }
    return decoded;
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
  launchingUrls.add(url);

  chrome.downloads.download(opts, (downloadId) => {
    if (myEpoch !== epoch) {
      // batch was stopped/replaced before this callback ran — cancel and ignore
      if (!chrome.runtime.lastError && downloadId != null) {
        chrome.downloads.cancel(downloadId, () => void chrome.runtime.lastError);
      }
      return;
    }
    launching--;
    launchingUrls.delete(url);
    if (chrome.runtime.lastError) {
      state.stats.fail++;
      state.failed.push(url);
      pushLog(`${label}  — ${chrome.runtime.lastError.message}`, "err");
      onSettle();
      return;
    }
    state.active[downloadId] = { url, label };
    persist();
    broadcast();
  });
}

// Launch as many queued downloads as concurrency allows. With a delay set,
// every launch (including the first batch) is spaced at least `delay` ms from
// the previous one — the point of the delay is rate-limit politeness, which an
// initial all-at-once burst would defeat. `lastLaunch`/the timer are not
// persisted: after a worker restart the next pump launches immediately, which
// only shortens one gap.
function pump() {
  if (!state.running) return;
  while (activeCount() + launching < state.concurrency && state.queue.length) {
    if (state.delay > 0) {
      const wait = lastLaunch + state.delay - Date.now();
      if (wait > 0) {
        scheduleNextLaunch(wait);
        break;
      }
      lastLaunch = Date.now();
    }
    launching++;
    startDownload(state.queue.shift());
  }
  persist();
  broadcast();
}

function scheduleNextLaunch(wait) {
  if (nextLaunchTimer) return;
  const myEpoch = epoch;
  nextLaunchTimer = setTimeout(() => {
    nextLaunchTimer = null;
    if (myEpoch !== epoch) return;
    pump();
    checkDone();
  }, wait);
}

function clearNextLaunch() {
  if (nextLaunchTimer) {
    clearTimeout(nextLaunchTimer);
    nextLaunchTimer = null;
  }
}

function onSettle() {
  persist();
  broadcast();
  pump();
  checkDone();
}

function checkDone() {
  if (!state.running) return;
  if (activeCount() === 0 && launching === 0 && state.queue.length === 0) {
    state.running = false;
    pushLog(M("doneAll", state.stats.ok, state.stats.fail), state.stats.fail ? "err" : "ok");
    persist();
    broadcast();
  }
}

function start({ urls, concurrency, delay, invalid = 0, dups = 0, subfolder = false }) {
  if (state.running) return; // a batch is already in progress; don't clobber it
  state.running = true;
  launching = 0;
  launchingUrls.clear();
  epoch++;
  clearNextLaunch();
  lastLaunch = -Infinity;
  state.concurrency = Math.max(1, Math.min(200, concurrency || 1));
  state.delay = Math.max(0, Math.min(10000, delay || 0));
  // Local date, not toISOString's UTC — for UTC+N users a morning batch would
  // otherwise be filed under yesterday's folder.
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  state.folder = subfolder ? `BatchDL/${ymd}` : null;
  state.stats = { total: urls.length, ok: 0, fail: 0 };
  state.queue = urls.slice();
  state.active = {};
  state.failed = [];
  state.log = [];
  state.dropped = 0;
  pushLog(M("startLog", urls.length, state.concurrency), "info");
  if (invalid) pushLog(M("skippedInvalid", invalid), "info");
  if (dups) pushLog(M("skippedDuplicate", dups), "info");
  persist();
  broadcast();
  pump();
}

function stop() {
  if (!state.running) return;
  epoch++;
  clearNextLaunch();
  // Queued-but-never-started URLs are abandoned by Stop; count them as failed
  // too, otherwise ok + fail < total and the view shows a phantom "waiting" with
  // a progress bar that never fills. They all go into `failed` so Retry can
  // pick the whole abandoned set back up.
  const queued = state.queue.length;
  state.failed.push(...state.queue);
  state.queue = [];
  // Cancel in-flight downloads (best-effort) and finalize the batch right here.
  // Relying on each cancellation's onChanged event to re-enable Start is fragile:
  // one dropped/late event under heavy load would leave the batch stuck running.
  const ids = Object.keys(state.active).map(Number);
  for (const id of ids) {
    chrome.downloads.cancel(id, () => void chrome.runtime.lastError);
    state.failed.push(state.active[id].url);
  }
  state.stats.fail += ids.length + launching + queued;
  state.failed.push(...launchingUrls);
  launchingUrls.clear();
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
  const { url, label } = state.active[delta.id];
  if (delta.state.current === "complete") {
    state.stats.ok++;
    pushLog(label, "ok");
    delete state.active[delta.id];
    onSettle();
  } else if (delta.state.current === "interrupted") {
    state.stats.fail++;
    state.failed.push(url);
    pushLog(`${label}  — ${M("interrupted")}`, "err");
    delete state.active[delta.id];
    onSettle();
  }
});

// Route this batch's files into the dated subfolder. Matching by id covers the
// normal case; matching by URL covers the race where Chrome determines the
// filename before our download() callback has delivered the id.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  loadState().then(() => {
    const ours = item.id in state.active || launchingUrls.has(item.url);
    if (ours && state.folder) {
      suggest({ filename: `${state.folder}/${item.filename}`, conflictAction: "uniquify" });
    } else {
      suggest();
    }
  });
  return true; // async suggest
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
    } else if (msg.cmd === "retry") {
      // Re-queue everything that failed, with the same settings as the batch
      // that produced the failures.
      if (!state.running && state.failed.length) {
        start({
          urls: [...new Set(state.failed)],
          concurrency: state.concurrency,
          delay: state.delay,
          subfolder: !!state.folder,
        });
      }
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

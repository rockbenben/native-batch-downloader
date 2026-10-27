// background.js — batch download queue running in the MV3 service worker.
// The queue keeps running after the popup is closed; the popup and the
// dashboard tab are pure views that sync state on open and receive live
// updates while they are open.

const M = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

const LOG_CAP = 500;
const STATE_V = 2; // entries-based state shape; older session payloads are discarded

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
// A committed batch mirror in storage.local, offered back after a browser
// restart. Download ids cannot survive a restart, so every unfinished URL is
// mirrored — queued, launching, and in-flight alike. Chrome leaves an
// interrupted download behind but never resumes it for us; offering the URL
// back is the only way the file isn't silently lost. Resuming is always the
// user's choice.
let pendingResume = null;
let pendingResumePromise = chrome.storage.local.get("dlResume").then((s) => {
  pendingResume = s.dlResume && s.dlResume.v === STATE_V && (s.dlResume.queue || []).length ? s.dlResume : null;
  return pendingResume;
});

function blankState() {
  return {
    v: STATE_V,
    running: false,
    paused: false,
    concurrency: 1,
    delay: 0,
    folder: null, // "BatchDL/YYYY-MM-DD" when this batch saves into a subfolder
    stats: { total: 0, ok: 0, fail: 0 },
    queue: [],    // URLs not yet started
    active: {},   // downloadId -> {url, label}
    entries: {},  // url -> {label, status: wait|active|ok|fail, reason?}
    log: [],      // {text, cls}, oldest first
    dropped: 0,   // count of log entries trimmed off the front (for the view's delta)
    invalid: 0,   // skipped non-URL lines from this batch's input
    dups: 0,      // skipped duplicate URLs from this batch's input
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
      state = stored.dlState && stored.dlState.v === STATE_V ? stored.dlState : blankState();
      return state;
    });
  }
  return statePromise;
}

function persist() {
  chrome.storage.session.set({ dlState: state });
}

function failCount() {
  let n = 0;
  for (const url in state.entries) if (state.entries[url].status === "fail") n++;
  return n;
}

function publicState() {
  return {
    running: state.running,
    paused: state.paused,
    stats: state.stats,
    failed: failCount(),
    log: state.log,
    dropped: state.dropped || 0,
    pendingResume: pendingResume ? pendingResume.queue.length : 0,
    folder: state.folder,
  };
}

// Remaining count on the toolbar icon, so progress is visible with the popup
// closed; cleared when the batch ends.
function updateBadge() {
  const remaining = state.stats.total - state.stats.ok - state.stats.fail;
  const paused = state.running && state.paused;
  // "II" reads as a pause key at toolbar size; the remaining count returns on
  // resume. The action title spells it out and restores the extension name.
  const text = state.running
    ? (paused ? "II" : remaining > 999 ? "999+" : String(remaining))
    : "";
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({ title: paused ? M("paused") : M("extName") });
}

let broadcastTimer = null;
function broadcastNow() {
  updateBadge();
  // Rejects with "Receiving end does not exist" when no view is open — ignore.
  chrome.runtime.sendMessage({ evt: "sync", state: publicState() }).catch(() => {});
}
function broadcast() {
  // Running updates are coalesced: a 405-file batch was producing 1601 full
  // dashboard fetches. A finished/stopped state is what the user is waiting
  // for, so send that one immediately.
  if (!state.running) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
    broadcastNow();
    return;
  }
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastNow();
  }, 150);
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

// -- restart-resume mirror --
let mirrorTimer = null;
function unfinishedUrls() {
  const urls = state.queue.slice();
  for (const a of Object.values(state.active)) urls.push(a.url);
  for (const url of launchingUrls) urls.push(url);
  return urls;
}
function scheduleMirror() {
  clearTimeout(mirrorTimer);
  if (!state.running || !unfinishedUrls().length) {
    clearMirror();
    return;
  }
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    if (!state.running) {
      clearMirror();
      return;
    }
    const queue = unfinishedUrls();
    if (!queue.length) {
      clearMirror();
      return;
    }
    chrome.storage.local.set({
      dlResume: {
        v: STATE_V,
        queue,
        concurrency: state.concurrency,
        delay: state.delay,
        folder: state.folder,
      },
    });
  }, 1000);
}

function clearMirror() {
  clearTimeout(mirrorTimer);
  mirrorTimer = null;
  pendingResume = null;
  chrome.storage.local.remove("dlResume");
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

function markFail(url, reason) {
  const e = state.entries[url];
  if (e) {
    e.status = "fail";
    e.reason = reason;
  }
}

function startDownload(url) {
  const filename = filenameFromUrl(url);
  const opts = { url, saveAs: false };
  // Only override Chrome's own naming (Content-Disposition / URL) when the URL
  // path actually looks like a filename — otherwise we'd clobber a good
  // server-provided name with an extension-less path segment.
  if (filename && filename.includes(".")) opts.filename = filename;
  const label = (state.entries[url] && state.entries[url].label) || filename || url;
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
      markFail(url, chrome.runtime.lastError.message);
      pushLog(`${label}  — ${chrome.runtime.lastError.message}`, "err");
      onSettle();
      return;
    }
    state.active[downloadId] = { url, label };
    if (state.entries[url]) state.entries[url].status = "active";
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
  if (!state.running || state.paused) return;
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
  scheduleMirror();
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
  scheduleMirror();
  broadcast();
  pump();
  checkDone();
}

function checkDone() {
  if (!state.running) return;
  if (state.paused) return;
  if (activeCount() === 0 && launching === 0 && state.queue.length === 0) {
    state.running = false;
    // The log is the one place a closed-and-reopened popup still shows, so put
    // the destination here — "where did my files go" is otherwise unanswered.
    // LRM isolates the folder path as one LTR run under RTL locales.
    if (state.folder && state.stats.ok > 0) {
      pushLog(M("savedFolder", `\u200E${state.folder}\u200E`), "info");
    }
    repushSkippedIfTrimmed();
    pushLog(M("doneAll", state.stats.ok, state.stats.fail), state.stats.fail ? "err" : "ok");
    clearMirror();
    persist();
    broadcast();
  }
}

// The start log carries "Skipped N invalid/duplicate" at the front, which the
// 500-line cap can trim before a large batch finishes. Restate any count whose
// line is no longer present; checking the actual lines (not a dropped-count
// threshold) keeps both counts at the 500-line boundary and never duplicates a
// small batch's opening line.
function repushSkippedIfTrimmed() {
  const has = (text) => state.log.some((e) => e.text === text);
  if (state.invalid) {
    const text = M("skippedInvalid", state.invalid);
    if (!has(text)) pushLog(text, "info");
  }
  if (state.dups) {
    const text = M("skippedDuplicate", state.dups);
    if (!has(text)) pushLog(text, "info");
  }
}

function start({ urls, concurrency, delay, invalid = 0, dups = 0, subfolder = false, folder = null }) {
  if (state.running) return; // a batch is already in progress; don't clobber it
  state.running = true;
  state.paused = false;
  launching = 0;
  launchingUrls.clear();
  epoch++;
  clearNextLaunch();
  lastLaunch = -Infinity;
  state.concurrency = Math.max(1, Math.min(200, concurrency || 1));
  state.delay = Math.max(0, Math.min(10000, delay || 0));
  // Local date, not toISOString's UTC — for UTC+N users a morning batch would
  // otherwise be filed under yesterday's folder. Resume/retry pass the original
  // folder so a restart after midnight doesn't split one batch across two dates.
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  state.folder = folder || (subfolder ? `BatchDL/${ymd}` : null);
  state.stats = { total: urls.length, ok: 0, fail: 0 };
  state.queue = urls.slice();
  state.active = {};
  state.entries = {};
  for (const url of urls) state.entries[url] = { label: filenameFromUrl(url) || url, status: "wait" };
  state.log = [];
  state.dropped = 0;
  state.invalid = invalid;
  state.dups = dups;
  pushLog(M("startLog", urls.length, state.concurrency), "info");
  if (invalid) pushLog(M("skippedInvalid", invalid), "info");
  if (dups) pushLog(M("skippedDuplicate", dups), "info");
  persist();
  scheduleMirror();
  broadcast();
  pump();
}

function stop() {
  if (!state.running) return;
  epoch++;
  clearNextLaunch();
  const abandoned = M("stopped");
  // Queued-but-never-started URLs are abandoned by Stop; count them as failed
  // too, otherwise ok + fail < total and the view shows a phantom "waiting"
  // with a progress bar that never fills. They all stay in `entries` as fail
  // so Retry can pick the whole abandoned set back up.
  for (const url of state.queue) {
    state.stats.fail++;
    markFail(url, abandoned);
  }
  state.queue = [];
  // Cancel in-flight downloads (best-effort) and finalize the batch right here.
  // Relying on each cancellation's onChanged event to re-enable Start is fragile:
  // one dropped/late event under heavy load would leave the batch stuck running.
  for (const id of Object.keys(state.active)) {
    chrome.downloads.cancel(Number(id), () => void chrome.runtime.lastError);
    state.stats.fail++;
    markFail(state.active[id].url, abandoned);
  }
  for (const url of launchingUrls) {
    state.stats.fail++;
    markFail(url, abandoned);
  }
  launchingUrls.clear();
  state.active = {};
  launching = 0;
  state.running = false;
  state.paused = false;
  // Completed files stay on disk after a stop; say where they are too.
  if (state.folder && state.stats.ok > 0) {
    pushLog(M("savedFolder", `\u200E${state.folder}\u200E`), "info");
  }
  repushSkippedIfTrimmed();
  pushLog(M("stopped"), "err");
  clearMirror();
  persist();
  broadcast();
}

function pause() {
  if (!state.running || state.paused) return;
  state.paused = true;
  clearNextLaunch();
  pushLog(M("paused"), "info");
  persist();
  broadcast();
}

function resume() {
  if (!state.running || !state.paused) return;
  state.paused = false;
  pushLog(M("resumed"), "info");
  persist();
  broadcast();
  pump();
  checkDone();
}

chrome.downloads.onChanged.addListener(async (delta) => {
  await loadState();
  if (!delta.state || !(delta.id in state.active)) return;
  const { url, label } = state.active[delta.id];
  if (delta.state.current === "complete") {
    // Conflict uniquification (slow.bin -> slow (1).bin) happens after
    // onDeterminingFilename, so the finished DownloadItem is the only authority
    // for the name actually on disk. Ask for it before writing the row/log.
    const myEpoch = epoch;
    chrome.downloads.search({ id: delta.id }, (items) => {
      // Stop/new-batch may have settled this id while the search was in flight;
      // don't double-count it or resurrect a stopped row.
      if (myEpoch !== epoch || !(delta.id in state.active)) return;
      const saved = items && items[0] && items[0].filename;
      const finalLabel = (saved && saved.split(/[\\/]/).pop()) || label;
      state.stats.ok++;
      const e = state.entries[url];
      if (e) {
        e.status = "ok";
        if (finalLabel !== e.label) e.label = finalLabel;
        // The finished item's MIME is the reliable source (the determining
        // event races tiny files); mark a saved HTML page even if that missed.
        if (items && items[0] && (items[0].mime || "").startsWith("text/html")) e.web = true;
        if (e.web) {
          // A page URL "completes" as a saved .htm file, but it isn't the file
          // the user asked for. Keep the success count (the save did happen) and
          // attach a note they can act on instead of pretending nothing is off.
          e.reason = M("webPage");
          pushLog(M("webPage"), "info");
        }
      }
      pushLog(finalLabel, "ok");
      delete state.active[delta.id];
      onSettle();
    });
  } else if (delta.state.current === "interrupted") {
    state.stats.fail++;
    markFail(url, M("interrupted"));
    pushLog(`${label}  — ${M("interrupted")}`, "err");
    delete state.active[delta.id];
    onSettle();
  }
});

// Route this batch's files into the dated subfolder. Matching by id covers the
// normal case; matching by URL covers the race where Chrome determines the
// filename before our download() callback has delivered the id.
// This is also the first moment the real saved name and MIME exist: a server
// Content-Disposition can rename the file away from what the URL suggested, so
// the list and log follow item.filename here; completion later replaces it
// with Chrome's final conflict-uniquified name.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  loadState().then(() => {
    const ours = item.id in state.active || launchingUrls.has(item.url);
    if (ours) {
      const base = (item.filename || "").split(/[\\/]/).pop();
      let changed = false;
      const entry = state.entries[item.url];
      if (entry) {
        if (base && entry.label !== base) {
          entry.label = base;
          changed = true;
        }
        if (item.mime && item.mime.startsWith("text/html") && !entry.web) {
          entry.web = true;
          changed = true;
        }
      }
      const active = state.active[item.id];
      if (active && base && active.label !== base) {
        active.label = base;
        changed = true;
      }
      if (changed) {
        persist();
        broadcast();
      }
    }
    if (ours && state.folder) {
      suggest({ filename: `${state.folder}/${item.filename}`, conflictAction: "uniquify" });
    } else {
      suggest();
    }
  });
  return true; // async suggest
});

// Right-click a link anywhere: append it to the popup's draft list so a batch
// can be accumulated while browsing. No host permissions needed — the context
// menu hands us the link URL directly.
chrome.contextMenus.create(
  { id: "addlink", title: M("menuAddLink"), contexts: ["link"] },
  () => void chrome.runtime.lastError
);

chrome.contextMenus.onClicked.addListener(async (info) => {
  const url = info.linkUrl;
  if (!/^https?:\/\//i.test(url)) return;
  await loadState();
  const s = await chrome.storage.local.get("draft");
  const lines = (s.draft || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const added = !lines.includes(url);
  if (added) lines.push(url);
  await chrome.storage.local.set({ draft: lines.join("\n") });
  if (state.running) {
    // The badge shows the batch countdown — it can't also flash "+", so the
    // confirmation goes to the log the next time a surface opens.
    if (added) pushLog(M("queuedNext"), "info");
  } else {
    // A short "+" on the badge confirms the add without opening anything.
    chrome.action.setBadgeText({ text: "+" });
    setTimeout(() => {
      if (!state.running) chrome.action.setBadgeText({ text: "" });
    }, 900);
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
    } else if (msg.cmd === "pause") {
      pause();
      sendResponse({ ok: true });
    } else if (msg.cmd === "resume") {
      resume();
      sendResponse({ ok: true });
    } else if (msg.cmd === "retry") {
      // Re-queue everything that failed, with the same settings as the batch
      // that produced the failures.
      const failed = Object.keys(state.entries).filter((u) => state.entries[u].status === "fail");
      if (!state.running && failed.length) {
        start({
          urls: failed,
          concurrency: state.concurrency,
          delay: state.delay,
          subfolder: !!state.folder,
          folder: state.folder,
        });
      }
      sendResponse({ ok: true });
    } else if (msg.cmd === "resumeBatch") {
      const m = await pendingResumePromise;
      if (m && !state.running) {
        pendingResume = null;
        clearMirror();
        start({ urls: m.queue, concurrency: m.concurrency, delay: m.delay, subfolder: !!m.folder, folder: m.folder || null });
      }
      sendResponse({ ok: true });
    } else if (msg.cmd === "dismissResume") {
      pendingResume = null;
      clearMirror();
      broadcast();
      sendResponse({ ok: true });
    } else if (msg.cmd === "getState") {
      sendResponse({ state: publicState() });
      // Resume a queue that paused because the worker was evicted during a
      // post-download delay gap (no in-flight download left to wake it).
      if (state.running && !state.paused && activeCount() === 0 && launching === 0 && state.queue.length) {
        pump();
      }
    } else if (msg.cmd === "getFull") {
      sendResponse({ state: { ...publicState(), entries: state.entries } });
    } else if (msg.cmd === "bytes") {
      // On-demand byte totals: polling downloads.search only while a view asks
      // keeps the onChanged path free of per-chunk bookkeeping.
      const ids = Object.keys(state.active).map(Number);
      if (!ids.length) {
        sendResponse({ received: 0, total: 0 });
        return;
      }
      chrome.downloads.search({ id: ids }, (items) => {
        let received = 0;
        let total = 0;
        for (const it of items || []) {
          received += it.bytesReceived || 0;
          if (it.fileSize && it.fileSize > 0) total += it.fileSize;
        }
        sendResponse({ received, total });
      });
      return; // respond from the search callback
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

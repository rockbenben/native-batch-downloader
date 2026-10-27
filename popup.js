(() => {
  const $ = (s) => document.querySelector(s);
  const M = (key, ...subs) =>
    chrome.i18n.getMessage(key, subs.map(String)) || key;

  // -- i18n UI --
  // Chrome resolves @@bidi_dir to "rtl" for RTL UI locales (ar/fa/ur), "ltr"
  // otherwise; the extension must apply it itself — Chrome does not set page
  // direction from the UI locale automatically.
  document.documentElement.dir = M("@@bidi_dir");
  // Expose the UI locale to CSS :lang() — the SC/TC/JP/KR display-font
  // subsets overlap in the CJK ranges, so popup.html picks the family by lang.
  document.documentElement.lang = M("@@ui_locale").replace(/_/g, "-");

  document.title = M("extName");
  $("#titleText").textContent = M("title");
  $("#urls").placeholder = M("placeholder");
  $("#concLabel").textContent = M("concurrency");
  $("#delayLabel").textContent = M("delay");
  $("#stopBtn").textContent = M("stop");
  $("#folderLabel").textContent = M("subfolder");
  $("#folderDial").title = M("subfolderTip");
  $("#lblTotal").textContent = M("total");
  $("#lblOk").textContent = M("success");
  $("#lblFail").textContent = M("failed");
  $("#lblWait").textContent = M("remaining");

  const urlsEl = $("#urls");
  const startBtn = $("#startBtn");
  const stopBtn = $("#stopBtn");
  const retryBtn = $("#retryBtn");
  const popupPause = $("#popupPause");
  const popupResume = $("#popupResume");
  const dashBtn = $("#dashBtn");
  const tileFail = $("#tileFail");
  const resumeBar = $("#resumeBar");
  const resumeText = $("#resumeText");
  const resumeBtn = $("#resumeBtn");
  const resumeX = $("#resumeX");
  const concurrencyEl = $("#concurrency");
  const delayEl = $("#delay");
  const folderEl = $("#folder");
  let settingsLoaded = false;
  let settingsTouched = false;
  let pendingStart = false;

  // Settings persist across sessions. Save on change and when the popup hides,
  // not only on Start: a user who adjusts a dial and closes the popup expects
  // the value back. Start still saves, and writes the clamped value back to the
  // controls so the UI shows what will actually run (1-200 / 0-10000 ms).
  function readSettings() {
    const parsedConc = parseInt(concurrencyEl.value, 10);
    const parsedDelay = parseInt(delayEl.value, 10);
    return {
      concurrency: Math.max(1, Math.min(200, isNaN(parsedConc) ? 10 : parsedConc)),
      delay: Math.max(0, Math.min(10000, isNaN(parsedDelay) ? 0 : parsedDelay)),
      subfolder: folderEl.checked,
    };
  }
  function saveSettings() {
    // The sync load below is async; a popup hidden before it lands must not
    // write the HTML defaults (10/0/true) over the user's saved values.
    if (!settingsLoaded && !settingsTouched) return null;
    const settings = readSettings();
    chrome.storage.sync.set(settings);
    return settings;
  }
  chrome.storage.sync.get({ concurrency: 10, delay: 0, subfolder: true }, (s) => {
    // A user edit that raced the load wins; never overwrite it with stale data.
    if (!settingsTouched) {
      const parsedConc = parseInt(s.concurrency, 10);
      const parsedDelay = parseInt(s.delay, 10);
      concurrencyEl.value = Math.max(1, Math.min(200, isNaN(parsedConc) ? 10 : parsedConc));
      delayEl.value = Math.max(0, Math.min(10000, isNaN(parsedDelay) ? 0 : parsedDelay));
      folderEl.checked = !!s.subfolder;
    }
    settingsLoaded = true;
    if (pendingStart) {
      pendingStart = false;
      start();
    }
  });
  function markSettingsTouched(save) {
    settingsTouched = true;
    if (save) saveSettings();
  }
  concurrencyEl.addEventListener("input", () => markSettingsTouched(false));
  delayEl.addEventListener("input", () => markSettingsTouched(false));
  concurrencyEl.addEventListener("change", () => markSettingsTouched(true));
  delayEl.addEventListener("change", () => markSettingsTouched(true));
  folderEl.addEventListener("change", () => markSettingsTouched(true));
  const totalEl = $("#total");
  const okEl = $("#ok");
  const failEl = $("#fail");
  const waitEl = $("#wait");
  const beltEl = $("#belt");
  const barEl = $("#bar");
  const logEl = $("#log");

  urlsEl.setAttribute("aria-label", M("urlsAria"));
  beltEl.setAttribute("aria-label", M("progressAria"));
  tileFail.title = M("viewDetails");
  dashBtn.title = M("openDash");
  dashBtn.setAttribute("aria-label", M("openDash"));
  popupResume.textContent = M("resume");
  popupResume.title = M("paused");
  popupPause.textContent = M("pause");
  resumeBtn.textContent = M("resume");
  resumeX.textContent = M("resumeDismiss");

  let seenTotal = 0; // logical count of log entries already rendered (survives trimming)
  let seenDropped = 0; // how many trimmed front entries were already removed from the DOM

  // -- draft persistence --
  // An unstarted URL list is the user's accumulated work; losing it because the
  // popup closed (one stray click) or the browser restarted is brutal. Keep it
  // in storage.local — unlike session, that survives a browser exit — and
  // commit-clear on Start.
  let draftTimer = null;
  let draftCache = "";
  let currentRunning = null; // null until the first state arrives
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      chrome.storage.local.set({ draft: urlsEl.value });
    }, 250);
  }
  // The popup can die inside the debounce window (paste, then a stray click
  // closes it 100ms later) — exactly the loss this feature exists to prevent.
  // visibilitychange fires before teardown and extension API calls still go
  // through, so flush any pending save here. Guarded on draftTimer: after
  // Start commits the list, the timer is nulled and this must NOT resurrect
  // the cleared draft.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    if (draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
      chrome.storage.local.set({ draft: urlsEl.value });
    }
    // Also catches a dial edited just before the popup closed, even if the
    // input's change event never fired.
    saveSettings();
  });
  // Wait for BOTH the saved draft and a non-running state before restoring:
  // while a batch runs the editor is disabled, and restoring between those two
  // async results made the next-batch draft appear only sometimes. If the user
  // keeps the popup open, restore once the batch finishes instead.
  function maybeRestoreDraft() {
    if (currentRunning === false && draftCache && !urlsEl.value && !urlsEl.disabled) {
      urlsEl.value = draftCache;
      updateStartLabel();
    }
  }
  chrome.storage.local.get("draft", (d) => {
    draftCache = (d && d.draft) || "";
    maybeRestoreDraft();
  });

  // A line only counts if it is a complete http(s) URL with a host. The old
  // prefix-only test let "https://" through to Chrome, which then failed with a
  // raw English "Invalid URL" instead of the pre-flight invalid-line count.
  function validUrl(line) {
    const value = line.replace(/^\uFEFF/, "").trim();
    if (!/^https?:\/\//i.test(value)) return null;
    try {
      const u = new URL(value);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? value : null;
    } catch {
      return null;
    }
  }

  // CSV rows commonly wrap the URL in a column ("name,url") or quote it because
  // the query string contains a comma. Pull URL cells out instead of dumping
  // the raw row into the editor, where every header row became an invalid line.
  function csvCells(line) {
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else quoted = false;
        } else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === "," || c === ";" || c === "\t") {
        cells.push(cur);
        cur = "";
      } else cur += c;
    }
    cells.push(cur);
    return cells;
  }
  function urlsFromCsv(text) {
    const urls = [];
    for (const line of text.split(/\r?\n/)) {
      for (const cell of csvCells(line)) {
        const url = validUrl(cell);
        if (url) urls.push(url);
      }
    }
    return urls;
  }

  // Parse the textarea into the unique, valid URL list plus what was skipped.
  function parseInput() {
    const lines = urlsEl.value
      .split("\n")
      .map((l) => l.replace(/^\uFEFF/, "").trim())
      .filter(Boolean);
    // URL schemes are case-insensitive (RFC 3986), so HTTP:// / HTTPS:// are valid.
    const valid = lines.map(validUrl).filter(Boolean);
    const seen = new Set();
    const urls = [];
    for (const u of valid) if (!seen.has(u)) { seen.add(u); urls.push(u); }
    return { urls, invalid: lines.length - valid.length, dups: valid.length - urls.length };
  }

  // The Start button doubles as a pre-flight readout: it shows how many links
  // will actually be queued, so a paste is confirmed at a glance before committing.
  function updateStartLabel() {
    const n = parseInput().urls.length;
    startBtn.textContent = n ? `${M("start")} · ${n}` : M("start");
  }
  updateStartLabel();
  urlsEl.addEventListener("input", () => {
    draftCache = urlsEl.value;
    updateStartLabel();
    saveDraftSoon();
  });

  function logLine(text, cls) {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    logEl.prepend(d);
  }

  function renderState(st) {
    const done = st.stats.ok + st.stats.fail;
    totalEl.textContent = st.stats.total;
    okEl.textContent = st.stats.ok;
    failEl.textContent = st.stats.fail;
    waitEl.textContent = st.stats.total - done;
    const pct = st.stats.total ? Math.round((done / st.stats.total) * 100) : 0;
    barEl.style.width = `${pct}%`;
    beltEl.setAttribute("aria-valuenow", pct);

    startBtn.disabled = st.running;
    stopBtn.disabled = !st.running;
    urlsEl.disabled = st.running;
    currentRunning = st.running;
    // Concurrency/delay are read only at Start; lock them while running so the
    // controls don't appear to do something they can't.
    concurrencyEl.disabled = st.running;
    delayEl.disabled = st.running;
    folderEl.disabled = st.running;
    maybeRestoreDraft();
    // Offer a retry once the batch is over and something failed.
    const failed = st.failed || 0;
    retryBtn.hidden = st.running || !failed;
    retryBtn.textContent = `${M("retryFailed")} · ${failed}`;
    // The yellow service slot holds one action at a time: Pause while running,
    // Resume while paused, Retry after a finished batch with failures.
    popupPause.hidden = !st.running || st.paused;
    popupResume.hidden = !st.paused;
    document.body.classList.toggle("paused", !!st.paused);
    tileFail.setAttribute("aria-disabled", failed ? "false" : "true");
    const resumable = !st.running && (st.pendingResume || 0) > 0;
    resumeBar.hidden = !resumable;
    if (resumable) resumeText.textContent = M("resumeAsk", st.pendingResume);
    // The dashboard has nothing to show before a batch exists — opening it then
    // is an empty machine room, so the door stays hidden until there is state.
    dashBtn.hidden = !st.running && !st.paused && st.stats.total === 0 && !resumable;

    // Render by logical index so front-trimming of the capped log doesn't
    // desync the view. total = entries ever produced this run; st.log holds the
    // last (total - dropped) of them. A drop in total means a new run -> rebuild.
    const dropped = st.dropped || 0;
    const total = dropped + st.log.length;
    if (total < seenTotal) {
      logEl.innerHTML = "";
      seenTotal = 0;
      seenDropped = 0;
    }
    // The state log is capped; keep the DOM in step or an open popup keeps
    // showing entries the state already dropped (e.g. the original Skipped
    // line plus the end-of-batch restatement).
    if (dropped > seenDropped) {
      let remove = dropped - seenDropped;
      while (remove-- > 0 && logEl.lastElementChild) logEl.lastElementChild.remove();
      seenDropped = dropped;
    }
    for (let i = Math.max(seenTotal, dropped); i < total; i++) {
      const e = st.log[i - dropped];
      logLine(e.text, e.cls);
    }
    seenTotal = total;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.evt === "sync") renderState(msg.state);
  });

  chrome.runtime.sendMessage({ cmd: "getState" }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp && resp.state) renderState(resp.state);
  });

  function start() {
    // If Start is pressed before the async settings load lands, wait for it:
    // starting with the HTML defaults would both use and save the wrong settings.
    if (!settingsLoaded && !settingsTouched) {
      pendingStart = true;
      return;
    }
    settingsTouched = true;
    const { urls, invalid, dups } = parseInput();
    if (!urls.length) {
      logLine(M("noUrls"), "err");
      return;
    }
    // Locally-added lines (the "no URLs" error) aren't counted in seenTotal,
    // so the incoming batch's log would otherwise render above a stale error.
    logEl.innerHTML = "";
    seenTotal = 0;
    seenDropped = 0;
    // The list is committed to the batch now — drop the draft (and any save
    // still pending in the debounce window, which would resurrect it; null the
    // timer so the visibilitychange flush can't resurrect it either).
    clearTimeout(draftTimer);
    draftTimer = null;
    chrome.storage.local.remove("draft");
    draftCache = "";
    const settings = readSettings();
    concurrencyEl.value = settings.concurrency;
    delayEl.value = settings.delay;
    chrome.storage.sync.set(settings);
    chrome.runtime.sendMessage({ cmd: "start", urls, ...settings, invalid, dups });
  }

  startBtn.addEventListener("click", start);
  retryBtn.addEventListener("click", () => {
    retryBtn.hidden = true;
    chrome.runtime.sendMessage({ cmd: "retry" });
  });
  tileFail.addEventListener("click", () => {
    if (tileFail.getAttribute("aria-disabled") === "true") return;
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#failed") });
  });
  dashBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  popupPause.addEventListener("click", () => {
    chrome.runtime.sendMessage({ cmd: "pause" });
  });
  popupResume.addEventListener("click", () => {
    chrome.runtime.sendMessage({ cmd: "resume" });
  });
  resumeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ cmd: "resumeBatch" });
  });
  resumeX.addEventListener("click", () => {
    chrome.runtime.sendMessage({ cmd: "dismissResume" });
  });

  // -- drop a .txt/.csv of URLs anywhere on the popup --
  // Handlers live on document because disabled elements swallow no events and
  // a drop outside the textarea would otherwise navigate the popup.
  const MAX_DROP_BYTES = 5 * 1024 * 1024;
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!urlsEl.disabled) document.body.classList.add("dragging");
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.body.classList.remove("dragging");
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    if (urlsEl.disabled) return;
    const files = [...(e.dataTransfer?.files || [])].filter(
      (f) =>
        f.size <= MAX_DROP_BYTES &&
        // text files only — a mis-dropped PNG would flood the editor with
        // mojibake. Match MIME or extension: Windows registers .csv as
        // application/vnd.ms-excel when Excel is installed, and some sources
        // deliver no MIME type at all.
        (f.type.startsWith("text/") || /\.(txt|csv)$/i.test(f.name))
    );
    if (!files.length) return;
    const blocks = await Promise.all(
      files.map(async (f) => {
        const text = (await f.text().catch(() => "")).replace(/^\uFEFF/, "");
        // A .csv row is data, not a URL line: extract the URL cells. Keep the
        // raw text when nothing matches so the user can see what was dropped.
        if (f.type === "text/csv" || /\.csv$/i.test(f.name)) {
          const urls = urlsFromCsv(text);
          if (urls.length) return urls.join("\n");
        }
        return text.trim();
      })
    );
    const block = blocks.filter(Boolean).join("\n");
    if (!block) return;
    const cur = urlsEl.value.trim();
    urlsEl.value = (cur ? cur + "\n" : "") + block + "\n";
    draftCache = urlsEl.value;
    updateStartLabel();
    saveDraftSoon();
  });

  // Ctrl/Cmd + Enter from the URL field launches the batch.
  urlsEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !startBtn.disabled) {
      e.preventDefault();
      start();
    }
  });

  stopBtn.addEventListener("click", () => {
    stopBtn.disabled = true;
    chrome.runtime.sendMessage({ cmd: "stop" });
  });
})();

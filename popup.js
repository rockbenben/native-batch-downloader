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
  $("#lblWait").textContent = M("waiting");

  const urlsEl = $("#urls");
  const startBtn = $("#startBtn");
  const stopBtn = $("#stopBtn");
  const retryBtn = $("#retryBtn");
  const concurrencyEl = $("#concurrency");
  const delayEl = $("#delay");
  const folderEl = $("#folder");

  // Settings persist across sessions; the saved values are applied on open and
  // re-saved whenever a batch starts (start is the commit point).
  chrome.storage.sync.get({ concurrency: 10, delay: 0, subfolder: true }, (s) => {
    concurrencyEl.value = s.concurrency;
    delayEl.value = s.delay;
    folderEl.checked = s.subfolder;
  });
  const totalEl = $("#total");
  const okEl = $("#ok");
  const failEl = $("#fail");
  const waitEl = $("#wait");
  const barEl = $("#bar");
  const logEl = $("#log");

  let seenTotal = 0; // logical count of log entries already rendered (survives trimming)

  // -- draft persistence --
  // An unstarted URL list is the user's accumulated work; losing it because the
  // popup closed (one stray click) is brutal. Keep it in storage.session —
  // survives popup closes, cleared on browser exit — and commit-clear on Start.
  let draftTimer = null;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      chrome.storage.session.set({ draft: urlsEl.value });
    }, 250);
  }
  // The popup can die inside the debounce window (paste, then a stray click
  // closes it 100ms later) — exactly the loss this feature exists to prevent.
  // visibilitychange fires before teardown and extension API calls still go
  // through, so flush any pending save here. Guarded on draftTimer: after
  // Start commits the list, the timer is nulled and this must NOT resurrect
  // the cleared draft.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && draftTimer !== null) {
      clearTimeout(draftTimer);
      draftTimer = null;
      chrome.storage.session.set({ draft: urlsEl.value });
    }
  });
  chrome.storage.session.get("draft", (d) => {
    // Restore only into an untouched, editable field: a running batch disables
    // the editor, and anything the user already typed wins over the draft.
    if (d && d.draft && !urlsEl.value && !urlsEl.disabled) {
      urlsEl.value = d.draft;
      updateStartLabel();
    }
  });

  // Parse the textarea into the unique, valid URL list plus what was skipped.
  function parseInput() {
    const lines = urlsEl.value.split("\n").map((l) => l.trim()).filter(Boolean);
    // URL schemes are case-insensitive (RFC 3986), so HTTP:// / HTTPS:// are valid.
    const valid = lines.filter((l) => /^https?:\/\//i.test(l));
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
    barEl.style.width = st.stats.total ? `${(done / st.stats.total) * 100}%` : "0%";

    startBtn.disabled = st.running;
    stopBtn.disabled = !st.running;
    urlsEl.disabled = st.running;
    // Concurrency/delay are read only at Start; lock them while running so the
    // controls don't appear to do something they can't.
    concurrencyEl.disabled = st.running;
    delayEl.disabled = st.running;
    folderEl.disabled = st.running;
    // Offer a retry once the batch is over and something failed.
    const failed = st.failed || 0;
    retryBtn.hidden = st.running || !failed;
    retryBtn.textContent = `${M("retryFailed")} · ${failed}`;

    // Render by logical index so front-trimming of the capped log doesn't
    // desync the view. total = entries ever produced this run; st.log holds the
    // last (total - dropped) of them. A drop in total means a new run -> rebuild.
    const dropped = st.dropped || 0;
    const total = dropped + st.log.length;
    if (total < seenTotal) {
      logEl.innerHTML = "";
      seenTotal = 0;
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
    const { urls, invalid, dups } = parseInput();
    if (!urls.length) {
      logLine(M("noUrls"), "err");
      return;
    }
    // Locally-added lines (the "no URLs" error) aren't counted in seenTotal,
    // so the incoming batch's log would otherwise render above a stale error.
    logEl.innerHTML = "";
    seenTotal = 0;
    // The list is committed to the batch now — drop the draft (and any save
    // still pending in the debounce window, which would resurrect it; null the
    // timer so the visibilitychange flush can't resurrect it either).
    clearTimeout(draftTimer);
    draftTimer = null;
    chrome.storage.session.remove("draft");
    const parsedConc = parseInt(concurrencyEl.value, 10);
    const concurrency = Math.max(1, Math.min(200, isNaN(parsedConc) ? 10 : parsedConc));
    const delay = Math.max(0, Math.min(10000, parseInt(delayEl.value, 10) || 0));
    const subfolder = folderEl.checked;
    chrome.storage.sync.set({ concurrency, delay, subfolder });
    chrome.runtime.sendMessage({ cmd: "start", urls, concurrency, delay, invalid, dups, subfolder });
  }

  startBtn.addEventListener("click", start);
  retryBtn.addEventListener("click", () => {
    retryBtn.hidden = true;
    chrome.runtime.sendMessage({ cmd: "retry" });
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
    const texts = await Promise.all(files.map((f) => f.text().catch(() => "")));
    const block = texts.join("\n").trim();
    if (!block) return;
    const cur = urlsEl.value.trim();
    urlsEl.value = (cur ? cur + "\n" : "") + block + "\n";
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

(() => {
  const $ = (s) => document.querySelector(s);
  const M = (key, ...subs) =>
    chrome.i18n.getMessage(key, subs.map(String)) || key;

  document.documentElement.dir = M("@@bidi_dir");
  document.documentElement.lang = M("@@ui_locale").replace(/_/g, "-");
  document.title = M("extName");
  $("#titleText").textContent = M("title");
  $("#lblTotal").textContent = M("total");
  $("#lblOk").textContent = M("success");
  $("#lblFail").textContent = M("failed");
  $("#lblWait").textContent = M("waiting");
  $("#resumeBtn").textContent = M("resume");
  $("#resumeX").textContent = M("resumeDismiss");
  $("#empty").textContent = M("dashEmpty");
  $("#stopBtn").textContent = M("stop");
  $("#belt").setAttribute("aria-label", M("progressAria"));

  const stopBtn = $("#stopBtn");
  const pauseBtn = $("#pauseBtn");
  const retryBtn = $("#dashRetry");
  const rowsEl = $("#rows");
  const moreEl = $("#more");
  const chipsEl = $("#chips");
  const bytesEl = $("#bytes");
  const savedEl = $("#savedPath");

  const FILTERS = ["all", "wait", "active", "ok", "fail"];
  const FILTER_KEY = { all: "all", wait: "waiting", active: "downloading", ok: "success", fail: "failed" };
  const GLYPH = { ok: "✓", fail: "✗", active: "▸", wait: "○" };
  const ROW_STEP = 400;
  let rowCap = ROW_STEP;
  let filter = location.hash === "#failed" ? "fail" : "all";
  let S = null;

  for (const f of FILTERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.dataset.f = f;
    b.addEventListener("click", () => {
      filter = f;
      render();
    });
    chipsEl.appendChild(b);
  }

  const send = (cmd) => new Promise((r) => chrome.runtime.sendMessage({ cmd }, r));
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

  function render() {
    if (!S) return;
    const done = S.stats.ok + S.stats.fail;
    $("#total").textContent = S.stats.total;
    $("#ok").textContent = S.stats.ok;
    $("#fail").textContent = S.failed;
    $("#wait").textContent = S.stats.total - done;
    const pct = S.stats.total ? Math.round((done / S.stats.total) * 100) : 0;
    $("#bar").style.width = `${pct}%`;
    $("#belt").setAttribute("aria-valuenow", pct);
    document.body.classList.toggle("paused", !!S.paused);
    stopBtn.disabled = !S.running;
    pauseBtn.disabled = !S.running;
    pauseBtn.textContent = S.paused ? M("resume") : M("pause");
    pauseBtn.title = S.paused ? M("paused") : "";
    retryBtn.hidden = S.running || !S.failed;
    retryBtn.textContent = `${M("retryFailed")} · ${S.failed}`;
    const resumable = !S.running && (S.pendingResume || 0) > 0;
    $("#resumeBar").hidden = !resumable;
    if (resumable) $("#resumeText").textContent = M("resumeAsk", S.pendingResume);
    $("#empty").hidden = S.stats.total > 0 || resumable;
    const showSaved = !!S.folder && !S.running && S.stats.ok > 0;
    savedEl.hidden = !showSaved;
    if (showSaved) savedEl.textContent = M("savedFolder", `\u200E${S.folder}\u200E`);

    const entries = Object.entries(S.entries || {});
    const counts = { all: entries.length, wait: 0, active: 0, ok: 0, fail: 0 };
    for (const [, e] of entries) counts[e.status]++;
    for (const b of chipsEl.children) {
      const f = b.dataset.f;
      b.setAttribute("aria-pressed", f === filter ? "true" : "false");
      b.textContent = `${M(FILTER_KEY[f])} · ${counts[f]}`;
    }
    const list = filter === "all" ? entries : entries.filter(([, e]) => e.status === filter);
    rowsEl.innerHTML = "";
    for (const [url, e] of list.slice(0, rowCap)) {
      const row = document.createElement("div");
      row.className = "row";
      const g = document.createElement("span");
      g.className = `g ${e.status}`;
      g.textContent = GLYPH[e.status];
      const lb = document.createElement("span");
      lb.className = "lb";
      lb.textContent = e.label;
      lb.title = url;
      row.append(g, lb);
      if (e.reason) {
        const rs = document.createElement("span");
        rs.className = "rs";
        rs.textContent = e.reason;
        rs.title = e.reason;
        row.append(rs);
      }
      const cp = document.createElement("button");
      cp.type = "button";
      cp.className = "cp";
      cp.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
      cp.title = M("copyTip");
      cp.setAttribute("aria-label", M("copyTip"));
      cp.addEventListener("click", () => {
        navigator.clipboard.writeText(url).then(() => {
          row.classList.add("copied");
          setTimeout(() => row.classList.remove("copied"), 900);
        });
      });
      row.append(cp);
      rowsEl.appendChild(row);
    }
    moreEl.hidden = list.length <= rowCap;
    if (!moreEl.hidden) moreEl.textContent = M("showMore", list.length - rowCap);
  }

  let refreshTimer = null;
  let refreshPending = false;
  let refreshSeq = 0;
  async function refresh() {
    const seq = ++refreshSeq;
    const resp = await send("getFull");
    if (seq !== refreshSeq) return; // a newer refresh won
    S = resp && resp.state;
    render();
  }
  function scheduleRefresh() {
    refreshPending = true;
    if (document.hidden || refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (document.hidden || !refreshPending) return;
      refreshPending = false;
      refresh();
    }, 500);
  }
  function syncRefresh(m) {
    if (document.hidden) {
      refreshPending = true;
      return;
    }
    // A finished/stopped batch is the state the user is waiting for; don't
    // make them wait for the coalescing window. Running updates stay at 2/s.
    if (m && m.state && !m.state.running) {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      refreshPending = false;
      refresh();
      return;
    }
    scheduleRefresh();
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.evt === "sync") syncRefresh(m);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && refreshPending) scheduleRefresh();
  });

  pauseBtn.addEventListener("click", () => send(S && S.paused ? "resume" : "pause").then(refresh));
  stopBtn.addEventListener("click", () => send("stop").then(refresh));
  retryBtn.addEventListener("click", () => send("retry").then(refresh));
  moreEl.addEventListener("click", () => {
    const top = rowsEl.scrollTop;
    rowCap += ROW_STEP;
    render();
    rowsEl.scrollTop = top;
  });
  $("#resumeBtn").addEventListener("click", () => send("resumeBatch").then(refresh));
  $("#resumeX").addEventListener("click", () => send("dismissResume").then(refresh));

  setInterval(async () => {
    if (document.hidden) return; // don't poll a background tab
    if (!S || !S.running) {
      bytesEl.hidden = true;
      return;
    }
    const b = await send("bytes");
    if (b && b.received > 0) {
      bytesEl.hidden = false;
      bytesEl.textContent = b.total ? `${mb(b.received)} / ${mb(b.total)}` : mb(b.received);
    } else {
      bytesEl.hidden = true;
    }
  }, 1000);

  refresh();
})();

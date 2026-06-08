(() => {
  const $ = (s) => document.querySelector(s);
  const M = (key, ...subs) =>
    chrome.i18n.getMessage(key, subs.map(String)) || key;

  // -- i18n UI --
  $("#titleText").textContent = M("title");
  $("#urls").placeholder = M("placeholder");
  $("#concLabel").textContent = M("concurrency");
  $("#delayLabel").textContent = M("delay");
  $("#startBtn").textContent = M("start");
  $("#stopBtn").textContent = M("stop");
  $("#lblTotal").textContent = M("total");
  $("#lblOk").textContent = M("success");
  $("#lblFail").textContent = M("failed");
  $("#lblWait").textContent = M("waiting");

  const urlsEl = $("#urls");
  const startBtn = $("#startBtn");
  const stopBtn = $("#stopBtn");
  const concurrencyEl = $("#concurrency");
  const delayEl = $("#delay");
  const totalEl = $("#total");
  const okEl = $("#ok");
  const failEl = $("#fail");
  const waitEl = $("#wait");
  const barEl = $("#bar");
  const logEl = $("#log");

  let seenTotal = 0; // logical count of log entries already rendered (survives trimming)

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

  startBtn.addEventListener("click", () => {
    const lines = urlsEl.value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const valid = lines.filter(
      (l) => l.startsWith("http://") || l.startsWith("https://")
    );
    const seen = new Set();
    const urls = [];
    for (const u of valid) {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }

    if (!urls.length) {
      logLine(M("noUrls"), "err");
      return;
    }

    const concurrency = Math.max(1, Math.min(200, parseInt(concurrencyEl.value) || 10));
    const delay = parseInt(delayEl.value) || 0;

    chrome.runtime.sendMessage({
      cmd: "start",
      urls,
      concurrency,
      delay,
      invalid: lines.length - valid.length,
      dups: valid.length - urls.length,
    });
  });

  stopBtn.addEventListener("click", () => {
    stopBtn.disabled = true;
    chrome.runtime.sendMessage({ cmd: "stop" });
  });
})();

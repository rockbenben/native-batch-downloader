(() => {
  const $ = (s) => document.querySelector(s);
  const M = (key, ...subs) => {
    let msg = chrome.i18n.getMessage(key) || key;
    subs.forEach((s, i) => { msg = msg.replace(`$${i + 1}`, s); });
    return msg;
  };

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

  let aborted = false;
  let stats = { total: 0, ok: 0, fail: 0 };

  function parseUrls() {
    return urlsEl.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && (l.startsWith("http://") || l.startsWith("https://")));
  }

  function log(text, cls = "info") {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    logEl.prepend(d);
  }

  function updateStats() {
    const done = stats.ok + stats.fail;
    const waiting = stats.total - done;
    totalEl.textContent = stats.total;
    okEl.textContent = stats.ok;
    failEl.textContent = stats.fail;
    waitEl.textContent = waiting;
    barEl.style.width = stats.total ? `${(done / stats.total) * 100}%` : "0%";
  }

  function filenameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split("/");
      const last = parts[parts.length - 1];
      return last ? decodeURIComponent(last) : null;
    } catch {
      return null;
    }
  }

  function downloadOne(url) {
    return new Promise((resolve) => {
      const filename = filenameFromUrl(url);
      const opts = { url, saveAs: false };
      if (filename) opts.filename = filename;

      chrome.downloads.download(opts, (downloadId) => {
        if (chrome.runtime.lastError) {
          stats.fail++;
          log(`${filename || url}  — ${chrome.runtime.lastError.message}`, "err");
          updateStats();
          resolve(false);
          return;
        }

        const handler = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state) {
            if (delta.state.current === "complete") {
              chrome.downloads.onChanged.removeListener(handler);
              stats.ok++;
              log(filename || url, "ok");
              updateStats();
              resolve(true);
            } else if (delta.state.current === "interrupted") {
              chrome.downloads.onChanged.removeListener(handler);
              stats.fail++;
              log(`${filename || url}  — ${M("interrupted")}`, "err");
              updateStats();
              resolve(false);
            }
          }
        };
        chrome.downloads.onChanged.addListener(handler);
      });
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function runQueue(urls, concurrency, delay) {
    let idx = 0;

    async function worker() {
      while (idx < urls.length && !aborted) {
        const i = idx++;
        const url = urls[i];
        log(`${M("downloading")}: ${filenameFromUrl(url) || url}`, "info");
        await downloadOne(url);
        if (delay > 0 && idx < urls.length && !aborted) {
          await sleep(delay);
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, urls.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  startBtn.addEventListener("click", async () => {
    const urls = parseUrls();
    if (!urls.length) {
      log(M("noUrls"), "err");
      return;
    }

    aborted = false;
    stats = { total: urls.length, ok: 0, fail: 0 };
    logEl.innerHTML = "";
    updateStats();

    const concurrency = Math.max(1, Math.min(200, parseInt(concurrencyEl.value) || 100));
    const delay = parseInt(delayEl.value) || 0;

    startBtn.disabled = true;
    stopBtn.disabled = false;
    urlsEl.disabled = true;

    log(M("startLog", urls.length, concurrency), "info");
    await runQueue(urls, concurrency, delay);

    if (aborted) {
      log(M("stopped"), "err");
    } else {
      log(M("doneAll", stats.ok, stats.fail), stats.fail ? "err" : "ok");
    }

    startBtn.disabled = false;
    stopBtn.disabled = true;
    urlsEl.disabled = false;
  });

  stopBtn.addEventListener("click", () => {
    aborted = true;
    stopBtn.disabled = true;
  });
})();

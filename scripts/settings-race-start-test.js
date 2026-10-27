(() => {
  const c = document.querySelector("#concurrency");
  const d = document.querySelector("#delay");
  const ta = document.querySelector("#urls");
  const start = document.querySelector("#startBtn");
  const out = {};
  ta.value = "https://example.com/race.pdf";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  start.click();
  out.beforeStartSent = window.sent.some((m) => m.cmd === "start");
  return new Promise((resolve) =>
    setTimeout(() => {
      const msg = window.sent.filter((m) => m.cmd === "start").pop();
      out.startSent = !!msg;
      out.startC = msg && msg.concurrency;
      out.startD = msg && msg.delay;
      out.startSubfolder = msg && msg.subfolder;
      out.inputC = c.value;
      out.inputD = d.value;
      resolve(JSON.stringify(out));
    }, 800)
  );
})()

(() => {
  const c = document.querySelector("#concurrency");
  const d = document.querySelector("#delay");
  const f = document.querySelector("#folder");
  const ta = document.querySelector("#urls");
  const start = document.querySelector("#startBtn");
  const out = {};

  // A change saves immediately, before any batch is started.
  c.value = "3";
  d.value = "500";
  c.dispatchEvent(new Event("change", { bubbles: true }));
  d.dispatchEvent(new Event("change", { bubbles: true }));
  out.savedC = window.savedSettings.concurrency;
  out.savedD = window.savedSettings.delay;
  out.savedFolder = window.savedSettings.subfolder;

  // Closing without a change event still saves, clamped.
  c.value = "999";
  d.value = "99999";
  let vis = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => vis, configurable: true });
  vis = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  out.hiddenC = window.savedSettings.concurrency;
  out.hiddenD = window.savedSettings.delay;

  // Folder changes persist too, and Start writes clamped values back + sends them.
  vis = "visible";
  f.checked = false;
  f.dispatchEvent(new Event("change", { bubbles: true }));
  out.folderOff = window.savedSettings.subfolder;
  ta.value = "https://example.com/one.pdf";
  ta.dispatchEvent(new Event("input"));
  start.click();
  const msg = window.sent.filter((m) => m.cmd === "start").pop();
  out.startC = msg.concurrency;
  out.startD = msg.delay;
  out.startSubfolder = msg.subfolder;
  out.inputC = c.value;
  out.inputD = d.value;
  out.startSent = !!msg;
  return JSON.stringify(out);
})()

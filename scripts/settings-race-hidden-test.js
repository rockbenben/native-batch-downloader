(() => {
  const c = document.querySelector("#concurrency");
  const d = document.querySelector("#delay");
  const f = document.querySelector("#folder");
  const fmt = (s) => s ? `${s.concurrency}/${s.delay}/${s.subfolder}` : null;
  const out = { beforeC: c.value, beforeD: d.value, beforeF: f.checked };
  let vis = "hidden";
  Object.defineProperty(document, "visibilityState", { get: () => vis, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  out.savedAfterHide = fmt(window.savedSettings);
  return new Promise((resolve) =>
    setTimeout(() => {
      out.afterC = c.value;
      out.afterD = d.value;
      out.afterF = f.checked;
      out.savedAfterLoad = fmt(window.savedSettings);
      resolve(JSON.stringify(out));
    }, 800)
  );
})()

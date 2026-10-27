(() => {
  const c = document.querySelector("#concurrency");
  const d = document.querySelector("#delay");
  const f = document.querySelector("#folder");
  const fmt = (s) => s ? `${s.concurrency}/${s.delay}/${s.subfolder}` : null;
  const out = {};
  c.value = "7";
  d.value = "600";
  f.checked = true;
  c.dispatchEvent(new Event("input", { bubbles: true }));
  d.dispatchEvent(new Event("input", { bubbles: true }));
  c.dispatchEvent(new Event("change", { bubbles: true }));
  d.dispatchEvent(new Event("change", { bubbles: true }));
  f.dispatchEvent(new Event("change", { bubbles: true }));
  out.savedAfterEdit = fmt(window.savedSettings);
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

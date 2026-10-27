(() => {
  const count = () => window.sent.filter((m) => m.cmd === "getFull").length;
  const base = count();
  const state = (n, running = true) => ({
    running, paused: false,
    stats: { total: 2, ok: n, fail: 0 }, failed: 0,
    log: [], dropped: 0, pendingResume: 0, folder: null,
    entries: { u0: { label: "a.txt", status: "ok" }, u1: { label: "b.txt", status: n ? "ok" : "wait" } },
  });
  const out = { base };
  // The runner page may itself be backgrounded; simulate a visible dashboard
  // for the coalescing part, then hide it for the hidden-skip part.
  let hidden = false;
  Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
  for (let i = 0; i < 20; i++) window.pushState(state(i % 2));
  out.afterRapidNow = count() - base;
  return new Promise((resolve) =>
    setTimeout(() => {
      out.afterRapid = count() - base;
      hidden = true;
      for (let i = 0; i < 5; i++) window.pushState(state(i % 2));
      out.afterHidden = count() - base;
      setTimeout(() => {
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        setTimeout(() => {
          out.afterVisible = count() - base;
          window.pushState(state(2, false));
          out.afterFinal = count() - base;
          setTimeout(() => {
            out.rows = document.querySelectorAll(".row").length;
            out.finalOk = document.querySelector("#ok").textContent;
            resolve(JSON.stringify(out));
          }, 100);
        }, 700);
      }, 100);
    }, 700)
  );
})()

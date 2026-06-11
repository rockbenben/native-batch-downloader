(() => {
  const ta = document.getElementById("urls");
  const results = {};
  // make visibilityState controllable, count session writes
  let vis = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => vis, configurable: true });
  const rawSet = chrome.storage.session.set;
  let writes = 0;
  chrome.storage.session.set = (o) => { writes++; rawSet(o); };
  const hide = () => { vis = "hidden"; document.dispatchEvent(new Event("visibilitychange")); vis = "visible"; };

  // 1. pending debounce + popup hides -> flushed immediately (no 250ms wait)
  ta.value = "https://flush.example.com/a.zip";
  ta.dispatchEvent(new Event("input"));
  hide(); // within the debounce window
  results.flushedImmediately = window.fakeSession.draft === ta.value;
  results.writesAfterFlush = writes;

  // 2. hide again with nothing pending -> no extra write
  hide();
  results.noRedundantWrite = writes === results.writesAfterFlush;

  // 3. start commits -> hide must NOT resurrect the cleared draft
  ta.dispatchEvent(new Event("input")); // re-arm debounce
  document.getElementById("startBtn").click(); // clears draft + timer
  hide();
  results.noResurrectionAfterStart = !("draft" in window.fakeSession);

  // 4. debounce still works on its own (timer nulls itself, flush stays quiet)
  return new Promise((r) => {
    ta.disabled = false; // start() disabled nothing in stub, but be explicit
    ta.value = "https://later.example.com/b.zip";
    ta.dispatchEvent(new Event("input"));
    setTimeout(() => {
      results.debouncedSaveStillWorks = window.fakeSession.draft === ta.value;
      const w = writes;
      hide(); // timer already fired and nulled itself -> no write
      results.timerSelfNulls = writes === w;
      r(JSON.stringify(results));
    }, 400);
  });
})()

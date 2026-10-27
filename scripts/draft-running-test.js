(() => {
  const ta = document.getElementById("urls");
  const before = {
    whileRunning: ta.value,
    disabledWhileRunning: ta.disabled,
    pauseVisible: !document.getElementById("popupPause").hidden,
  };
  // The saved next-batch draft must not overwrite the locked editor mid-run;
  // it should appear as soon as the current batch finishes.
  window.pushState({
    running: false, paused: false, stats: { total: 2, ok: 2, fail: 0 },
    failed: 0, log: [], dropped: 0, pendingResume: 0,
  });
  return new Promise((r) =>
    setTimeout(() => r(JSON.stringify({
      ...before,
      afterFinish: ta.value,
      labelAfterFinish: document.getElementById("startBtn").textContent,
      enabledAfterFinish: !ta.disabled,
    })), 100)
  );
})()

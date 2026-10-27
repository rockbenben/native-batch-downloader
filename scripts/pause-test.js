(() => {
  const pause = document.getElementById("popupPause");
  const resume = document.getElementById("popupResume");
  const retry = document.getElementById("retryBtn");
  const before = {
    pauseVisible: !pause.hidden,
    pauseText: pause.textContent,
    resumeHidden: resume.hidden,
    retryHidden: retry.hidden,
    urlsDisabled: document.getElementById("urls").disabled,
  };
  pause.click();
  return JSON.stringify({ ...before, pauseSent: window.sent.some((m) => m.cmd === "pause") });
})()

(() => {
  // A paused batch must freeze the status lamp and the conveyor belt. The
  // running animations are :has()-scoped, which out-specifies a plain
  // `.paused` class — the pause state used to lose that contest and the batch
  // kept blinking and moving while paused.
  //
  // Headless Chrome reports prefers-reduced-motion: reduce, and popup.css then
  // force-disables every animation — both states would read as "none" and the
  // test would pass without proving anything. The runner emulates
  // no-preference for exactly that reason.
  const read = () => ({
    led: getComputedStyle(document.querySelector(".led")).animationName,
    belt: getComputedStyle(document.querySelector(".belt .fill"), "::after").animationName,
  });
  const running = read();
  window.pushState({
    running: true,
    paused: true,
    stats: { total: 2, ok: 0, fail: 0 },
    failed: 0,
    log: [],
    dropped: 0,
    pendingResume: 0,
  });
  return new Promise((resolve) =>
    setTimeout(() => {
      const paused = read();
      resolve(
        JSON.stringify({
          runningLed: running.led,
          runningBelt: running.belt,
          pausedLed: paused.led,
          pausedBelt: paused.belt,
          bodyPaused: document.body.classList.contains("paused"),
        })
      );
    }, 120)
  );
})()

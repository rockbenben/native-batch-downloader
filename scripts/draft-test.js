(() => {
  const ta = document.getElementById("urls");
  const results = {};
  // 1. draft seeded via ?draft= must be restored with the start-label count
  results.restored = ta.value;
  results.labelAfterRestore = document.getElementById("startBtn").textContent;
  // 2. typing saves the draft (after the 250ms debounce)
  ta.value = "https://typed.example.com/x.zip\nhttps://typed.example.com/y.zip";
  ta.dispatchEvent(new Event("input"));
  return new Promise((r) =>
    setTimeout(() => {
      results.savedAfterInput = window.fakeSession.draft;
      // 3. a valid Start clears the draft and beats the pending debounce
      ta.dispatchEvent(new Event("input")); // re-arm debounce just before start
      document.getElementById("startBtn").click();
      setTimeout(() => {
        results.draftAfterStart = window.fakeSession.draft ?? null;
        results.startSent = window.sent.some((m) => m.cmd === "start");
        r(JSON.stringify(results));
      }, 500); // longer than the debounce — a leaked save would resurface here
    }, 450)
  );
})()

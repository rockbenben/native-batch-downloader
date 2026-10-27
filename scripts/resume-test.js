(() => JSON.stringify({
  dismiss: document.querySelector("#resumeX").textContent,
  resume: document.querySelector("#resumeBtn").textContent,
  barVisible: !document.querySelector("#resumeBar").hidden,
  doorVisible: !document.querySelector("#dashBtn").hidden,
}))()

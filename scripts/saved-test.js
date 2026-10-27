(() => JSON.stringify({
  visible: !document.querySelector("#savedPath").hidden,
  text: document.querySelector("#savedPath").textContent,
  hasFolder: document.querySelector("#savedPath").textContent.includes("BatchDL/2026-10-27"),
  rows: document.querySelectorAll(".row").length,
}))()

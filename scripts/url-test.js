(() => {
  const ta = document.getElementById("urls");
  ta.value = "\uFEFFhttp://example.com/bom.pdf\nhttps://\nftp://example.com/x\nnot a link\nhttp://example.com/ok.pdf";
  ta.dispatchEvent(new Event("input"));
  return JSON.stringify({
    label: document.getElementById("startBtn").textContent,
    bomAccepted: document.getElementById("startBtn").textContent.endsWith("· 2"),
  });
})()

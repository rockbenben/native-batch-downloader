(() => {
  const ta = document.getElementById("urls");
  ta.value = "";
  // Real-world CSV: a header, a plain row, and a quoted URL whose query
  // contains the delimiter. The header must not become an invalid URL line.
  const csv = 'name,url\nOne,https://example.com/a.pdf\nTwo,"https://example.com/b.pdf?x=1,2"\n';
  const dt = new DataTransfer();
  dt.items.add(new File([csv], "list.csv", { type: "text/csv" }));
  document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return new Promise((r) =>
    setTimeout(() => r(JSON.stringify({
      value: ta.value,
      label: document.getElementById("startBtn").textContent,
      hasHeader: ta.value.includes("name,url"),
      a: ta.value.includes("https://example.com/a.pdf"),
      b: ta.value.includes("https://example.com/b.pdf?x=1,2"),
      lines: ta.value.trim().split("\n").length,
    })), 500)
  );
})()

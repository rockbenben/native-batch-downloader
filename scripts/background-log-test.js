(() => {
  const bg = window.__bg;
  const inv = bg.M("skippedInvalid", 2);
  const dup = bg.M("skippedDuplicate", 1);
  const out = { inv, dup };

  bg.setState({ log: [{ text: "start", cls: "info" }, { text: inv, cls: "info" }, { text: dup, cls: "info" }], dropped: 0, invalid: 2, dups: 1 });
  bg.repushSkippedIfTrimmed();
  out.smallLen = bg.getState().log.length;

  bg.setState({ log: Array.from({ length: 500 }, (_, i) => ({ text: "x" + i, cls: "info" })), dropped: 313, invalid: 2, dups: 1 });
  bg.repushSkippedIfTrimmed();
  out.largeLast = bg.getState().log.slice(-2).map((e) => e.text).join("|");

  bg.setState({ log: [{ text: dup, cls: "info" }], dropped: 0, invalid: 2, dups: 1 });
  bg.repushSkippedIfTrimmed();
  const lines = bg.getState().log.map((e) => e.text);
  out.boundaryInv = lines.filter((t) => t === inv).length;
  out.boundaryDup = lines.filter((t) => t === dup).length;
  out.boundaryLen = lines.length;

  return JSON.stringify(out);
})()

(() => {
  const more = document.querySelector("#more");
  const results = {
    beforeRows: document.querySelectorAll(".row").length,
    moreText: more.textContent,
    moreVisible: !more.hidden,
  };
  more.click();
  return new Promise((resolve) =>
    setTimeout(() => {
      results.afterRows = document.querySelectorAll(".row").length;
      results.moreHidden = document.querySelector("#more").hidden;
      resolve(JSON.stringify(results));
    }, 100)
  );
})()

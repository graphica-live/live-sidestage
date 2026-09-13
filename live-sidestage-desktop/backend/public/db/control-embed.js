(function () {
  try {
    if (window.parent && window.parent !== window) {
      document.documentElement.classList.add("in-control-shell");
    }
  } catch (e) {}
})();

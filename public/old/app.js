window.IS_APP =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true ||
  location.search.includes("app=true");

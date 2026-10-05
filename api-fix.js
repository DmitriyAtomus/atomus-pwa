/* Temporary bridge: old PWA builds still fall back to a dead trycloudflare URL after Railway cutover. */
(function () {
  var BAD = 'https://entry-encyclopedia-gmbh-career.trycloudflare.com';
  var GOOD = 'https://api.atomuscrm.ru';
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (typeof input === 'string' && input.indexOf(BAD) === 0) {
        input = GOOD + input.slice(BAD.length);
      } else if (input && typeof input.url === 'string' && input.url.indexOf(BAD) === 0) {
        input = new Request(GOOD + input.url.slice(BAD.length), input);
      }
    } catch (e) {}
    return nativeFetch(input, init);
  };
})();

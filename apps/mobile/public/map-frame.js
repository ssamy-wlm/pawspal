// The sandboxed map frame on the web. The app (MapSurface.web.tsx) sends the finished map page as a message; this file
// writes it into this frame, passes the page's messages back to the app, and passes the app's "select" back in.
// The frame has no storage, no cookies and no access to the app: it only trades messages with its parent.
(function () {
  var parentWin = window.parent;
  if (!parentWin || parentWin === window) return;

  // The map page talks to a phone's WebView with window.ReactNativeWebView.postMessage; on the web the same call lands here.
  window.ReactNativeWebView = {
    postMessage: function (text) { parentWin.postMessage({ pawspal: 'map-msg', data: String(text) }, '*'); }
  };

  function onMessage(e) {
    if (e.source !== parentWin || !e.data || typeof e.data !== 'object') return;
    if (e.data.pawspal === 'map-html' && typeof e.data.html === 'string') {
      document.open();
      document.write(e.data.html);
      document.close();
      window.addEventListener('message', onMessage); // opening the document clears listeners
    } else if (e.data.pawspal === 'map-select' && typeof e.data.id === 'string') {
      if (typeof window.__select === 'function') window.__select(e.data.id);
    }
  }
  window.addEventListener('message', onMessage);
  parentWin.postMessage({ pawspal: 'map-frame-ready' }, '*');
})();

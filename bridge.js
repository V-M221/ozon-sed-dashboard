if (!window.__OZON_SED_BRIDGE_ACTIVE__) {
  window.__OZON_SED_BRIDGE_ACTIVE__ = true;

  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'CRM_INJECTOR') {
      chrome.runtime.sendMessage(event.data).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PING') {
      sendResponse({ ok: true, url: window.location.href });
      return true;
    }
    if (msg && msg.target === 'INJECTOR') {
      window.postMessage({ source: 'CRM_BRIDGE', type: msg.type, payload: msg.payload }, '*');
      sendResponse({ ok: true });
      return true;
    }
  });
}
(() => {
  if (window.__pixmaxCanvasClonerExtensionRelay) return;
  window.__pixmaxCanvasClonerExtensionRelay = true;

  const REQUEST_EVENT = "pixmax-canvas-cloner:extension-request";
  const RESPONSE_EVENT = "pixmax-canvas-cloner:extension-response";
  const MESSAGE_TYPES = {
    "eagle-import-url": "pixmax-cloner:eagle-import-url"
  };

  function respond(requestId, ok, payload = {}) {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify({
          ok,
          payload,
          requestId
        })
      })
    );
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }

    const { action, payload, requestId } = request;
    const type = MESSAGE_TYPES[action];
    if (!requestId || !type) return;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      respond(requestId, false, {
        error: "扩展已更新，请刷新 Pixmax 页面后重试。"
      });
      return;
    }

    runtime.sendMessage({ type, ...payload }, (response) => {
      if (runtime.lastError) {
        respond(requestId, false, {
          error: runtime.lastError.message || "扩展后台响应失败。"
        });
        return;
      }

      if (!response?.ok) {
        respond(requestId, false, {
          error: response?.error || "扩展后台响应失败。"
        });
        return;
      }

      respond(requestId, true, response);
    });
  });
})();

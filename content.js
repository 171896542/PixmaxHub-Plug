(() => {
  if (window.__pixmaxCanvasClonerUi) return;
  window.__pixmaxCanvasClonerUi = true;

  const REQUEST_EVENT = "pixmax-canvas-cloner:request";
  const RESPONSE_SOURCE = "pixmax-canvas-cloner:bridge";
  const EXTENSION_REQUEST_EVENT = "pixmax-canvas-cloner:extension-request";
  const EXTENSION_RESPONSE_EVENT = "pixmax-canvas-cloner:extension-response";
  const NODE_SELECTOR = ".svelte-flow__node[data-id]";
  const TOOLBAR_SELECTOR = ".svelte-flow__node-toolbar";
  const FOCUS_PARAM = "pixmaxClonerFocus";
  const ACTIONS_CLASS = "pixmax-canvas-cloner-actions";
  const CONTEXT_PASTE_CLASS = "pixmax-canvas-cloner-context-paste";
  const STYLE_ID = "pixmax-canvas-cloner-style";
  const OFFICIAL_FOCUS_STYLE_ID = "collab-remote-focus-styles";
  const LIVE_FOCUS_STYLE_ID = "pixmax-canvas-cloner-live-focus-colors";
  const LIVE_SELECTION_STYLE_ID = "pixmax-canvas-cloner-live-selection-color";
  const STYLE_VERSION = "1.4.7";
  const TOAST_ID = "pixmax-canvas-cloner-toast";
  const LIVE_TOGGLE_ID = "pixmax-canvas-cloner-live-toggle";
  const OPEN_LIKES_BUTTON_ID = "pixmax-canvas-cloner-open-likes";
  const LIVE_CURSOR_LAYER_ID = "pixmax-canvas-cloner-live-cursors";
  const LIKES_STORAGE_KEY = "pixmaxLikedItems";
  const LIVE_IDENTITY_STORAGE_KEY = "pixmaxHubLiveIdentity";
  const UPDATE_CHECK_STORAGE_KEY = "pixmaxHubUpdateReminder";
  const DEFAULT_GITHUB_UPDATE_URL = "https://github.com/171896542/PixmaxHub-Plug/tree/main";
  const UPDATE_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_LIKE_COLOR = "#ff3864";
  const LIVE_CURSOR_SEND_INTERVAL_MS = 45;
  const LIVE_FOCUS_SEND_INTERVAL_MS = 120;
  const LIVE_REMOTE_CURSOR_TTL_MS = 2600;
  const LIVE_FOCUS_HEARTBEAT_MS = 1800;
  const LIVE_REMOTE_FOCUS_STALE_MS = 45000;
  const LIVE_REVISION_POLL_INTERVAL_MS = 300;
  const LIVE_SYNC_TRIGGER_INTERVAL_MS = 120;
  const LIVE_REVISION_CHECK_DELAY_MS = 180;
  const LIVE_REMOTE_BROADCAST_PULL_DELAY_MS = 20;
  const LIVE_REMOTE_ACTIVITY_GRACE_MS = 2500;
  const LIVE_FALLBACK_COLORS = [
    "#ff3864",
    "#ffd500",
    "#4ce2f3",
    "#6d7cff",
    "#35d07f",
    "#ff8a3d",
    "#b85cff",
    "#ff66b3"
  ];
  const SHARED_OPTIONS_DEFAULTS = {
    sharedLikesEnabled: true,
    sharedLikesFileUuid: "",
    sharedLikesOwnerName: "",
    sharedLikesColor: DEFAULT_LIKE_COLOR,
    liveCollabEnabled: true
  };
  const requests = new Map();
  const extensionRequests = new Map();
  const pendingToolbarRoots = new Set();
  let likedKeys = new Set();
  let ownLikedKeys = new Set();
  let likedColors = new Map();
  let toolbarSyncScheduled = false;
  let contextPasteSyncScheduled = false;
  let legacyCleanupScheduled = false;
  let toastTimer = 0;
  let lastContextMenuPoint = null;
  let liveReconnectTimer = 0;
  let liveRevisionTimer = 0;
  let liveCursorCleanupTimer = 0;
  let liveFocusBroadcastTimer = 0;
  let liveSyncTriggerTimer = 0;
  let liveSocket = null;
  let liveSocketReconnectAttempt = 0;
  let liveSocketStatus = "idle";
  let liveSocketLastError = "";
  let liveSocketLastOpenAt = 0;
  let liveSocketLastMessageAt = 0;
  let liveSocketLastSentAt = 0;
  let liveLastCursorSentAt = 0;
  let liveLastFocusBroadcastAt = 0;
  let liveLastFocusHeartbeatAt = 0;
  let liveLastFocusSignature = "";
  let liveLastSyncTriggeredAt = 0;
  let liveLastLocalActivityAt = 0;
  let liveRemoteActivityUntil = 0;
  let liveLastKnownRevision = null;
  let liveOfficialFileUuid = "";
  let liveLastRawMessage = null;
  let liveLastIncomingPayload = null;
  let liveLastDroppedPayload = null;
  let liveLastSentPayload = null;
  let liveLastProfileBroadcastKey = "";
  let liveLastProfileBroadcastAt = 0;
  let liveOfficialClientId = "";
  let liveOfficialUserId = "";
  let liveSyncInFlight = false;
  let liveSyncQueued = false;
  let liveOptions = null;
  let liveOfficialSyncAvailable = false;
  let liveOfficialSyncWarned = false;
  let livePresencePeerCount = 1;
  let liveDomPeerCount = 1;
  let liveMultiUserSyncNotified = false;
  let liveConnectionKey = "";
  let liveSessionId = "";
  let livePresenceAppearanceScheduled = false;
  const livePendingNodeIds = new Set();
  const liveRemoteCursors = new Map();
  const liveRemoteFocuses = new Map();
  const livePeerProfiles = new Map();
  let liveFocusSessions = [];

  function createRequestId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function requestBridge(action, payload = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const requestId = createRequestId();
      const timer = window.setTimeout(() => {
        requests.delete(requestId);
        reject(new Error("页面响应超时，请刷新后重试。"));
      }, timeout);

      requests.set(requestId, { resolve, reject, timer });
      window.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: JSON.stringify({ requestId, action, payload })
        })
      );
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== RESPONSE_SOURCE) return;

    if (event.data.notification === "paste-repair-complete") {
      showToast(
        `已粘贴带连线副本，并修复 ${event.data.payload.rewrittenMentionCount} 个 @节点 引用。`
      );
      return;
    }

    if (event.data.notification === "paste-repair-error") {
      showToast(event.data.payload?.error ?? "粘贴修复失败。", true);
      return;
    }

    if (event.data.notification === "shared-like-index-error") {
      showToast(`收藏已保存，但索引同步失败：${event.data.payload?.error || "未知错误"}`, true);
      return;
    }

    if (event.data.notification === "official-presence-message") {
      handleLiveSocketMessage(JSON.stringify(event.data.payload || {}));
      return;
    }

    const pending = requests.get(event.data.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timer);
    requests.delete(event.data.requestId);
    if (event.data.ok) pending.resolve(event.data.payload);
    else pending.reject(new Error(event.data.payload?.error ?? "操作失败。"));
  });

  window.addEventListener("pixmax-canvas-cloner:live-debug", () => {
    window.dispatchEvent(
      new CustomEvent("pixmax-canvas-cloner:live-debug-response", {
        detail: JSON.stringify({
          enabled: Boolean(liveOptions?.enabled),
          fileUuid: liveOptions?.fileUuid || "",
          ownerName: liveOptions?.ownerName || "",
          ownerNameSource: liveOptions?.ownerNameSource || "",
          officialClientId: liveOfficialClientId,
          officialUserId: liveOfficialUserId,
          connectionKey: liveConnectionKey,
          sessionId: liveSessionId,
          socketReadyState: liveSocket?.readyState ?? null,
          socketStatus: liveSocketStatus,
          socketLastError: liveSocketLastError,
          socketLastOpenAt: liveSocketLastOpenAt,
          socketLastMessageAt: liveSocketLastMessageAt,
          socketLastSentAt: liveSocketLastSentAt,
          sideRoom: getLiveSideRoom(),
          officialFileUuid: liveOfficialFileUuid,
          acceptedFileUuids: [...getLiveAcceptedFileUuids()],
          lastSentPayload: liveLastSentPayload,
          lastRawMessage: liveLastRawMessage,
          lastIncomingPayload: liveLastIncomingPayload,
          lastDroppedPayload: liveLastDroppedPayload,
          peerProfiles: [...livePeerProfiles.values()],
          focusSessions: liveFocusSessions,
          remoteCursorCount: liveRemoteCursors.size,
          remoteActivityUntil: liveRemoteActivityUntil,
          peerCount: livePresencePeerCount,
          domPeerCount: liveDomPeerCount,
          officialSyncAvailable: liveOfficialSyncAvailable
        })
      })
    );
  });

  window.addEventListener(EXTENSION_RESPONSE_EVENT, (event) => {
    let response;
    try {
      response = JSON.parse(event.detail);
    } catch {
      return;
    }

    const pending = extensionRequests.get(response.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timer);
    extensionRequests.delete(response.requestId);
    if (response.ok) pending.resolve(response.payload);
    else pending.reject(new Error(response.payload?.error ?? "扩展后台响应失败。"));
  });

  function ensureStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing?.dataset.pixmaxClonerStyleVersion === STYLE_VERSION) return;
    existing?.remove();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.dataset.pixmaxClonerStyleVersion = STYLE_VERSION;
    style.textContent = `
      .${ACTIONS_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-right: 4px;
        padding-right: 4px;
        border-right: 1px solid rgb(255 255 255 / 18%);
      }
      .${ACTIONS_CLASS} button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        padding: 0 8px;
        background: rgb(255 255 255 / 10%);
        color: #f5f5f5;
        cursor: pointer;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: nowrap;
      }
      .${ACTIONS_CLASS} button:hover { background: rgb(255 255 255 / 20%); }
      .${ACTIONS_CLASS} button:disabled { cursor: wait; opacity: .55; }
      .${ACTIONS_CLASS} [data-pixmax-cloner-action="toggle-like"] {
        width: 28px;
        justify-content: center;
        padding: 0;
        font-size: 16px;
        line-height: 1;
      }
      .${ACTIONS_CLASS} [data-pixmax-cloner-action="toggle-like"][data-liked="true"] {
        background: var(--pixmax-cloner-like-color, #ff3864);
        color: #fff;
      }
      ${NODE_SELECTOR}.pixmax-canvas-cloner-liked {
        border-radius: 8px;
        box-shadow:
          0 0 0 3px var(--pixmax-cloner-like-color, #ff3864),
          0 0 0 7px var(--pixmax-cloner-like-glow, rgb(255 56 100 / 22%)) !important;
      }
      ${NODE_SELECTOR}.pixmax-canvas-cloner-liked::after {
        content: "♥";
        position: absolute;
        top: -12px;
        right: -12px;
        z-index: 5;
        display: grid;
        width: 28px;
        height: 28px;
        place-items: center;
        border: 2px solid #fff;
        border-radius: 999px;
        background: var(--pixmax-cloner-like-color, #ff3864);
        color: #fff;
        font: 16px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }
      ${NODE_SELECTOR}.pixmax-canvas-cloner-focus {
        animation: pixmax-canvas-cloner-focus 1.25s ease-out 2;
      }
      .svelte-flow__viewport.pixmax-canvas-cloner-moving {
        transition: transform 260ms cubic-bezier(.2, .8, .2, 1);
        will-change: transform;
      }
      @keyframes pixmax-canvas-cloner-focus {
        0% { filter: brightness(1); box-shadow: 0 0 0 3px var(--pixmax-cloner-like-color, #ff3864), 0 0 0 7px var(--pixmax-cloner-like-glow, rgb(255 56 100 / 22%)); }
        40% { filter: brightness(1.28); box-shadow: 0 0 0 4px var(--pixmax-cloner-like-color, #ff3864), 0 0 0 14px var(--pixmax-cloner-like-glow-strong, rgb(255 56 100 / 34%)); }
        100% { filter: brightness(1); box-shadow: 0 0 0 3px var(--pixmax-cloner-like-color, #ff3864), 0 0 0 7px var(--pixmax-cloner-like-glow, rgb(255 56 100 / 22%)); }
      }
      .${CONTEXT_PASTE_CLASS} { color: #75e9f4 !important; }
      #${TOAST_ID} {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 2147483647;
        max-width: 360px;
        border: 1px solid #3f4248;
        border-radius: 9px;
        padding: 10px 12px;
        background: #141416f2;
        color: #75e9f4;
        box-shadow: 0 10px 30px #0009;
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${TOAST_ID}.error { color: #ff9a92; }
      #${TOAST_ID}.persistent {
        border-color: #f8d66d;
        background: #211c10f5;
        color: #f8d66d;
      }
      #${LIVE_TOGGLE_ID} {
        position: fixed;
        right: 22px;
        bottom: 74px;
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        border: 1px solid #3f4248;
        border-radius: 8px;
        padding: 0 10px;
        background: #141416f2;
        color: #a9adb5;
        box-shadow: 0 10px 30px #0006;
        cursor: pointer;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${LIVE_TOGGLE_ID}[data-active="true"] {
        border-color: #75e9f4;
        color: #75e9f4;
      }
      #${LIVE_TOGGLE_ID}::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #777;
      }
      #${LIVE_TOGGLE_ID}[data-active="true"]::before {
        background: #75e9f4;
        box-shadow: 0 0 0 4px rgb(117 233 244 / 18%);
      }
      #${LIVE_CURSOR_LAYER_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        pointer-events: none;
      }
      .pixmax-canvas-cloner-live-cursor {
        position: absolute;
        left: 0;
        top: 0;
        display: flex;
        align-items: flex-start;
        gap: 4px;
        opacity: 1;
        transform: translate3d(var(--pixmax-live-x, -9999px), var(--pixmax-live-y, -9999px), 0);
        transition: transform 70ms linear, opacity 180ms ease;
        will-change: transform, opacity;
      }
      .pixmax-canvas-cloner-live-cursor[data-stale="true"] {
        opacity: 0;
      }
      .pixmax-canvas-cloner-live-cursor-icon {
        width: 0;
        height: 0;
        border-top: 15px solid var(--pixmax-live-color, #75e9f4);
        border-right: 10px solid transparent;
        filter: drop-shadow(0 2px 5px rgb(0 0 0 / 65%));
      }
      .pixmax-canvas-cloner-live-cursor-name {
        margin-top: 10px;
        max-width: 160px;
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 7px;
        padding: 4px 7px;
        background: color-mix(in srgb, var(--pixmax-live-color, #75e9f4) 22%, #111 78%);
        color: #fff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: 0 6px 16px rgb(0 0 0 / 45%);
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${OPEN_LIKES_BUTTON_ID} {
        cursor: pointer;
      }
      #${OPEN_LIKES_BUTTON_ID} svg {
        fill: none;
        color: inherit;
        opacity: .82;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.75;
      }
      #${OPEN_LIKES_BUTTON_ID} svg:not([class]) {
        width: 24px;
        height: 24px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOpenLikesButton() {
    const target = findCopyShareButton();
    if (!target?.parentElement) {
      document.getElementById(OPEN_LIKES_BUTTON_ID)?.remove();
      return;
    }

    const sourceClass = target.getAttribute("class") || "";
    let button = document.getElementById(OPEN_LIKES_BUTTON_ID);
    if (!button || button.dataset.pixmaxSourceClass !== sourceClass) {
      button?.remove();
      button = createOpenLikesButton(target, sourceClass);
    }
    if (button.nextElementSibling !== target) {
      target.parentElement.insertBefore(button, target);
    }
  }

  function createOpenLikesButton(target, sourceClass) {
    const button = target.cloneNode(false);
    button.id = OPEN_LIKES_BUTTON_ID;
    button.dataset.pixmaxSourceClass = sourceClass || "";
    if (button instanceof HTMLButtonElement) button.type = "button";
    button.removeAttribute("href");
    button.removeAttribute("target");
    button.removeAttribute("rel");
    button.removeAttribute("disabled");
    button.removeAttribute("aria-disabled");
    button.querySelectorAll?.("[id]").forEach((element) => element.removeAttribute("id"));
    button.title = "打开 Pixmax Review Board";
    button.setAttribute("aria-label", "打开 Pixmax Review Board");
    button.innerHTML = createOpenLikesHeartSvg(target);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      requestExtension("open-review-board", {}, 5000).catch((error) => {
        showToast(error.message || "无法打开 Review Board。", true);
      });
    });
    return button;
  }

  function createOpenLikesHeartSvg(target) {
    const nativeSvgClass = target.querySelector?.("svg")?.getAttribute("class") || "";
    const classAttribute = nativeSvgClass ? ` class="${escapeHtmlAttribute(nativeSvgClass)}"` : "";
    return `
      <svg${classAttribute} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.1S5.2 16.2 5.2 10.3a3.7 3.7 0 0 1 6.5-2.4l.3.4.3-.4a3.7 3.7 0 0 1 6.5 2.4c0 5.9-6.8 9.8-6.8 9.8Z"/>
      </svg>
    `;
  }

  function escapeHtmlAttribute(value) {
    return String(value).replace(/[&<>"']/g, (char) => (
      {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]
    ));
  }

  function findCopyShareButton() {
    const candidates = getTopActionCandidates();
    const exact = candidates.find((candidate) => {
      const label = getElementLabel(candidate).replace(/\s+/g, "");
      return label.includes("复制分享链接") || (label.includes("复制") && label.includes("分享"));
    });
    if (exact) return exact;

    const squareButtons = candidates
      .filter((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const label = getElementLabel(candidate).trim();
        const isSingleLetterAvatar = /^[A-Za-z]$/.test(label);
        return (
          !isSingleLetterAvatar &&
          rect.width >= 40 &&
          rect.width <= 86 &&
          rect.height >= 40 &&
          rect.height <= 86
        );
      })
      .sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left);
    return squareButtons[1] || squareButtons[0] || null;
  }

  function getTopActionCandidates() {
    return [...document.querySelectorAll("button, [role='button'], a")]
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.id === OPEN_LIKES_BUTTON_ID || element.closest(`#${OPEN_LIKES_BUTTON_ID}`)) return false;
        if (element.closest(`.${ACTIONS_CLASS}, .${CONTEXT_PASTE_CLASS}, ${TOOLBAR_SELECTOR}`)) return false;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        if (rect.top < 0 || rect.top > 160) return false;
        if (rect.left < 120) return false;
        return true;
      });
  }

  function getElementLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-tooltip"),
      element.getAttribute("data-title"),
      element.textContent
    ]
      .filter(Boolean)
      .join(" ");
  }

  function cleanupLegacyCanvasUi() {
    document.getElementById("pixmax-canvas-cloner-page-toolbar")?.remove();
    for (const element of document.querySelectorAll(
      ".pixmax-canvas-cloner-node-eagle, .pixmax-canvas-cloner-node-prompt"
    )) {
      element.remove();
    }
    for (const node of document.querySelectorAll(".pixmax-canvas-cloner-media-node")) {
      node.classList.remove("pixmax-canvas-cloner-media-node");
    }
    for (const button of document.querySelectorAll(
      '[data-pixmax-cloner-action="eagle-import-batch"]'
    )) {
      button.remove();
    }
  }

  function scheduleLegacyCleanup() {
    if (legacyCleanupScheduled) return;
    legacyCleanupScheduled = true;
    window.requestAnimationFrame(() => {
      legacyCleanupScheduled = false;
      cleanupLegacyCanvasUi();
    });
  }

  function showToast(message, error = false, options = {}) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.toggle("persistent", Boolean(options.persistent));
    window.clearTimeout(toastTimer);
    if (!options.persistent) {
      toastTimer = window.setTimeout(() => toast.remove(), options.duration || 3500);
    }
  }

  async function runAction(action, button) {
    const buttons = [
      ...button.closest(`.${ACTIONS_CLASS}`).querySelectorAll("button")
    ];
    for (const item of buttons) item.disabled = true;

    try {
      const result = await requestBridge(
        action,
        {},
        action === "duplicate-neighbors" ? 15000 : 10000
      );

      if (action === "select-neighbors") {
        showToast(
          `已选中主节点和 ${result.directlyLinkedNodeCount} 个直接连线节点，共 ${result.selectedNodeCount} 个。`
        );
      }

      if (action === "duplicate-neighbors") {
        showToast(
          `已创建带连线副本，并修复 ${result.rewrittenMentionCount} 个 @节点 引用。`
        );
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      for (const item of buttons) item.disabled = false;
    }
  }

  async function importSelectedAssetToEagle(button) {
    button.disabled = true;
    try {
      const item = await requestBridge("get-selected-eagle-asset");
      showToast("正在将素材存入 Eagle...");
      const response = await requestExtension("eagle-import-url", { item });
      if (!response?.ok) throw new Error(response?.error || "Eagle 导入失败。");
      showToast(`已存入 Eagle：${response.name}`);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function getStorageArea() {
    return globalThis.chrome?.storage?.local ?? null;
  }

  function getSyncStorageArea() {
    return globalThis.chrome?.storage?.sync ?? null;
  }

  function storageGet(defaults) {
    return new Promise((resolve, reject) => {
      const storage = getStorageArea();
      if (!storage) {
        reject(new Error("Extension storage is unavailable. Refresh Pixmax and try again."));
        return;
      }

      storage.get(defaults, (result) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(result);
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      const storage = getStorageArea();
      if (!storage) {
        reject(new Error("Extension storage is unavailable. Refresh Pixmax and try again."));
        return;
      }

      storage.set(values, () => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve();
      });
    });
  }

  function syncStorageGet(defaults) {
    return new Promise((resolve, reject) => {
      const storage = getSyncStorageArea();
      if (!storage) {
        reject(new Error("Extension sync storage is unavailable. Refresh Pixmax and try again."));
        return;
      }

      storage.get(defaults, (result) => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(result);
      });
    });
  }

  function syncStorageSet(values) {
    return new Promise((resolve, reject) => {
      const storage = getSyncStorageArea();
      if (!storage) {
        reject(new Error("Extension sync storage is unavailable. Refresh Pixmax and try again."));
        return;
      }

      storage.set(values, () => {
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve();
      });
    });
  }

  async function getSharedLikeOptions() {
    const options = await syncStorageGet(SHARED_OPTIONS_DEFAULTS);
    const fileUuid = String(options.sharedLikesFileUuid || "").trim();
    const ownerName = String(options.sharedLikesOwnerName || "").trim();
    return {
      color: normalizeColor(options.sharedLikesColor),
      enabled: Boolean(options.sharedLikesEnabled && fileUuid && ownerName),
      fileUuid,
      ownerName
    };
  }

  function getCurrentFileUuid() {
    try {
      return new URL(location.href).searchParams.get("file") || "";
    } catch {
      return "";
    }
  }

  function getLiveUserId(ownerName) {
    if (liveSessionId) return liveSessionId;
    try {
      liveSessionId = `pixmax-hub-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return liveSessionId;
    } catch {
      liveSessionId = `pixmax-hub-${ownerName || "user"}-${Math.random().toString(36).slice(2)}`;
      return liveSessionId;
    }
  }

  function getLiveSocketUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/presence/ws`;
  }

  function getLiveSideRoom() {
    const fileUuid = getLiveRoomFileUuid();
    return fileUuid ? `${fileUuid}:pixmax-hub-live` : "";
  }

  function getLiveRoomFileUuid() {
    return liveOfficialFileUuid || liveOptions?.fileUuid || getCurrentFileUuid();
  }

  function getLiveAcceptedFileUuids() {
    return new Set(
      [liveOptions?.fileUuid, liveOfficialFileUuid, getCurrentFileUuid()]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
  }

  function isLivePayloadForThisCanvas(payload) {
    if (!payload || typeof payload !== "object") return false;
    const payloadFileUuid = String(payload.fileUuid || payload.roomFileUuid || "").trim();
    if (!payloadFileUuid) return true;
    return getLiveAcceptedFileUuids().has(payloadFileUuid);
  }

  async function getLiveCollabOptions() {
    const options = await syncStorageGet(SHARED_OPTIONS_DEFAULTS);
    const fileUuid = getCurrentFileUuid();
    const configuredOwnerName = String(options.sharedLikesOwnerName || "").trim();
    const fallbackIdentity = configuredOwnerName ? null : await getFallbackLiveIdentity();
    const ownerName = configuredOwnerName || fallbackIdentity.ownerName;
    return {
      color: configuredOwnerName ? normalizeColor(options.sharedLikesColor) : fallbackIdentity.color,
      enabled: Boolean(options.liveCollabEnabled && fileUuid && ownerName),
      fileUuid,
      ownerName,
      ownerNameSource: configuredOwnerName ? "configured" : "fallback",
      rawEnabled: Boolean(options.liveCollabEnabled)
    };
  }

  async function getFallbackLiveIdentity() {
    const values = await storageGet({ [LIVE_IDENTITY_STORAGE_KEY]: null });
    const existing = values[LIVE_IDENTITY_STORAGE_KEY];
    if (existing?.ownerName && /^#[0-9a-f]{6}$/i.test(existing.color || "")) {
      return {
        ownerName: String(existing.ownerName).slice(0, 40),
        color: normalizeColor(existing.color)
      };
    }

    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const color = LIVE_FALLBACK_COLORS[
      Math.floor(Math.random() * LIVE_FALLBACK_COLORS.length)
    ];
    const identity = {
      ownerName: `协作者 ${suffix}`,
      color
    };
    await storageSet({ [LIVE_IDENTITY_STORAGE_KEY]: identity }).catch(() => {});
    return identity;
  }

  function ensureLiveToggle() {
    let button = document.getElementById(LIVE_TOGGLE_ID);
    if (button) return button;

    button = document.createElement("button");
    button.id = LIVE_TOGGLE_ID;
    button.type = "button";
    button.title = "开启后显示协同鼠标，并自动监听云端版本变化。名字和颜色在扩展弹窗里设置。";
    button.addEventListener("click", toggleLiveCollabFromPage);
    document.body.appendChild(button);
    return button;
  }

  function updateLiveToggle() {
    const button = ensureLiveToggle();
    const active = Boolean(liveOptions?.enabled);
    button.dataset.active = active ? "true" : "false";
    const waitingForPeer = active && !hasConfirmedLiveRemotePeer();
    button.textContent = active
      ? waitingForPeer
        ? "实时协同 等待成员"
        : "实时协同 开"
      : "实时协同 关";
    scheduleOfficialPresenceAppearance();
  }

  async function toggleLiveCollabFromPage() {
    try {
      const nextEnabled = !Boolean(liveOptions?.rawEnabled);
      await syncStorageSet({ liveCollabEnabled: nextEnabled });
      showToast(nextEnabled ? "实时协同已开启。" : "实时协同已关闭。");
      await syncLiveCollabState();
    } catch (error) {
      showToast(error.message || String(error), true);
    }
  }

  async function syncLiveCollabState() {
    try {
      liveOptions = await getLiveCollabOptions();
      updateLiveToggle();
      if (liveOptions.enabled) {
        refreshOfficialLiveSyncStatus();
        startLiveCollab();
      }
      else stopLiveCollab();
    } catch (error) {
      stopLiveCollab();
      showToast(error.message || String(error), true);
    }
  }

  function startLiveCollab() {
    if (!liveOptions?.enabled) return;
    const nextConnectionKey = `${liveOptions.fileUuid}:${liveOptions.ownerName}:${liveOptions.color}`;
    if (liveConnectionKey && liveConnectionKey !== nextConnectionKey) {
      closeLiveSocket();
      liveLastKnownRevision = null;
    }
    liveConnectionKey = nextConnectionKey;
    liveSessionId = getLiveUserId(liveOptions.ownerName);
    ensureLiveCursorLayer();
    connectLiveSocket();
    document.addEventListener("pointermove", handleLivePointerMove, true);
    document.addEventListener("pointerleave", handleLivePointerLeave, true);
    document.addEventListener("pointerup", handleLiveLocalActivity, true);
    document.addEventListener("click", handleLiveLocalFocusActivity, true);
    document.addEventListener("keyup", handleLiveLocalFocusActivity, true);
    document.addEventListener("change", handleLiveLocalActivity, true);
    document.addEventListener("input", handleLiveLocalActivity, true);
    configureOfficialPresence();
    startLiveRevisionPolling();
    startLiveCursorCleanup();
    renderLiveSelectionColor();
  }

  function stopLiveCollab() {
    document.removeEventListener("pointermove", handleLivePointerMove, true);
    document.removeEventListener("pointerleave", handleLivePointerLeave, true);
    document.removeEventListener("pointerup", handleLiveLocalActivity, true);
    document.removeEventListener("click", handleLiveLocalFocusActivity, true);
    document.removeEventListener("keyup", handleLiveLocalFocusActivity, true);
    document.removeEventListener("change", handleLiveLocalActivity, true);
    document.removeEventListener("input", handleLiveLocalActivity, true);
    window.clearTimeout(liveReconnectTimer);
    window.clearTimeout(liveFocusBroadcastTimer);
    window.clearTimeout(liveSyncTriggerTimer);
    window.clearInterval(liveRevisionTimer);
    window.clearInterval(liveCursorCleanupTimer);
    liveRevisionTimer = 0;
    liveCursorCleanupTimer = 0;
    liveConnectionKey = "";
    liveOfficialFileUuid = "";
    liveOfficialClientId = "";
    liveOfficialUserId = "";
    liveLastRawMessage = null;
    liveLastIncomingPayload = null;
    liveLastDroppedPayload = null;
    liveLastSentPayload = null;
    liveLastProfileBroadcastKey = "";
    liveLastProfileBroadcastAt = 0;
    liveLastFocusBroadcastAt = 0;
    liveLastFocusHeartbeatAt = 0;
    liveLastFocusSignature = "";
    liveLastKnownRevision = null;
    liveSyncInFlight = false;
    liveSyncQueued = false;
    liveRemoteActivityUntil = 0;
    livePresencePeerCount = 1;
    liveDomPeerCount = 1;
    liveMultiUserSyncNotified = false;
    liveOfficialSyncAvailable = false;
    liveOfficialSyncWarned = false;
    livePendingNodeIds.clear();
    liveRemoteFocuses.clear();
    livePeerProfiles.clear();
    liveFocusSessions = [];
    restoreOfficialFocusColors();
    renderLiveFocusColors();
    renderLiveSelectionColor();
    clearLiveRemoteCursors();
    updateLiveToggle();
  }

  function connectLiveSocket() {
    if (!liveOptions?.enabled) return;
    if (liveSocket?.readyState === WebSocket.OPEN || liveSocket?.readyState === WebSocket.CONNECTING) return;
    const room = getLiveSideRoom();
    if (!room) return;

    closeLiveSocket({ reconnect: false });
    let socket;
    try {
      liveSocketStatus = "connecting";
      liveSocketLastError = "";
      socket = new WebSocket(getLiveSocketUrl());
    } catch {
      liveSocketStatus = "connect-error";
      liveSocketLastError = "constructor";
      scheduleLiveSocketReconnect();
      return;
    }

    liveSocket = socket;
    socket.addEventListener("open", () => {
      liveSocketStatus = "open";
      liveSocketLastOpenAt = Date.now();
      liveSocketReconnectAttempt = 0;
      socket.send(
        JSON.stringify({
          type: "join",
          room,
          color: liveOptions.color,
          profileColor: liveOptions.color,
          userId: liveSessionId,
          userName: liveOptions.ownerName
        })
      );
      window.setTimeout(() => broadcastLiveProfile("side-room-open"), 80);
    });
    socket.addEventListener("message", (event) => {
      liveSocketLastMessageAt = Date.now();
      handleLiveSocketMessage(String(event.data || ""));
    });
    socket.addEventListener("close", () => {
      if (liveSocket === socket) liveSocket = null;
      liveSocketStatus = "closed";
      if (!socket.__pixmaxHubLiveClosing) scheduleLiveSocketReconnect();
    });
    socket.addEventListener("error", () => {
      liveSocketStatus = "error";
      liveSocketLastError = "socket-error";
      if (!socket.__pixmaxHubLiveClosing) scheduleLiveSocketReconnect();
    });
  }

  function scheduleLiveSocketReconnect() {
    if (!liveOptions?.enabled) return;
    window.clearTimeout(liveReconnectTimer);
    const delay = Math.min(3000, 500 + liveSocketReconnectAttempt * 350);
    liveSocketReconnectAttempt += 1;
    liveReconnectTimer = window.setTimeout(() => {
      connectLiveSocket();
    }, delay);
  }

  function closeLiveSocket(options = {}) {
    window.clearTimeout(liveReconnectTimer);
    if (options.reconnect === false) {
      liveReconnectTimer = 0;
    }
    const socket = liveSocket;
    liveSocket = null;
    if (!socket) return;
    socket.__pixmaxHubLiveClosing = true;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }

  async function configureOfficialPresence() {
    if (!liveOptions?.enabled) return;
    liveSessionId = getLiveUserId(liveOptions.ownerName);
    try {
      const status = await requestBridge(
        "set-live-presence-identity",
        {
          color: liveOptions.color,
          ownerName: liveOptions.ownerName
        },
        4000
      );
      updateLivePresenceStatus(status);
      broadcastLiveProfile("official-presence");
      if (!status?.available && !liveOfficialSyncWarned) {
        liveOfficialSyncWarned = true;
        showToast("需要刷新 Pixmax 页面，才能把官方在线用户改成你的名字和颜色。", true, {
          duration: 5200
        });
      }
      scheduleOfficialPresenceAppearance();
    } catch {
      // Presence identity is cosmetic; keep live sync running.
    }
  }

  function broadcastLivePayload(payload) {
    const finalPayload = {
      ...payload,
      color: normalizeColor(payload.color || liveOptions?.color),
      fileUuid: getLiveRoomFileUuid(),
      officialClientId: liveOfficialClientId,
      officialUserId: liveOfficialUserId,
      ownerName: payload.ownerName || liveOptions?.ownerName || "",
      roomFileUuid: getLiveRoomFileUuid(),
      urlFileUuid: liveOptions?.fileUuid || "",
      senderId: liveSessionId,
      sentAt: Date.now()
    };
    liveLastSentPayload = finalPayload;
    if (liveSocket?.readyState === WebSocket.OPEN) {
      liveSocket.send(JSON.stringify({ type: "broadcast", payload: finalPayload }));
      liveSocketLastSentAt = Date.now();
    } else {
      connectLiveSocket();
    }
    return requestBridge(
      "broadcast-official-presence",
      finalPayload,
      2500
    ).catch(() => null);
  }

  function broadcastLiveProfile(reason) {
    if (!liveOptions?.enabled) return;
    const profileKey = [
      liveOptions.ownerName,
      liveOptions.color,
      liveOfficialClientId,
      liveOfficialUserId
    ].join("|");
    const now = Date.now();
    if (
      reason !== "force" &&
      profileKey === liveLastProfileBroadcastKey &&
      now - liveLastProfileBroadcastAt < 1500
    ) {
      return;
    }
    liveLastProfileBroadcastKey = profileKey;
    liveLastProfileBroadcastAt = now;
    rememberLivePeerProfile({
      color: liveOptions.color,
      officialClientId: liveOfficialClientId,
      officialUserId: liveOfficialUserId,
      ownerName: liveOptions.ownerName,
      senderId: liveSessionId
    });
    broadcastLivePayload({
      kind: "pixmax-live-profile",
      reason
    });
  }

  function handleLiveSocketMessage(value) {
    let message;
    try {
      message = JSON.parse(String(value || ""));
    } catch {
      return;
    }
    liveLastRawMessage = message;

    updateLivePresenceStatus(message);
    if (message.type === "room-session-focus" && Array.isArray(message.sessions)) {
      liveFocusSessions = message.sessions.filter((session) => session?.nodeId);
      broadcastLiveProfile("focus-session");
      renderLiveFocusColors();
    }

    const payload = message.payload && typeof message.payload === "object"
      ? message.payload
      : message.type === "broadcast" && message.data && typeof message.data === "object"
        ? message.data
        : String(message.kind || "").startsWith("pixmax-live-")
          ? message
        : null;
    if (!payload || payload.senderId === liveSessionId || !isLivePayloadForThisCanvas(payload)) {
      if (payload) liveLastDroppedPayload = payload;
      return;
    }

    liveLastIncomingPayload = payload;
    rememberLivePeerProfile(payload);
    markLiveRemoteActivity();

    if (payload.kind === "pixmax-live-profile") {
      scheduleOfficialPresenceAppearance();
      renderLiveFocusColors();
      return;
    }

    if (payload.kind === "pixmax-live-cursor") {
      renderRemoteLiveCursor(payload);
      return;
    }

    if (payload.kind === "pixmax-live-cursor-hide") {
      hideRemoteLiveCursor(payload.senderId);
      return;
    }

    if (payload.kind === "pixmax-live-focus") {
      renderRemoteLiveFocus(payload);
      return;
    }

    if (payload.kind === "pixmax-live-revision") {
      scheduleLiveRevisionCheck("remote-broadcast", payload.revision);
      return;
    }
  }

  function updateLivePresenceStatus(status = {}) {
    const previousClientId = liveOfficialClientId;
    const previousUserId = liveOfficialUserId;
    if (status.clientId) liveOfficialClientId = String(status.clientId || "");
    if (status.lastJoin?.userId) liveOfficialUserId = String(status.lastJoin.userId || "");
    if (Array.isArray(status.peers)) {
      for (const peer of status.peers) {
        rememberLivePeerProfile(peer);
        if (
          liveOfficialClientId &&
          peer?.clientId === liveOfficialClientId &&
          peer?.userId &&
          !liveOfficialUserId
        ) {
          liveOfficialUserId = String(peer.userId || "");
        }
        if (
          liveOptions?.ownerName &&
          String(peer?.userName || "").trim() === liveOptions.ownerName &&
          peer?.userId &&
          !liveOfficialUserId
        ) {
          liveOfficialUserId = String(peer.userId || "");
        }
      }
    }
    if (
      (liveOfficialClientId && liveOfficialClientId !== previousClientId) ||
      (liveOfficialUserId && liveOfficialUserId !== previousUserId)
    ) {
      broadcastLiveProfile("official-id-ready");
    }
    const nextPeerCount = Number.isFinite(Number(status.peerCount))
      ? Math.max(1, Number(status.peerCount))
      : Array.isArray(status.peers)
        ? Math.max(1, status.peers.length)
        : livePresencePeerCount;
    const hadRemotePeer = hasLiveRemotePeer();
    livePresencePeerCount = nextPeerCount;
    const hasRemotePeer = hasLiveRemotePeer();
    updateLiveToggle();
    renderLiveFocusColors();
    if (hasRemotePeer && !hadRemotePeer) {
      liveMultiUserSyncNotified = true;
      if (liveSyncQueued || Date.now() - liveLastLocalActivityAt < 15000) {
        scheduleLiveOfficialSync();
      }
      scheduleLiveRevisionCheck("peer-joined");
    }
  }

  function hasLiveRemotePeer() {
    return (
      hasConfirmedLiveRemotePeer() ||
      Date.now() < liveRemoteActivityUntil ||
      liveRemoteCursors.size > 0
    );
  }

  function hasConfirmedLiveRemotePeer() {
    return (
      livePresencePeerCount >= 2 ||
      hasCollaborationConflictDialog()
    );
  }

  function markLiveRemoteActivity() {
    const hadRemotePeer = hasLiveRemotePeer();
    liveRemoteActivityUntil = Date.now() + LIVE_REMOTE_ACTIVITY_GRACE_MS;
    if (livePresencePeerCount < 2) livePresencePeerCount = 2;
    updateLiveToggle();
    if (!hadRemotePeer && (liveSyncQueued || Date.now() - liveLastLocalActivityAt < 15000)) {
      scheduleLiveOfficialSync();
    }
  }

  function rememberLivePeerProfile(profile = {}) {
    const ownerName = String(profile.ownerName || profile.userName || "").trim();
    const color = normalizeOptionalColor(profile.color || profile.profileColor);
    const keys = [
      profile.senderId && `sender:${profile.senderId}`,
      profile.officialUserId && `user:${profile.officialUserId}`,
      profile.userId && `user:${profile.userId}`,
      profile.officialClientId && `client:${profile.officialClientId}`,
      profile.clientId && `client:${profile.clientId}`,
      ownerName && `name:${ownerName}`
    ].filter(Boolean);
    if (!keys.length || !ownerName) return;

    const existing =
      keys.map((key) => livePeerProfiles.get(key)).find(Boolean) || {};
    const next = {
      ...existing,
      color: color || existing.color || "",
      ownerName,
      senderId: profile.senderId || existing.senderId || "",
      officialUserId: profile.officialUserId || profile.userId || existing.officialUserId || "",
      officialClientId: profile.officialClientId || profile.clientId || existing.officialClientId || ""
    };
    for (const key of keys) livePeerProfiles.set(key, next);
  }

  function getLiveProfileForSession(session = {}) {
    const keys = [
      session.userId && `user:${session.userId}`,
      session.clientId && `client:${session.clientId}`,
      session.userName && `name:${session.userName}`,
      session.ownerName && `name:${session.ownerName}`
    ].filter(Boolean);
    for (const key of keys) {
      const profile = livePeerProfiles.get(key);
      if (profile) return profile;
    }
    const remoteProfiles = getLiveDisplayProfiles().filter((profile) => {
      if (liveSessionId && profile.senderId === liveSessionId) return false;
      if (liveOfficialClientId && profile.officialClientId === liveOfficialClientId) return false;
      if (liveOfficialUserId && profile.officialUserId === liveOfficialUserId) return false;
      return Boolean(profile.color);
    });
    if (remoteProfiles.length === 1) return remoteProfiles[0];
    return null;
  }

  function getLiveDisplayProfiles() {
    const profiles = new Map();
    if (liveOptions?.ownerName) {
      profiles.set(`own:${liveOptions.ownerName}`, {
        color: liveOptions.color,
        ownerName: liveOptions.ownerName,
        officialClientId: liveOfficialClientId,
        officialUserId: liveOfficialUserId,
        senderId: liveSessionId
      });
    }
    for (const profile of livePeerProfiles.values()) {
      const key =
        profile.officialUserId ||
        profile.officialClientId ||
        profile.senderId ||
        profile.ownerName;
      if (key) profiles.set(key, profile);
    }
    return [...profiles.values()];
  }

  function renderLiveFocusColors() {
    neutralizeOfficialFocusColors();
    let style = document.getElementById(LIVE_FOCUS_STYLE_ID);
    const grouped = new Map();
    for (const entry of liveRemoteFocuses.values()) {
      if (!entry.nodeIds.length) continue;
      for (const nodeId of entry.nodeIds) {
        const colors = grouped.get(nodeId) || [];
        if (!colors.includes(entry.color)) colors.push(entry.color);
        grouped.set(nodeId, colors);
      }
    }
    for (const session of liveFocusSessions) {
      const nodeId = String(session.nodeId || "").trim();
      if (!nodeId) continue;
      const profile = getLiveProfileForSession(session);
      const color = profile?.color;
      if (!color) continue;
      const colors = grouped.get(nodeId) || [];
      if (!colors.includes(color)) colors.push(color);
      grouped.set(nodeId, colors);
    }

    if (!grouped.size) {
      style?.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = LIVE_FOCUS_STYLE_ID;
      document.head.appendChild(style);
    }
    if (style.parentNode === document.head) document.head.appendChild(style);

    const rules = [];
    for (const [nodeId, colors] of grouped) {
      const escapedNodeId = window.CSS?.escape ? CSS.escape(nodeId) : nodeId.replace(/"/g, '\\"');
      const shadows = colors
        .map((color, index) => `0 0 0 ${2 + index * 2}px ${color}`)
        .join(", ");
      rules.push(
        `#app .svelte-flow__node[data-id="${escapedNodeId}"] { box-shadow: ${shadows} !important; border-radius: 12px; }`,
        `#app .svelte-flow__node[data-id="${escapedNodeId}"] .node-container,
         #app .svelte-flow__node[data-id="${escapedNodeId}"] [class*="node-container"] {
          border-color: ${colors[0]} !important;
          box-shadow: 0 0 0 1px ${colors[0]} !important;
        }`,
        `#app .svelte-flow__node[data-id="${escapedNodeId}"] [class*="border"],
         #app .svelte-flow__node[data-id="${escapedNodeId}"] [style*="border-color"] {
          border-color: ${colors[0]} !important;
        }`,
        `#app .svelte-flow__node[data-id="${escapedNodeId}"]::before {
          border-color: ${colors[0]} !important;
          box-shadow: ${shadows} !important;
        }`
      );
    }
    style.textContent = rules.join("\n");
  }

  function neutralizeOfficialFocusColors() {
    if (!liveOptions?.enabled) return;
    const style = document.getElementById(OFFICIAL_FOCUS_STYLE_ID);
    if (!style) return;
    style.dataset.pixmaxHubDisabledFocus = "true";
    style.disabled = true;
  }

  function restoreOfficialFocusColors() {
    const style = document.getElementById(OFFICIAL_FOCUS_STYLE_ID);
    if (!style || style.dataset.pixmaxHubDisabledFocus !== "true") return;
    style.disabled = false;
    delete style.dataset.pixmaxHubDisabledFocus;
  }

  function renderLiveSelectionColor() {
    let style = document.getElementById(LIVE_SELECTION_STYLE_ID);
    if (!liveOptions?.enabled || !liveOptions.color) {
      style?.remove();
      return;
    }

    const color = normalizeColor(liveOptions.color);
    const [red, green, blue] = hexToRgb(color);
    const soft = `rgb(${red} ${green} ${blue} / 22%)`;
    const glow = `rgb(${red} ${green} ${blue} / 46%)`;
    if (!style) {
      style = document.createElement("style");
      style.id = LIVE_SELECTION_STYLE_ID;
      document.head.appendChild(style);
    }

    style.textContent = `
      #app .svelte-flow__node.selected,
      #app .svelte-flow__node[aria-selected="true"],
      #app .svelte-flow__node[data-selected="true"] {
        border-color: ${color} !important;
        border-radius: 12px !important;
        box-shadow: 0 0 0 2px ${color}, 0 0 0 6px ${soft} !important;
      }

      #app .svelte-flow__node.selected .node-container,
      #app .svelte-flow__node[aria-selected="true"] .node-container,
      #app .svelte-flow__node[data-selected="true"] .node-container,
      #app .svelte-flow__node.selected [class*="node-container"],
      #app .svelte-flow__node[aria-selected="true"] [class*="node-container"],
      #app .svelte-flow__node[data-selected="true"] [class*="node-container"] {
        border-color: ${color} !important;
        box-shadow: 0 0 0 1px ${color}, 0 0 0 5px ${soft} !important;
      }

      #app .svelte-flow__node.selected [class*="border"],
      #app .svelte-flow__node[aria-selected="true"] [class*="border"],
      #app .svelte-flow__node[data-selected="true"] [class*="border"],
      #app .svelte-flow__node.selected [style*="border-color"],
      #app .svelte-flow__node[aria-selected="true"] [style*="border-color"],
      #app .svelte-flow__node[data-selected="true"] [style*="border-color"] {
        border-color: ${color} !important;
      }

      #app .svelte-flow__node.selected::before,
      #app .svelte-flow__node[aria-selected="true"]::before,
      #app .svelte-flow__node[data-selected="true"]::before {
        border-color: ${color} !important;
        box-shadow: 0 0 12px ${glow} !important;
      }
    `;
  }

  function getFlowTransform() {
    const pane = document.querySelector(".svelte-flow__pane") || document.querySelector(".svelte-flow");
    const viewport = document.querySelector(".svelte-flow__viewport");
    if (!pane || !viewport || !window.DOMMatrix) return null;

    const paneRect = pane.getBoundingClientRect();
    const transform = getComputedStyle(viewport).transform;
    const matrix = transform && transform !== "none" ? new DOMMatrix(transform) : new DOMMatrix();
    const scale = matrix.a || 1;
    return { matrix, paneRect, scale };
  }

  function screenToFlowPoint(clientX, clientY) {
    const transform = getFlowTransform();
    if (!transform) return null;
    return {
      x: (clientX - transform.paneRect.left - transform.matrix.e) / transform.scale,
      y: (clientY - transform.paneRect.top - transform.matrix.f) / transform.scale
    };
  }

  function flowToScreenPoint(x, y) {
    const transform = getFlowTransform();
    if (!transform) return null;
    return {
      x: transform.paneRect.left + transform.matrix.e + x * transform.scale,
      y: transform.paneRect.top + transform.matrix.f + y * transform.scale
    };
  }

  function handleLivePointerMove(event) {
    if (!liveOptions?.enabled || event.pointerType === "touch") return;
    broadcastLiveProfile("pointer");
    scheduleLiveFocusBroadcast("pointer", 80);
    if (event.buttons && event.target?.closest?.(".svelte-flow")) {
      markLiveDirtyNodes(event.target);
      scheduleLiveOfficialSync();
      scheduleLiveRevisionCheck("drag");
    }
    const now = Date.now();
    if (now - liveLastCursorSentAt < LIVE_CURSOR_SEND_INTERVAL_MS) return;
    const point = screenToFlowPoint(event.clientX, event.clientY);
    if (!point) return;

    liveLastCursorSentAt = now;
    broadcastLivePayload({
      kind: "pixmax-live-cursor",
      color: liveOptions.color,
      ownerName: liveOptions.ownerName,
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10
    });
  }

  function handleLivePointerLeave() {
    if (!liveOptions?.enabled) return;
    broadcastLivePayload({
      kind: "pixmax-live-cursor-hide",
      ownerName: liveOptions.ownerName
    });
  }

  function handleLiveLocalFocusActivity() {
    if (!liveOptions?.enabled) return;
    scheduleLiveFocusBroadcast("focus-activity", 60);
  }

  function handleLiveLocalActivity() {
    if (!liveOptions?.enabled) return;
    broadcastLiveProfile("local-activity");
    scheduleLiveFocusBroadcast("local-activity", 80);
    liveLastLocalActivityAt = Date.now();
    scheduleLiveOfficialSync();
    scheduleLiveRevisionCheck("local-activity");
  }

  function scheduleLiveFocusBroadcast(reason, delay = 80) {
    window.clearTimeout(liveFocusBroadcastTimer);
    liveFocusBroadcastTimer = window.setTimeout(() => {
      broadcastLiveFocus(reason);
    }, delay);
  }

  function getSelectedLiveNodeIds() {
    const selectors = [
      `${NODE_SELECTOR}.selected`,
      `${NODE_SELECTOR}[aria-selected="true"]`,
      `${NODE_SELECTOR}[data-selected="true"]`
    ].join(",");
    return [...document.querySelectorAll(selectors)]
      .map((node) => node.dataset.id || node.getAttribute("data-id") || "")
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .sort();
  }

  function broadcastLiveFocus(reason) {
    if (!liveOptions?.enabled) return;
    const now = Date.now();
    const nodeIds = getSelectedLiveNodeIds();
    const signature = nodeIds.join("|");
    if (
      signature === liveLastFocusSignature &&
      now - liveLastFocusBroadcastAt < LIVE_FOCUS_SEND_INTERVAL_MS
    ) {
      return;
    }
    liveLastFocusSignature = signature;
    liveLastFocusBroadcastAt = now;
    broadcastLiveProfile("focus");
    broadcastLivePayload({
      kind: "pixmax-live-focus",
      color: liveOptions.color,
      nodeIds,
      ownerName: liveOptions.ownerName,
      reason
    });
  }

  function maybeBroadcastLiveFocusHeartbeat(now) {
    if (!liveOptions?.enabled) return;
    if (now - liveLastFocusHeartbeatAt < LIVE_FOCUS_HEARTBEAT_MS) return;
    const nodeIds = getSelectedLiveNodeIds();
    if (!nodeIds.length) return;
    liveLastFocusHeartbeatAt = now;
    liveLastFocusSignature = "";
    broadcastLiveFocus("focus-heartbeat");
  }

  function renderRemoteLiveFocus(payload = {}) {
    const senderId = String(payload.senderId || "");
    if (!senderId) return;
    const nodeIds = Array.isArray(payload.nodeIds)
      ? payload.nodeIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    liveRemoteFocuses.set(senderId, {
      color: normalizeColor(payload.color),
      lastSeenAt: Date.now(),
      nodeIds,
      ownerName: String(payload.ownerName || "协作者").slice(0, 40)
    });
    renderLiveFocusColors();
  }

  async function refreshOfficialLiveSyncStatus() {
    try {
      const previousSideRoom = getLiveSideRoom();
      const status = await requestBridge("get-official-live-sync-status", {}, 4000);
      liveOfficialSyncAvailable = Boolean(status?.available);
      if (status?.fileUuid) {
        liveOfficialFileUuid = String(status.fileUuid || "").trim();
        const nextSideRoom = getLiveSideRoom();
        if (
          liveOptions?.enabled &&
          previousSideRoom &&
          nextSideRoom &&
          previousSideRoom !== nextSideRoom
        ) {
          closeLiveSocket({ reconnect: false });
          connectLiveSocket();
        }
      }
      if (!liveOfficialSyncAvailable && !liveOfficialSyncWarned) {
        liveOfficialSyncWarned = true;
        showToast("实时协同需要刷新 Pixmax 页面后捕获瑞云官方同步入口。", true, {
          duration: 5200
        });
      }
    } catch {
      liveOfficialSyncAvailable = false;
    }
  }

  function markLiveDirtyNodes(target) {
    liveLastLocalActivityAt = Date.now();
    const node = target?.closest?.(NODE_SELECTOR);
    if (node?.dataset.id) livePendingNodeIds.add(node.dataset.id);
    for (const selectedNode of document.querySelectorAll(`${NODE_SELECTOR}.selected`)) {
      if (selectedNode.dataset.id) livePendingNodeIds.add(selectedNode.dataset.id);
    }
  }

  function scheduleLiveOfficialSync() {
    if (!hasLiveRemotePeer()) {
      liveSyncQueued = true;
      window.clearTimeout(liveSyncTriggerTimer);
      return;
    }
    const now = Date.now();
    const delay = Math.max(0, LIVE_SYNC_TRIGGER_INTERVAL_MS - (now - liveLastSyncTriggeredAt));
    window.clearTimeout(liveSyncTriggerTimer);
    liveSyncTriggerTimer = window.setTimeout(() => {
      if (liveSyncInFlight) {
        liveSyncQueued = true;
        return;
      }
      liveSyncInFlight = true;
      liveSyncQueued = false;
      liveLastSyncTriggeredAt = Date.now();
      livePendingNodeIds.clear();
      requestBridge(
        "trigger-official-workspace-sync",
        { reason: "pixmax-hub-live" },
        12000
      )
        .then((result) => {
          liveOfficialSyncAvailable = Boolean(result?.available);
          if (!liveOfficialSyncAvailable && !liveOfficialSyncWarned) {
            liveOfficialSyncWarned = true;
            showToast("没有捕获到瑞云官方同步入口，请刷新 Pixmax 页面后再试。", true, {
              duration: 5200
            });
          }
          if (result?.revision) {
            liveLastKnownRevision = result.revision;
            broadcastLiveRevision("official-sync", result.revision);
          }
        })
        .then(() => scheduleLiveRevisionCheck("official-sync"))
        .catch(() => {})
        .finally(() => {
          liveSyncInFlight = false;
          if (liveSyncQueued || liveLastLocalActivityAt > liveLastSyncTriggeredAt) {
            liveSyncQueued = false;
            scheduleLiveOfficialSync();
          }
        });
    }, delay);
  }

  function ensureLiveCursorLayer() {
    let layer = document.getElementById(LIVE_CURSOR_LAYER_ID);
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = LIVE_CURSOR_LAYER_ID;
    document.body.appendChild(layer);
    return layer;
  }

  function renderRemoteLiveCursor(payload) {
    const point = flowToScreenPoint(Number(payload.x), Number(payload.y));
    if (!point) return;

    const senderId = String(payload.senderId || "");
    if (!senderId) return;
    const layer = ensureLiveCursorLayer();
    let cursor = liveRemoteCursors.get(senderId)?.element;
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.className = "pixmax-canvas-cloner-live-cursor";
      cursor.innerHTML = `
        <span class="pixmax-canvas-cloner-live-cursor-icon"></span>
        <span class="pixmax-canvas-cloner-live-cursor-name"></span>
      `;
      layer.appendChild(cursor);
    }

    cursor.dataset.stale = "false";
    cursor.style.setProperty("--pixmax-live-x", `${point.x}px`);
    cursor.style.setProperty("--pixmax-live-y", `${point.y}px`);
    cursor.style.setProperty("--pixmax-live-color", normalizeColor(payload.color));
    cursor.querySelector(".pixmax-canvas-cloner-live-cursor-name").textContent =
      String(payload.ownerName || "协作者").slice(0, 40);
    liveRemoteCursors.set(senderId, {
      element: cursor,
      lastSeenAt: Date.now(),
      x: Number(payload.x),
      y: Number(payload.y)
    });
  }

  function hideRemoteLiveCursor(senderId) {
    const entry = liveRemoteCursors.get(String(senderId || ""));
    if (entry?.element) entry.element.dataset.stale = "true";
  }

  function clearLiveRemoteCursors() {
    for (const entry of liveRemoteCursors.values()) {
      entry.element?.remove();
    }
    liveRemoteCursors.clear();
    document.getElementById(LIVE_CURSOR_LAYER_ID)?.remove();
  }

  function startLiveCursorCleanup() {
    if (liveCursorCleanupTimer) return;
    liveCursorCleanupTimer = window.setInterval(() => {
      const now = Date.now();
      for (const [senderId, entry] of liveRemoteCursors) {
        const point = flowToScreenPoint(entry.x, entry.y);
        if (point) {
          entry.element.style.setProperty("--pixmax-live-x", `${point.x}px`);
          entry.element.style.setProperty("--pixmax-live-y", `${point.y}px`);
        }
        if (now - entry.lastSeenAt > LIVE_REMOTE_CURSOR_TTL_MS) {
          entry.element.dataset.stale = "true";
        }
        if (now - entry.lastSeenAt > LIVE_REMOTE_CURSOR_TTL_MS * 3) {
          entry.element.remove();
          liveRemoteCursors.delete(senderId);
        }
      }
      let focusChanged = false;
      for (const [senderId, entry] of liveRemoteFocuses) {
        if (now - entry.lastSeenAt > LIVE_REMOTE_FOCUS_STALE_MS) {
          liveRemoteFocuses.delete(senderId);
          focusChanged = true;
        }
      }
      if (focusChanged) renderLiveFocusColors();
      maybeBroadcastLiveFocusHeartbeat(now);
      updateLiveToggle();
    }, 250);
  }

  function startLiveRevisionPolling() {
    if (liveRevisionTimer) return;
    scheduleLiveRevisionCheck("start");
    liveRevisionTimer = window.setInterval(() => {
      scheduleLiveRevisionCheck("poll");
    }, LIVE_REVISION_POLL_INTERVAL_MS);
  }

  function scheduleLiveRevisionCheck(reason, hintedRevision = null) {
    if (!hasLiveRemotePeer() && reason !== "start" && reason !== "remote-broadcast") return;
    window.clearTimeout(scheduleLiveRevisionCheck.timer);
    scheduleLiveRevisionCheck.timer = window.setTimeout(() => {
      checkLiveRevision(reason, hintedRevision).catch(() => {});
    }, reason === "remote-broadcast" ? LIVE_REMOTE_BROADCAST_PULL_DELAY_MS : LIVE_REVISION_CHECK_DELAY_MS);
  }

  async function checkLiveRevision(reason, hintedRevision = null) {
    if (!liveOptions?.enabled) return;
    if (!hasLiveRemotePeer() && reason !== "remote-broadcast") return;
    if (reason === "remote-broadcast" && hintedRevision && hintedRevision !== liveLastKnownRevision) {
      liveLastKnownRevision = hintedRevision;
      pullOfficialLiveRemoteSnapshot(hintedRevision);
      return;
    }

    const result = await requestBridge("get-current-canvas-revision", {}, 8000);
    const revision = result?.revision ?? null;
    if (revision == null) return;

    if (liveLastKnownRevision == null) {
      liveLastKnownRevision = revision;
      return;
    }

    if (revision === liveLastKnownRevision) return;

    liveLastKnownRevision = revision;
    const isProbablyLocal = Date.now() - liveLastLocalActivityAt < 4500 && reason !== "remote-broadcast";
    if (isProbablyLocal) {
      broadcastLiveRevision(reason, revision);
      return;
    }

    showToast("检测到云端画布版本更新，正在通过瑞云官方入口拉取。", false, {
      duration: 2200
    });
    pullOfficialLiveRemoteSnapshot(hintedRevision || revision);
  }

  async function pullOfficialLiveRemoteSnapshot(revision) {
    try {
      const result = await requestBridge(
        "pull-official-remote-snapshot",
        { fileUuid: liveOptions?.fileUuid || "", revision },
        12000
      );
      liveOfficialSyncAvailable = Boolean(result?.available);
      if (result?.available && result.applied) {
        showToast("已通过瑞云官方同步入口应用云端版本。", false, {
          duration: 1800
        });
      } else if (!result?.available && !liveOfficialSyncWarned) {
        liveOfficialSyncWarned = true;
        showToast("没有捕获到瑞云官方拉取入口，请刷新 Pixmax 页面后再试。", true, {
          duration: 5200
        });
      }
    } catch (error) {
      showToast(error.message || String(error), true);
    }
  }

  function broadcastLiveRevision(reason, revision = liveLastKnownRevision) {
    if (!liveOptions?.enabled) return;
    broadcastLivePayload({
      kind: "pixmax-live-revision",
      ownerName: liveOptions.ownerName,
      reason,
      revision
    });
  }

  function scheduleOfficialPresenceAppearance() {
    if (livePresenceAppearanceScheduled) return;
    livePresenceAppearanceScheduled = true;
    window.setTimeout(() => {
      livePresenceAppearanceScheduled = false;
      applyOfficialPresenceAppearance();
    }, 120);
  }

  function applyOfficialPresenceAppearance() {
    if (!liveOptions?.enabled || !liveOptions.ownerName) return;
    const profiles = getLiveDisplayProfiles()
      .filter((profile) => profile?.ownerName && profile?.color)
      .map((profile) => ({
        ...profile,
        color: normalizeColor(profile.color),
        initial: String(profile.ownerName || "").trim().slice(0, 1).toUpperCase()
      }));
    if (!profiles.length) return;
    let visiblePresenceCount = 0;
    for (const element of document.querySelectorAll("div, span, button")) {
      const text = element.textContent?.trim();
      if (!text || text.length > 2) continue;
      const rect = element.getBoundingClientRect();
      if (
        rect.width < 20 ||
        rect.width > 72 ||
        rect.height < 20 ||
        rect.height > 72 ||
        rect.top > 140
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      const radius = parseFloat(style.borderRadius) || 0;
      if (radius < Math.min(rect.width, rect.height) * 0.35) continue;
      visiblePresenceCount += 1;
      const existingKey = element.dataset.pixmaxHubPresenceKey || "";
      const profile =
        profiles.find((item) => getLivePresenceProfileKey(item) === existingKey) ||
        profiles.find((item) => text.toUpperCase() === item.initial);
      if (!profile) continue;
      const profileKey = getLivePresenceProfileKey(profile);
      const color = normalizeColor(profile.color);
      const [red, green, blue] = hexToRgb(color);
      if (
        element.dataset.pixmaxHubPresenceKey === profileKey &&
        element.dataset.pixmaxHubPresenceColor === color &&
        element.textContent === profile.initial
      ) {
        continue;
      }
      element.dataset.pixmaxHubPresenceKey = profileKey;
      element.dataset.pixmaxHubPresenceColor = color;
      element.textContent = profile.initial;
      element.style.setProperty("background", color, "important");
      element.style.setProperty("background-color", color, "important");
      element.style.setProperty("border-color", color, "important");
      element.style.setProperty("color", getReadableTextColor(red, green, blue), "important");
      element.style.setProperty(
        "box-shadow",
        `0 0 0 2px rgb(${red} ${green} ${blue} / 34%)`,
        "important"
      );
    }
    liveDomPeerCount = Math.max(1, visiblePresenceCount);
    if (visiblePresenceCount === 1 && livePresencePeerCount > 1 && !hasCollaborationConflictDialog()) {
      livePresencePeerCount = 1;
      liveRemoteActivityUntil = 0;
      updateLiveToggle();
    }
  }

  function getLivePresenceProfileKey(profile = {}) {
    return (
      profile.officialUserId ||
      profile.officialClientId ||
      profile.senderId ||
      profile.ownerName ||
      ""
    );
  }

  function getReadableTextColor(red, green, blue) {
    return red * 0.299 + green * 0.587 + blue * 0.114 > 145 ? "#111" : "#fff";
  }

  function autoResolveCollaborationConflict() {
    if (!liveOptions?.enabled) return;
    if (!hasCollaborationConflictDialog()) return;
    markLiveRemoteActivity();
    const button = [...document.querySelectorAll("button")].find((item) =>
      item.textContent.replace(/\s+/g, "").includes("覆盖云端版本")
    );
    if (!button) return;
    button.click();
    showToast("实时协同已自动选择覆盖云端版本。");
    scheduleLiveRevisionCheck("auto-conflict");
  }

  function hasCollaborationConflictDialog() {
    return Boolean(document.body?.textContent?.includes("文件版本冲突"));
  }

  function normalizeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIKE_COLOR;
  }

  function normalizeOptionalColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
  }

  function normalizeGithubUpdateUrl(value) {
    const source = parseGithubUpdateUrl(value);
    if (!source) return DEFAULT_GITHUB_UPDATE_URL;

    const isDefaultRepository =
      source.owner === "171896542" && source.repo.toLowerCase() === "pixmaxhub-plug";
    const branch = isDefaultRepository && (!source.branch || source.branch === "master")
      ? "main"
      : source.branch;

    return branch
      ? `https://github.com/${source.owner}/${source.repo}/tree/${branch}`
      : `https://github.com/${source.owner}/${source.repo}`;
  }

  function parseGithubUpdateUrl(value) {
    const text = String(value || "")
      .trim()
      .replace(/^www\.github\.com\//i, "")
      .replace(/^github\.com\//i, "");
    if (!text) return null;

    let url;
    try {
      url = new URL(text.startsWith("http") ? text : `https://github.com/${text}`);
    } catch {
      return null;
    }

    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    const treeIndex = parts.indexOf("tree");
    const branch = treeIndex >= 0 ? parts.slice(treeIndex + 1).join("/") : "";
    if (!/^[0-9A-Za-z_.-]+$/.test(owner) || !/^[0-9A-Za-z_.-]+$/.test(repo)) return null;
    return { owner, repo, branch };
  }

  function githubRawManifestUrl(source) {
    return (
      `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}` +
      `/${encodeURIComponent(source.repo)}/${encodeGithubPath(source.branch || "main")}/manifest.json`
    );
  }

  function encodeGithubPath(path) {
    return String(path || "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  function isVersion(value) {
    return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || ""));
  }

  function compareVersions(first, second) {
    const firstParts = String(first || "").split(/[.+-]/).map((part) => Number(part) || 0);
    const secondParts = String(second || "").split(/[.+-]/).map((part) => Number(part) || 0);
    const length = Math.max(firstParts.length, secondParts.length, 3);
    for (let index = 0; index < length; index += 1) {
      const delta = (firstParts[index] || 0) - (secondParts[index] || 0);
      if (delta !== 0) return delta;
    }
    return 0;
  }

  function showUpdateRequiredToast(version) {
    showToast(
      `PixmaxHub Plug 有新版本 ${version}，请打开扩展弹窗安装更新后再继续使用。`,
      false,
      { persistent: true }
    );
  }

  async function maybeRemindAboutUpdate() {
    try {
      const state = await storageGet({ [UPDATE_CHECK_STORAGE_KEY]: { checkedAt: 0, version: "" } });
      const reminder = state[UPDATE_CHECK_STORAGE_KEY] || {};
      const currentVersion = globalThis.chrome?.runtime?.getManifest?.().version || "";
      if (isVersion(reminder.version) && compareVersions(reminder.version, currentVersion) > 0) {
        showUpdateRequiredToast(reminder.version);
        return;
      }

      const now = Date.now();
      if (now - (Number(reminder.checkedAt) || 0) < UPDATE_REMINDER_INTERVAL_MS) return;

      await storageSet({
        [UPDATE_CHECK_STORAGE_KEY]: {
          checkedAt: now,
          version: String(reminder.version || "")
        }
      });

      const options = await syncStorageGet({ githubUpdateUrl: DEFAULT_GITHUB_UPDATE_URL });
      const source = parseGithubUpdateUrl(normalizeGithubUpdateUrl(options.githubUpdateUrl));
      if (!source) return;

      const response = await fetch(
        `${githubRawManifestUrl({ ...source, branch: source.branch || "main" })}?pixmaxHubTs=${Date.now()}`
      );
      if (!response.ok) return;
      const manifest = await response.json();
      const latestVersion = String(manifest.version || "");
      if (!isVersion(latestVersion) || compareVersions(latestVersion, currentVersion) <= 0) return;

      await storageSet({
        [UPDATE_CHECK_STORAGE_KEY]: {
          checkedAt: now,
          version: latestVersion
        }
      });
      showUpdateRequiredToast(latestVersion);
    } catch {
      // 收藏动作不应该被更新提醒影响。
    }
  }

  function hexToRgb(color) {
    const normalized = normalizeColor(color).slice(1);
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16)
    ];
  }

  function setElementLikeColor(element, color) {
    if (!element) return;
    const normalized = normalizeColor(color);
    const [red, green, blue] = hexToRgb(normalized);
    element.style.setProperty("--pixmax-cloner-like-color", normalized);
    element.style.setProperty(
      "--pixmax-cloner-like-glow",
      `rgb(${red} ${green} ${blue} / 22%)`
    );
    element.style.setProperty(
      "--pixmax-cloner-like-glow-strong",
      `rgb(${red} ${green} ${blue} / 34%)`
    );
  }

  function getLikeKey(item) {
    return item?.nodeId || item?.url || "";
  }

  function getToolbarNodeId(toolbar) {
    return toolbar.closest(NODE_SELECTOR)?.dataset.id || "";
  }

  function setLikeButtonState(button, liked, color = DEFAULT_LIKE_COLOR) {
    button.dataset.liked = liked ? "true" : "false";
    button.textContent = liked ? "♥" : "♡";
    button.title = liked
      ? "Remove this Pixmax result from local Likes"
      : "Save this Pixmax result to local Likes";
    if (liked) setElementLikeColor(button, color);
  }

  function applyNodeElementLikedState(node, liked, color = DEFAULT_LIKE_COLOR) {
    if (!node) return;
    node.classList.toggle("pixmax-canvas-cloner-liked", liked);
    if (liked) setElementLikeColor(node, color);
  }

  function applyNodeLikedState(nodeId, liked, color = DEFAULT_LIKE_COLOR) {
    if (!nodeId) return;
    applyNodeElementLikedState(
      document.querySelector(`${NODE_SELECTOR}[data-id="${CSS.escape(nodeId)}"]`),
      liked,
      color
    );
  }

  function applyToolbarLikedState(toolbar) {
    const button = toolbar.querySelector('[data-pixmax-cloner-action="toggle-like"]');
    if (!button) return;
    const nodeId = getToolbarNodeId(toolbar);
    setLikeButtonState(button, ownLikedKeys.has(nodeId), likedColors.get(nodeId));
  }

  function applyVisibleLikedMarks() {
    for (const node of document.querySelectorAll(NODE_SELECTOR)) {
      applyNodeElementLikedState(
        node,
        likedKeys.has(node.dataset.id),
        likedColors.get(node.dataset.id)
      );
    }
    for (const toolbar of document.querySelectorAll(TOOLBAR_SELECTOR)) {
      applyToolbarLikedState(toolbar);
    }
  }

  function applyLikedMarksInRoot(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

    if (root.matches?.(NODE_SELECTOR)) {
      applyNodeElementLikedState(
        root,
        likedKeys.has(root.dataset.id),
        likedColors.get(root.dataset.id)
      );
    }

    for (const node of root.querySelectorAll?.(NODE_SELECTOR) ?? []) {
      applyNodeElementLikedState(
        node,
        likedKeys.has(node.dataset.id),
        likedColors.get(node.dataset.id)
      );
    }

    const parentNode = root.closest?.(NODE_SELECTOR);
    if (parentNode) {
      applyNodeElementLikedState(
        parentNode,
        likedKeys.has(parentNode.dataset.id),
        likedColors.get(parentNode.dataset.id)
      );
    }
  }

  function getFocusNodeId() {
    try {
      return new URL(location.href).searchParams.get(FOCUS_PARAM) || "";
    } catch {
      return "";
    }
  }

  function getFlowViewport(node) {
    return (
      node.closest(".svelte-flow")?.querySelector(".svelte-flow__viewport") ||
      document.querySelector(".svelte-flow__viewport")
    );
  }

  function getFlowPane(node) {
    return (
      node.closest(".svelte-flow")?.querySelector(".svelte-flow__pane") ||
      node.closest(".svelte-flow") ||
      document.querySelector(".svelte-flow__pane")
    );
  }

  function centerNodeInFlow(node, smooth = true) {
    const viewport = getFlowViewport(node);
    const pane = getFlowPane(node);
    if (!viewport || !pane || !window.DOMMatrix) return false;

    const nodeRect = node.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    if (!nodeRect.width || !nodeRect.height || !paneRect.width || !paneRect.height) return false;

    const deltaX = paneRect.left + paneRect.width / 2 - (nodeRect.left + nodeRect.width / 2);
    const deltaY = paneRect.top + paneRect.height / 2 - (nodeRect.top + nodeRect.height / 2);
    const transform = getComputedStyle(viewport).transform;
    const matrix = transform && transform !== "none" ? new DOMMatrix(transform) : new DOMMatrix();
    const scaleX = matrix.a || 1;
    const scaleY = matrix.d || scaleX;
    const targetScale = Math.min(Math.max(scaleX, 1.35), 1.8);
    const zoomRatioX = targetScale / scaleX;
    const zoomRatioY = targetScale / scaleY;
    const centerX = paneRect.left + paneRect.width / 2;
    const centerY = paneRect.top + paneRect.height / 2;
    const nextX = centerX - (centerX - (matrix.e + deltaX)) * zoomRatioX;
    const nextY = centerY - (centerY - (matrix.f + deltaY)) * zoomRatioY;

    if (smooth) {
      viewport.classList.add("pixmax-canvas-cloner-moving");
      window.setTimeout(() => {
        viewport.classList.remove("pixmax-canvas-cloner-moving");
      }, 320);
    }

    viewport.style.transformOrigin = "0 0";
    viewport.style.transform = `translate(${nextX}px, ${nextY}px) scale(${targetScale})`;
    return true;
  }

  function clearFocusParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has(FOCUS_PARAM)) return;
      url.searchParams.delete(FOCUS_PARAM);
      history.replaceState(history.state, "", url.href);
    } catch {
      // Ignore URL cleanup failures.
    }
  }

  function focusNode(nodeId, deadline = Date.now() + 10000) {
    if (!nodeId) return;
    const node = document.querySelector(`${NODE_SELECTOR}[data-id="${CSS.escape(nodeId)}"]`);

    if (!node) {
      if (Date.now() < deadline) {
        window.setTimeout(() => focusNode(nodeId, deadline), 350);
      } else {
        showToast("Could not find the liked Pixmax node on this canvas.", true);
      }
      return;
    }

    centerNodeInFlow(node);
    window.setTimeout(() => {
      node.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
      node.classList.add("pixmax-canvas-cloner-focus");
      window.setTimeout(() => node.classList.remove("pixmax-canvas-cloner-focus"), 2600);
      showToast("Focused liked Pixmax result.");
      clearFocusParam();
    }, 300);
  }

  async function getLikedItems() {
    const result = await storageGet({ [LIKES_STORAGE_KEY]: [] });
    return Array.isArray(result[LIKES_STORAGE_KEY]) ? result[LIKES_STORAGE_KEY] : [];
  }

  async function getVisibleLikedState() {
    const sharedOptions = await getSharedLikeOptions();
    if (sharedOptions.enabled) {
      const result = await requestBridge(
        "get-shared-liked-items",
        {
          fileUuid: sharedOptions.fileUuid,
          ownerName: sharedOptions.ownerName,
          color: sharedOptions.color,
          lightweight: true
        },
        15000
      );
      const allKeys = Array.isArray(result.allKeys)
        ? result.allKeys
        : (Array.isArray(result.allItems) ? result.allItems : []).map(getLikeKey).filter(Boolean);
      const ownKeys = Array.isArray(result.ownKeys)
        ? result.ownKeys
        : (Array.isArray(result.ownItems) ? result.ownItems : []).map(getLikeKey).filter(Boolean);
      return {
        shared: true,
        allKeys,
        ownKeys,
        colorByKey: result.colorByKey || {}
      };
    }

    const localItems = await getLikedItems();
    return {
      shared: false,
      allItems: localItems,
      ownItems: localItems
    };
  }

  function buildColorMap(state) {
    const colorByKey = state.colorByKey || {};
    if (colorByKey && typeof colorByKey === "object") {
      return new Map(
        Object.entries(colorByKey)
          .map(([key, color]) => [key, normalizeColor(color)])
          .filter(([key]) => key)
      );
    }

    const items = Array.isArray(state.allItems) ? state.allItems : [];
    return new Map(
      items
        .map((item) => [getLikeKey(item), normalizeColor(item.likedByColor)])
        .filter(([key]) => key)
    );
  }

  async function refreshLikedState() {
    try {
      const state = await getVisibleLikedState();
      likedKeys = new Set(
        Array.isArray(state.allKeys)
          ? state.allKeys
          : state.allItems.map(getLikeKey).filter(Boolean)
      );
      ownLikedKeys = new Set(
        Array.isArray(state.ownKeys)
          ? state.ownKeys
          : state.ownItems.map(getLikeKey).filter(Boolean)
      );
      likedColors = buildColorMap(state);
      applyVisibleLikedMarks();
      scheduleToolbarSync(document.body);
    } catch {
      likedKeys = new Set();
      ownLikedKeys = new Set();
      likedColors = new Map();
    }
  }

  async function saveLikedItems(items) {
    await storageSet({ [LIKES_STORAGE_KEY]: items });
  }

  async function toggleSelectedLike(button) {
    button.disabled = true;
    try {
      const item = await requestBridge("get-selected-like-asset");
      const likeKey = getLikeKey(item);
      if (!likeKey) throw new Error("Selected Pixmax item has no stable Like key.");

      const sharedOptions = await getSharedLikeOptions();
      if (sharedOptions.enabled) {
        const result = await requestBridge(
          "toggle-shared-like",
          {
            fileUuid: sharedOptions.fileUuid,
            ownerName: sharedOptions.ownerName,
            color: sharedOptions.color,
            item,
            lightweight: true
          },
          20000
        );
        if (result.partialState) {
          if (result.liked) {
            likedKeys.add(likeKey);
            ownLikedKeys.add(likeKey);
            likedColors.set(likeKey, sharedOptions.color);
          } else {
            likedKeys.delete(likeKey);
            ownLikedKeys.delete(likeKey);
            likedColors.delete(likeKey);
          }
          setLikeButtonState(button, result.liked, sharedOptions.color);
          applyNodeLikedState(item.nodeId, result.liked, sharedOptions.color);
          window.setTimeout(refreshLikedState, 2200);
        } else {
          const allKeys = Array.isArray(result.allKeys)
            ? result.allKeys
            : (Array.isArray(result.allItems) ? result.allItems : []).map(getLikeKey).filter(Boolean);
          const ownKeys = Array.isArray(result.ownKeys)
            ? result.ownKeys
            : (Array.isArray(result.ownItems) ? result.ownItems : []).map(getLikeKey).filter(Boolean);
          likedKeys = new Set(allKeys);
          ownLikedKeys = new Set(ownKeys);
          likedColors = buildColorMap(result);
          setLikeButtonState(button, ownLikedKeys.has(likeKey), likedColors.get(likeKey));
          applyVisibleLikedMarks();
        }
        showToast(result.liked ? "Added to shared Likes." : "Removed from shared Likes.");
        window.setTimeout(maybeRemindAboutUpdate, 800);
        return;
      }

      const likedItems = await getLikedItems();
      const existingIndex = likedItems.findIndex((likedItem) => getLikeKey(likedItem) === likeKey);

      if (existingIndex >= 0) {
        likedItems.splice(existingIndex, 1);
        await saveLikedItems(likedItems);
        likedKeys.delete(likeKey);
        ownLikedKeys.delete(likeKey);
        likedColors.delete(likeKey);
        setLikeButtonState(button, false);
        applyNodeLikedState(item.nodeId, false);
        showToast("Removed from Likes.");
        window.setTimeout(maybeRemindAboutUpdate, 800);
        return;
      }

      await saveLikedItems([
        {
          ...item,
          likedAt: new Date().toISOString()
        },
        ...likedItems
      ]);
      likedKeys.add(likeKey);
      ownLikedKeys.add(likeKey);
      likedColors.set(likeKey, DEFAULT_LIKE_COLOR);
      setLikeButtonState(button, true, DEFAULT_LIKE_COLOR);
      applyNodeLikedState(item.nodeId, true, DEFAULT_LIKE_COLOR);
      showToast("Added to Likes.");
      window.setTimeout(maybeRemindAboutUpdate, 800);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function requestExtension(action, payload, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const requestId = createRequestId();
      const timer = window.setTimeout(() => {
        extensionRequests.delete(requestId);
        reject(new Error("扩展后台响应超时，请刷新 Pixmax 页面后重试。"));
      }, timeout);

      extensionRequests.set(requestId, { resolve, reject, timer });
      window.dispatchEvent(
        new CustomEvent(EXTENSION_REQUEST_EVENT, {
          detail: JSON.stringify({
            action,
            payload,
            requestId
          })
        })
      );
    });
  }

  function createEagleButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pixmaxClonerAction = "eagle-import";
    button.title = "将当前素材直接导入已设置的 Eagle 目录";
    button.textContent = "存入 Eagle";
    return button;
  }

  function createLikeButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pixmaxClonerAction = "toggle-like";
    setLikeButtonState(button, false);
    return button;
  }

  function createActions(includeEagle) {
    const actions = document.createElement("span");
    actions.className = ACTIONS_CLASS;
    actions.innerHTML = `
      <button type="button" data-pixmax-cloner-action="select-neighbors" title="只多选主节点和直接连线节点">选中</button>
      <button type="button" data-pixmax-cloner-action="duplicate-neighbors" title="官方快捷键：复制后保留连线粘贴">创建副本</button>
    `;
    if (includeEagle) {
      actions.append(createLikeButton());
      actions.append(createEagleButton());
    }

    actions.addEventListener("pointerdown", (event) => event.stopPropagation());
    actions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-pixmax-cloner-action]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.pixmaxClonerAction === "eagle-import") {
        importSelectedAssetToEagle(button);
        return;
      }
      if (button.dataset.pixmaxClonerAction === "toggle-like") {
        toggleSelectedLike(button);
        return;
      }
      runAction(button.dataset.pixmaxClonerAction, button);
    });

    return actions;
  }

  function hasNativeDownloadAction(toolbar) {
    return [...toolbar.querySelectorAll("button")].some(
      (button) =>
        !button.closest(`.${ACTIONS_CLASS}`) &&
        button.textContent.trim() === "下载"
    );
  }

  function mountToolbarActions(toolbar) {
    const existingActions = toolbar.querySelector(`.${ACTIONS_CLASS}`);
    if (existingActions) {
      if (
        hasNativeDownloadAction(toolbar) &&
        !existingActions.querySelector('[data-pixmax-cloner-action="toggle-like"]')
      ) {
        existingActions.append(createLikeButton());
      }
      if (
        hasNativeDownloadAction(toolbar) &&
        !existingActions.querySelector('[data-pixmax-cloner-action="eagle-import"]')
      ) {
        existingActions.append(createEagleButton());
      }
      applyToolbarLikedState(toolbar);
      return;
    }
    if (!toolbar.querySelector("button")) return;

    const actions = createActions(hasNativeDownloadAction(toolbar));
    const target = toolbar.firstElementChild ?? toolbar;
    target.prepend(actions);
    applyToolbarLikedState(toolbar);
  }

  function isNativePasteWithLinksButton(button) {
    return (
      !button.classList.contains(CONTEXT_PASTE_CLASS) &&
      button.textContent.replace(/\s+/g, "").includes("粘贴（保留连线）")
    );
  }

  async function runContextPasteRepair(nativeButton, customButton, fallbackPoint) {
    customButton.disabled = true;
    try {
      await requestBridge("prepare-paste-repair", {}, 3000);
      const point = lastContextMenuPoint ?? fallbackPoint;
      nativeButton.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: point.x,
          clientY: point.y
        })
      );
      showToast("正在粘贴带连线副本，并修复 @节点 引用...");
    } catch (error) {
      showToast(error.message, true);
      customButton.disabled = false;
    }
  }

  function mountContextPasteAction(nativeButton) {
    if (nativeButton.parentElement?.querySelector(`.${CONTEXT_PASTE_CLASS}`)) return;

    const customButton = nativeButton.cloneNode(true);
    customButton.classList.add(CONTEXT_PASTE_CLASS);
    customButton.removeAttribute("id");
    customButton.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    customButton.textContent = "粘贴（保留连线并修复 @）";
    customButton.title = "保留官方连线粘贴行为，并将提示词里的 @节点 指向新副本";
    customButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      runContextPasteRepair(nativeButton, customButton, {
        x: event.clientX,
        y: event.clientY
      });
    });
    nativeButton.after(customButton);
  }

  function syncContextPasteActions() {
    for (const button of document.querySelectorAll("button")) {
      if (isNativePasteWithLinksButton(button)) {
        mountContextPasteAction(button);
      }
    }
  }

  function syncToolbars() {
    toolbarSyncScheduled = false;
    ensureStyle();
    const roots = [...pendingToolbarRoots];
    pendingToolbarRoots.clear();

    for (const root of roots) {
      if (!root || root.nodeType !== Node.ELEMENT_NODE) continue;
      applyLikedMarksInRoot(root);
      const parentToolbar = root.closest?.(TOOLBAR_SELECTOR);
      if (parentToolbar) {
        mountToolbarActions(parentToolbar);
      }
      if (root.matches?.(TOOLBAR_SELECTOR)) {
        mountToolbarActions(root);
      }
      for (const toolbar of root.querySelectorAll?.(TOOLBAR_SELECTOR) ?? []) {
        mountToolbarActions(toolbar);
      }
    }
  }

  function scheduleToolbarSync(root = document.body) {
    if (root) pendingToolbarRoots.add(root);
    if (toolbarSyncScheduled) return;
    toolbarSyncScheduled = true;
    window.requestAnimationFrame(syncToolbars);
  }

  function scheduleContextPasteSync() {
    if (contextPasteSyncScheduled) return;
    contextPasteSyncScheduled = true;
    window.setTimeout(() => {
      contextPasteSyncScheduled = false;
      syncContextPasteActions();
    }, 50);
  }

  function scheduleOpenLikesButtonRetries() {
    for (const delay of [250, 800, 1600, 3200]) {
      window.setTimeout(ensureOpenLikesButton, delay);
    }
  }

  function mount() {
    if (!document.body) return;
    cleanupLegacyCanvasUi();
    ensureStyle();
    ensureOpenLikesButton();
    scheduleOpenLikesButtonRetries();
    refreshLikedState();
    syncLiveCollabState();
    focusNode(getFocusNodeId());
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === "local" && changes[LIKES_STORAGE_KEY]) {
        const items = Array.isArray(changes[LIKES_STORAGE_KEY].newValue)
          ? changes[LIKES_STORAGE_KEY].newValue
          : [];
        likedKeys = new Set(items.map(getLikeKey).filter(Boolean));
        ownLikedKeys = new Set(items.map(getLikeKey).filter(Boolean));
        likedColors = buildColorMap({ allItems: items });
        applyVisibleLikedMarks();
      }
      if (
        areaName === "sync" &&
        (changes.sharedLikesEnabled ||
          changes.sharedLikesFileUuid ||
          changes.sharedLikesOwnerName ||
          changes.sharedLikesColor)
      ) {
        refreshLikedState();
      }
      if (
        areaName === "sync" &&
        (changes.liveCollabEnabled || changes.sharedLikesOwnerName || changes.sharedLikesColor)
      ) {
        syncLiveCollabState();
      }
    });
    scheduleToolbarSync(document.body);
    document.addEventListener(
      "contextmenu",
      (event) => {
        lastContextMenuPoint = {
          x: event.clientX,
          y: event.clientY
        };
        scheduleContextPasteSync();
      },
      true
    );
    new MutationObserver((mutations) => {
      scheduleLegacyCleanup();
      ensureOpenLikesButton();
      autoResolveCollaborationConflict();
      scheduleOfficialPresenceAppearance();
      neutralizeOfficialFocusColors();
      if (liveOptions?.enabled) {
        for (const mutation of mutations) {
          if (
            mutation.type === "attributes" &&
            (mutation.attributeName === "class" ||
              mutation.attributeName === "aria-selected" ||
              mutation.attributeName === "data-selected")
          ) {
            scheduleLiveFocusBroadcast("selection-mutation", 80);
            break;
          }
        }
      }
      for (const mutation of mutations) {
        scheduleToolbarSync(mutation.target);
        for (const node of mutation.addedNodes) {
          scheduleToolbarSync(node);
        }
      }
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "aria-selected", "data-selected"],
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();

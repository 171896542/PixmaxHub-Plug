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
  const STYLE_VERSION = "1.2.10";
  const TOAST_ID = "pixmax-canvas-cloner-toast";
  const LIKES_STORAGE_KEY = "pixmaxLikedItems";
  const UPDATE_CHECK_STORAGE_KEY = "pixmaxHubUpdateReminder";
  const DEFAULT_GITHUB_UPDATE_URL = "https://github.com/171896542/PixmaxHub-Plug/tree/main";
  const UPDATE_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_LIKE_COLOR = "#ff3864";
  const SHARED_OPTIONS_DEFAULTS = {
    sharedLikesEnabled: false,
    sharedLikesFileUuid: "",
    sharedLikesOwnerName: "",
    sharedLikesColor: DEFAULT_LIKE_COLOR
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

    const pending = requests.get(event.data.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timer);
    requests.delete(event.data.requestId);
    if (event.data.ok) pending.resolve(event.data.payload);
    else pending.reject(new Error(event.data.payload?.error ?? "操作失败。"));
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
    `;
    document.head.appendChild(style);
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

  function normalizeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIKE_COLOR;
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

  function mount() {
    if (!document.body) return;
    cleanupLegacyCanvasUi();
    ensureStyle();
    refreshLikedState();
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
      for (const mutation of mutations) {
        scheduleToolbarSync(mutation.target);
        for (const node of mutation.addedNodes) {
          scheduleToolbarSync(node);
        }
      }
    }).observe(document.body, {
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

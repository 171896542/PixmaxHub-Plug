(() => {
  if (window.__pixmaxCanvasClonerBridge) return;
  window.__pixmaxCanvasClonerBridge = true;

  const REQUEST_EVENT = "pixmax-canvas-cloner:request";
  const RESPONSE_SOURCE = "pixmax-canvas-cloner:bridge";
  const LIVE_INTERNALS_KEY = "__pixmaxHubLiveInternals";

  function installLiveInternalsProbe() {
    if (window[LIVE_INTERNALS_KEY]?.installed) return;

    const internals = {
      installed: true,
      candidates: [],
      controllers: [],
      presenceSockets: [],
      presenceMessages: [],
      peerCount: 1,
      peers: [],
      mapProbeInteresting: [],
      mapProbeSetCount: 0
    };
    window[LIVE_INTERNALS_KEY] = internals;

    function remember(value, source) {
      if (!value || typeof value !== "object") return;
      const hasWorkspaceSync =
        typeof value.commit === "function" &&
        typeof value.fetchLastVersion === "function" &&
        typeof value.applyRemoteSnapshot === "function";
      if (!hasWorkspaceSync) return;
      if (!internals.controllers.includes(value)) {
        internals.controllers.push(value);
        internals.candidates.push({
          foundAt: Date.now(),
          source,
          keys: Object.getOwnPropertyNames(value).slice(0, 80)
        });
      }
      internals.workspaceController = value;
    }

    internals.remember = remember;

    function maybeRememberWorkspaceController(value, source) {
      if (internals.workspaceController) return;
      if (!value || typeof value !== "object") return;
      if (
        value.syncManager &&
        value.fileTreeStore &&
        typeof value.commit === "function" &&
        typeof value.fetchLastVersion === "function" &&
        typeof value.applyRemoteSnapshot === "function"
      ) {
        remember(value, source);
      }
    }

    function getStoredLiveIdentity() {
      try {
        const parsed = JSON.parse(localStorage.getItem("pixmaxHubLiveIdentity") || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }

    function normalizeLiveColor(value) {
      const color = String(value || "").trim();
      return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "";
    }

    function applyLiveIdentityToJoinMessage(message) {
      if (!message || message.type !== "join") return message;
      const identity = internals.identity || getStoredLiveIdentity();
      const userName = String(identity.ownerName || "").trim();
      if (!userName) return message;
      return {
        ...message,
        color: normalizeLiveColor(identity.color),
        profileColor: normalizeLiveColor(identity.color),
        userName
      };
    }

    function emitPresenceMessage(message) {
      window.postMessage(
        {
          source: RESPONSE_SOURCE,
          notification: "official-presence-message",
          payload: message
        },
        location.origin
      );
    }

    function rememberPresenceSocket(socket, url) {
      if (!socket || socket.__pixmaxHubLivePresenceSocket) return;
      socket.__pixmaxHubLivePresenceSocket = true;
      internals.presenceSockets.push({ foundAt: Date.now(), url: String(url || "") });

      const nativeSend = socket.send.bind(socket);
      socket.send = (value) => {
        let nextValue = value;
        try {
          const message = JSON.parse(String(value));
          if (message?.type === "join" && String(message.room || "").endsWith(":pixmax-hub-live")) {
            socket.__pixmaxHubLiveSideRoom = true;
          }
          const nextMessage = applyLiveIdentityToJoinMessage(message);
          if (!socket.__pixmaxHubLiveSideRoom) {
            internals.presenceSocket = socket;
            if (nextMessage !== message) {
              internals.lastJoin = nextMessage;
              nextValue = JSON.stringify(nextMessage);
            } else if (message?.type === "join") {
              internals.lastJoin = message;
            }
          }
          internals.presenceMessages.push({ direction: "out", message: nextMessage, at: Date.now() });
        } catch {
          // Keep native payload when it is not JSON.
        }
        return nativeSend(nextValue);
      };

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data || ""));
          internals.presenceMessages.push({ direction: "in", message, at: Date.now() });
          if (socket.__pixmaxHubLiveSideRoom) return;
          if (message.type === "joined") {
            internals.clientId = message.clientId || "";
            if (Number.isFinite(Number(message.peerCount))) {
              internals.peerCount = Math.max(1, Number(message.peerCount));
            }
          }
          if (message.type === "room-presence" && Array.isArray(message.peers)) {
            internals.peers = message.peers;
            internals.peerCount = Math.max(1, message.peers.length);
          }
          emitPresenceMessage(message);
        } catch {
          // Ignore malformed presence messages.
        }
      });
    }

    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket && !NativeWebSocket.__pixmaxHubLiveProbe) {
      const PatchedWebSocket = function PatchedWebSocket(url, protocols) {
        const socket = protocols === undefined
          ? new NativeWebSocket(url)
          : new NativeWebSocket(url, protocols);
        if (String(url || "").includes("/presence/ws")) {
          rememberPresenceSocket(socket, url);
        }
        return socket;
      };
      Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
      PatchedWebSocket.prototype = NativeWebSocket.prototype;
      PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
      PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
      PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
      PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
      PatchedWebSocket.__pixmaxHubLiveProbe = true;
      window.WebSocket = PatchedWebSocket;
    }

    internals.setIdentity = (identity = {}) => {
      internals.identity = {
        ownerName: String(identity.ownerName || "").trim(),
        color: normalizeLiveColor(identity.color)
      };
      try {
        localStorage.setItem("pixmaxHubLiveIdentity", JSON.stringify(internals.identity));
      } catch {
        // Ignore localStorage failures.
      }
      const socket = internals.presenceSocket;
      const join = internals.lastJoin;
      if (socket?.readyState === 1 && join?.room && join?.userId) {
        socket.send(
          JSON.stringify(
            applyLiveIdentityToJoinMessage({
              ...join,
              type: "join"
            })
          )
        );
      }
    };

    internals.broadcastPresence = (payload) => {
      const socket = internals.presenceSocket;
      if (!socket || socket.readyState !== 1) return false;
      socket.send(JSON.stringify({ type: "broadcast", payload }));
      return true;
    };

    const nativeMapSet = Map.prototype.set;
    if (nativeMapSet && !nativeMapSet.__pixmaxHubLiveTargetedProbe) {
      let restored = false;
      const restoreMapSet = () => {
        if (restored) return;
        restored = true;
        if (Map.prototype.set === patchedMapSet) Map.prototype.set = nativeMapSet;
      };
      const patchedMapSet = function pixmaxHubLiveTargetedMapSet(key, value) {
        const result = nativeMapSet.call(this, key, value);
        try {
          internals.mapProbeSetCount += 1;
          if (
            value &&
            typeof value === "object" &&
            (value.syncManager || value.fileTreeStore || typeof value.commit === "function")
          ) {
            internals.mapProbeInteresting.push({
              at: Date.now(),
              hasCommit: typeof value.commit === "function",
              hasFileTreeStore: Boolean(value.fileTreeStore),
              hasSyncManager: Boolean(value.syncManager),
              keys: Object.getOwnPropertyNames(value).slice(0, 40),
              source: "map:set"
            });
            if (internals.mapProbeInteresting.length > 20) internals.mapProbeInteresting.shift();
          }
          maybeRememberWorkspaceController(value, "svelte-context-map");
          if (internals.workspaceController) restoreMapSet();
        } catch {
          // Keep Map.set transparent.
        }
        return result;
      };
      patchedMapSet.__pixmaxHubLiveTargetedProbe = true;
      Map.prototype.set = patchedMapSet;
      window.setTimeout(restoreMapSet, 15000);
    }
  }

  installLiveInternalsProbe();

  const NODE_SELECTOR = ".svelte-flow__node[data-id]";
  const EDGE_SELECTOR = ".svelte-flow__edge[aria-label]";
  const API_PREFIX = "/user/api";
  const SHARED_LIKES_MARKER = "PIXMAX_CANVAS_CLONER_LIKES_V1";
  const LIKE_INDEX_MARKER = "PIXMAX_CANVAS_CLONER_LIKE_INDEX_V1";
  const LIKE_INDEX_NODE_LABEL = "Pixmax Likes 索引";
  const SOCIAL_DATA_NODE_LABEL = "《pixmaxlikes 页面用户数据》交互的数据存放";
  const DEFAULT_LIKE_COLOR = "#ff3864";
  const CANVAS_REVISION_CONFLICT = "Canvas.Revision.Conflict";
  const MENTION_TOKEN_PATTERN = /%%@\[([^\]]*)\]\[([^\]]*)\]\[(\d+)\]\(([^)]*)\)%%/g;
  let mentionRepairActive = false;

  function respond(requestId, ok, payload = {}) {
    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        requestId,
        ok,
        payload
      },
      location.origin
    );
  }

  function getCanvasIdentity() {
    return {
      fileUuid: new URL(location.href).searchParams.get("file") ?? ""
    };
  }

  function getSelectedNodeIds() {
    return [...document.querySelectorAll(`${NODE_SELECTOR}.selected`)].map(
      (node) => node.dataset.id
    );
  }

  function parseMetaData(node) {
    try {
      return JSON.parse(node.metaData ?? "{}");
    } catch {
      return {};
    }
  }

  async function apiPostResult(path, body) {
    const response = await fetch(`${API_PREFIX}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.errMessage || result.errCode || `Pixmax 接口请求失败：${path}`
      );
    }

    return result;
  }

  async function apiPost(path, body) {
    const result = await apiPostResult(path, body);

    if (!result.success) {
      throw new Error(
        result.errMessage || result.errCode || `Pixmax 接口请求失败：${path}`
      );
    }

    return result.data;
  }

  async function fetchCanvas(fileUuid = getCanvasIdentity().fileUuid) {
    if (!fileUuid) throw new Error("当前网址缺少画布 file 参数。");
    return apiPost("/canvas/get", { fileUuid });
  }

  async function fetchCurrentCanvas() {
    return fetchCanvas();
  }

  async function getCurrentCanvasRevision() {
    const canvas = await fetchCurrentCanvas();
    return {
      nodeCount: Array.isArray(canvas.nodes) ? canvas.nodes.length : 0,
      revision: canvas.revision ?? null
    };
  }

  function getOfficialWorkspaceController() {
    const internals = window[LIVE_INTERNALS_KEY];
    const controller = internals?.workspaceController;
    if (
      controller &&
      typeof controller.commit === "function" &&
      typeof controller.fetchLastVersion === "function" &&
      typeof controller.applyRemoteSnapshot === "function"
    ) {
      return controller;
    }
    return null;
  }

  function getOfficialLiveSyncStatus() {
    const internals = window[LIVE_INTERNALS_KEY];
    const controller = getOfficialWorkspaceController();
    return {
      available: Boolean(controller),
      candidateCount: internals?.controllers?.length || 0,
      candidates: internals?.candidates || [],
      currentRevision: controller?.currentRevision ?? null,
      fileUuid: controller?.fileTreeStore?.activeFileId || getCanvasIdentity().fileUuid || "",
      mapProbeInteresting: internals?.mapProbeInteresting || [],
      mapProbeSetCount: internals?.mapProbeSetCount || 0,
      phase: controller?.phase || ""
    };
  }

  function setLivePresenceIdentity(payload = {}) {
    const internals = window[LIVE_INTERNALS_KEY];
    internals?.setIdentity?.({
      color: payload.color,
      ownerName: payload.ownerName
    });
    return getOfficialPresenceStatus();
  }

  function broadcastOfficialPresence(payload = {}) {
    const internals = window[LIVE_INTERNALS_KEY];
    return {
      sent: Boolean(internals?.broadcastPresence?.(payload)),
      status: getOfficialPresenceStatus()
    };
  }

  function getOfficialPresenceStatus() {
    const internals = window[LIVE_INTERNALS_KEY];
    const socket = internals?.presenceSocket;
    return {
      available: Boolean(socket),
      clientId: internals?.clientId || "",
      identity: internals?.identity || null,
      lastJoin: internals?.lastJoin || null,
      peerCount: internals?.peerCount || 1,
      peers: internals?.peers || [],
      readyState: socket?.readyState ?? null,
      socketCount: internals?.presenceSockets?.length || 0
    };
  }

  async function triggerOfficialWorkspaceSync(payload = {}) {
    const controller = getOfficialWorkspaceController();
    if (!controller) {
      return {
        available: false,
        fallback: await triggerOfficialSync()
      };
    }
    const beforeRevision = controller.currentRevision ?? null;
    await controller.commit(payload.reason || "pixmax-hub-live");
    return {
      available: true,
      beforeRevision,
      revision: controller.currentRevision ?? null
    };
  }

  async function pullOfficialRemoteSnapshot(payload = {}) {
    const controller = getOfficialWorkspaceController();
    if (!controller) {
      return {
        available: false
      };
    }

    const fileUuid =
      payload.fileUuid ||
      controller.fileTreeStore?.activeFileId ||
      getCanvasIdentity().fileUuid;
    if (!fileUuid) throw new Error("当前网址缺少画布 file 参数。");

    const remote = await controller.fetchLastVersion(fileUuid);
    if (remote?.revision == null || !remote.snapshot) {
      throw new Error("瑞云官方拉取没有返回有效版本。");
    }
    const beforeRevision = controller.currentRevision ?? null;
    const shouldApply = remote.revision !== beforeRevision;
    if (shouldApply) {
      controller.applyRemoteSnapshot(remote.snapshot, remote.revision);
    }
    return {
      applied: shouldApply,
      available: true,
      beforeRevision,
      revision: remote.revision
    };
  }

  function resolveAssetUrl(asset) {
    if (!asset) return "";
    const path = asset.webUrl || asset.relativePath || "";
    return resolveAssetPath(asset, path);
  }

  function resolveAssetPreviewUrl(asset) {
    if (!asset) return "";
    return resolveAssetPath(
      asset,
      asset.thumbnailWebUrl ||
        asset.thumbnailUrl ||
        asset.previewWebUrl ||
        asset.previewPath ||
        asset.thumbnailPath ||
        ""
    );
  }

  function inferAssetMediaType(asset, fallbackUrl = "") {
    const fields = [
      asset?.type,
      asset?.mimeType,
      asset?.mime,
      asset?.contentType,
      asset?.fileType,
      asset?.mediaType,
      asset?.name,
      asset?.fileName,
      asset?.filename,
      fallbackUrl
    ].map((value) => String(value || "").toLowerCase());
    if (fields.some((value) => /video|\.mp4|\.webm|\.mov|\.m4v|\.avi|\.mkv/.test(value))) return "video";
    if (fields.some((value) => /audio|\.mp3|\.wav|\.m4a|\.aac|\.ogg/.test(value))) return "audio";
    if (fields.some((value) => /image|\.png|\.jpe?g|\.webp|\.gif|\.avif|\.bmp/.test(value))) return "image";
    return "";
  }

  function resolveAssetPath(asset, path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    if (asset.ossSynced && asset.ossDomain) {
      return `${asset.ossDomain.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    }
    try {
      return new URL(path, location.origin).href;
    } catch {
      return "";
    }
  }

  function getNodeLabel(rawNode) {
    const metaData = parseMetaData(rawNode);
    return (
      metaData.data?.label ||
      rawNode.defaultAsset?.name ||
      rawNode.defaultAsset?.fileName ||
      rawNode.defaultAsset?.filename ||
      ""
    );
  }

  function getPromptText(rawNode) {
    const metaData = parseMetaData(rawNode);
    const params = [
      rawNode.params,
      rawNode.data?.params,
      metaData.params,
      metaData.data?.params,
      metaData.data
    ].filter((value) => value && typeof value === "object");
    const candidates = [];

    for (const source of params) {
      candidates.push(
        source.prompt,
        source.positivePrompt,
        source.negativePrompt,
        source.promptText,
        source.text,
        source.description
      );
    }

    const prompt = candidates
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) =>
        value
          .replace(
            MENTION_TOKEN_PATTERN,
            (_token, title, type, index) => `@${title || `${type}${index}`}`
          )
          .trim()
      )
      .filter(Boolean)
      .join("\n\n");

    return [...new Set(prompt.split("\n\n"))].join("\n\n");
  }

  function getLikeKey(item) {
    return item?.nodeId || item?.url || "";
  }

  function parseSharedOptions(payload = {}) {
    const fileUuid = String(payload.fileUuid || "").trim();
    const ownerName = String(payload.ownerName || "").trim();
    if (!fileUuid) throw new Error("请先设置共享 Likes 画布链接。");
    if (!ownerName) throw new Error("请先设置你的共享 Likes 名字。");
    return {
      color: normalizeColor(payload.color),
      fileUuid,
      ownerName
    };
  }

  function normalizeColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIKE_COLOR;
  }

  function parseSharedLikeText(value) {
    const text = String(value || "");
    const markerIndex = text.indexOf(SHARED_LIKES_MARKER);
    if (markerIndex < 0) return null;

    const jsonStart = text.indexOf("{", markerIndex + SHARED_LIKES_MARKER.length);
    if (jsonStart < 0) return null;

    try {
      const data = JSON.parse(text.slice(jsonStart).trim());
      if (!data || data.version !== 1 || !Array.isArray(data.items)) return null;
      return {
        color: normalizeColor(data.color),
        ownerName: String(data.ownerName || "").trim(),
        settings: data.settings && typeof data.settings === "object" ? data.settings : {},
        items: data.items.filter((item) => item && typeof item === "object")
      };
    } catch {
      return null;
    }
  }

  function decodeJsonString(value) {
    try {
      return JSON.parse(`"${String(value || "").replace(/"/g, '\\"')}"`);
    } catch {
      return String(value || "");
    }
  }

  function parseSharedLikeStateText(value) {
    const text = String(value || "");
    const markerIndex = text.indexOf(SHARED_LIKES_MARKER);
    if (markerIndex < 0) return null;

    const head = text.slice(markerIndex);
    const ownerMatch = head.match(/"ownerName"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const colorMatch = head.match(/"color"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const ownerName = decodeJsonString(ownerMatch?.[1] || "").trim();
    const color = normalizeColor(decodeJsonString(colorMatch?.[1] || ""));
    const items = [];
    const seen = new Set();
    const nodeIdPattern = /"nodeId"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match;

    while ((match = nodeIdPattern.exec(head))) {
      const nodeId = decodeJsonString(match[1]);
      if (nodeId && !seen.has(nodeId)) {
        seen.add(nodeId);
        items.push({ key: nodeId, likedByColor: color });
      }
    }

    return ownerName ? { color, items, ownerName } : null;
  }

  function parseLikeIndexText(value) {
    const text = String(value || "");
    const markerIndex = text.indexOf(LIKE_INDEX_MARKER);
    if (markerIndex < 0) return null;

    const jsonStart = text.indexOf("{", markerIndex + LIKE_INDEX_MARKER.length);
    if (jsonStart < 0) return null;

    try {
      const data = JSON.parse(text.slice(jsonStart).trim());
      if (!data || data.version !== 1 || !Array.isArray(data.owners)) return null;
      return normalizeLikeIndex(data);
    } catch {
      return null;
    }
  }

  function normalizeLikeIndex(data = {}) {
    return {
      owners: Array.isArray(data.owners)
        ? data.owners
            .filter((owner) => owner && typeof owner === "object")
            .map((owner) => ({
              color: normalizeColor(owner.color),
              keys: [...new Set((Array.isArray(owner.keys) ? owner.keys : []).map(String).filter(Boolean))],
              ownerName: String(owner.ownerName || "").trim()
            }))
            .filter((owner) => owner.ownerName)
        : []
    };
  }

  function buildLikeIndexText(data) {
    const normalized = normalizeLikeIndex(data);
    return [
      LIKE_INDEX_NODE_LABEL,
      LIKE_INDEX_MARKER,
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          owners: normalized.owners
        },
        null,
        2
      )
    ].join("\n");
  }

  function parseNodeMetaData(rawNode) {
    try {
      return JSON.parse(rawNode?.metaData || "{}");
    } catch {
      return {};
    }
  }

  function getRawNodeLabel(rawNode) {
    const metaData = parseNodeMetaData(rawNode);
    return String(metaData.data?.label || "").trim();
  }

  function getRawNodeText(rawNode) {
    return typeof rawNode?.nodeText === "string" ? rawNode.nodeText : "";
  }

  function isTextLikeNode(rawNode) {
    return typeof rawNode?.nodeText === "string";
  }

  function findSharedLikesOwnerNode(nodes, ownerName) {
    const normalizedOwner = ownerName.trim();
    const textNodes = nodes.filter(isTextLikeNode);

    const marked = textNodes.find((node) => {
      const parsed = parseSharedLikeText(getRawNodeText(node));
      return parsed?.ownerName === normalizedOwner;
    });
    if (marked) return marked;

    const byLabel = textNodes.find((node) => getRawNodeLabel(node) === normalizedOwner);
    if (byLabel) return byLabel;

    return textNodes.find((node) => {
      const text = getRawNodeText(node).trim();
      return text === normalizedOwner || text.split(/\r?\n/, 1)[0]?.trim() === normalizedOwner;
    });
  }

  function findLikeIndexNode(nodes) {
    const textNodes = nodes.filter(isTextLikeNode);
    const marked = textNodes.find((node) => parseLikeIndexText(getRawNodeText(node)));
    if (marked) return marked;
    return textNodes.find((node) => getRawNodeLabel(node) === LIKE_INDEX_NODE_LABEL);
  }

  function findLikeIndexNodes(nodes) {
    return nodes
      .filter(isTextLikeNode)
      .map((node) => ({ node, index: parseLikeIndexText(getRawNodeText(node)) }))
      .filter((entry) => entry.index);
  }

  function getOwnerLikeIndexLabel(ownerName) {
    return `${ownerName} 索引`;
  }

  function getLegacyOwnerLikeIndexLabel(ownerName) {
    return `${LIKE_INDEX_NODE_LABEL} - ${ownerName}`;
  }

  function findOwnerLikeIndexNode(nodes, ownerName) {
    const ownerLabel = getOwnerLikeIndexLabel(ownerName);
    const legacyOwnerLabel = getLegacyOwnerLikeIndexLabel(ownerName);
    const entries = findLikeIndexNodes(nodes);
    return (
      entries.find((entry) => getRawNodeLabel(entry.node) === ownerLabel)?.node ||
      entries.find((entry) => getRawNodeLabel(entry.node) === legacyOwnerLabel)?.node ||
      entries.find((entry) => {
        const owners = normalizeLikeIndex(entry.index).owners;
        return owners.length === 1 && owners[0].ownerName === ownerName;
      })?.node ||
      null
    );
  }

  function buildSharedLikeText(ownerName, items, color = DEFAULT_LIKE_COLOR, settings = {}) {
    return [
      ownerName,
      SHARED_LIKES_MARKER,
      JSON.stringify(
        {
          version: 1,
          ownerName,
          color: normalizeColor(color),
          settings,
          updatedAt: new Date().toISOString(),
          items
        },
        null,
        2
      )
    ].join("\n");
  }

  function shouldScanTextNodeForLikes(node) {
    const label = getRawNodeLabel(node);
    if (
      label === LIKE_INDEX_NODE_LABEL ||
      label.startsWith(`${LIKE_INDEX_NODE_LABEL} - `) ||
      label.endsWith(" 索引") ||
      label === SOCIAL_DATA_NODE_LABEL ||
      label.startsWith("Pixmax 更新包")
    ) {
      return false;
    }
    return getRawNodeText(node).slice(0, 512).includes(SHARED_LIKES_MARKER);
  }

  function getSharedStateFromLikeIndex(index, ownerName) {
    const allKeys = [];
    const ownKeys = [];
    const colorByKey = {};

    for (const owner of normalizeLikeIndex(index).owners) {
      const color = normalizeColor(owner.color);
      for (const key of owner.keys) {
        allKeys.push(key);
        if (!colorByKey[key]) colorByKey[key] = color;
        if (owner.ownerName === ownerName) {
          ownKeys.push(key);
          colorByKey[key] = color;
        }
      }
    }

    return {
      allKeys: [...new Set(allKeys)],
      ownKeys: [...new Set(ownKeys)],
      colorByKey
    };
  }

  function getSharedStateFromLikeIndexNodes(nodes, ownerName) {
    const ownersByName = new Map();
    const legacyOwners = [];

    for (const { node, index } of findLikeIndexNodes(nodes)) {
      const label = getRawNodeLabel(node);
      const owners = normalizeLikeIndex(index).owners;
      const isLegacyIndex = label === LIKE_INDEX_NODE_LABEL || owners.length > 1;
      for (const owner of owners) {
        if (isLegacyIndex) legacyOwners.push(owner);
        else ownersByName.set(owner.ownerName, owner);
      }
    }

    for (const owner of deriveLikeIndexFromCanvas({ nodes }).owners) {
      if (!ownersByName.has(owner.ownerName)) ownersByName.set(owner.ownerName, owner);
    }

    for (const owner of legacyOwners) {
      if (!ownersByName.has(owner.ownerName)) ownersByName.set(owner.ownerName, owner);
    }

    return getSharedStateFromLikeIndex({ owners: [...ownersByName.values()] }, ownerName);
  }

  function deriveLikeIndexFromCanvas(canvas) {
    const owners = [];

    for (const node of canvas.nodes ?? []) {
      if (!isTextLikeNode(node) || !shouldScanTextNodeForLikes(node)) continue;
      const parsed = parseSharedLikeStateText(getRawNodeText(node));
      if (!parsed) continue;
      owners.push({
        color: parsed.color,
        keys: parsed.items.map((item) => item.key).filter(Boolean),
        ownerName: parsed.ownerName || getRawNodeLabel(node) || "Unknown"
      });
    }

    return normalizeLikeIndex({ owners });
  }

  function buildOwnerLikeIndex(ownerName, color, items) {
    const keys = [...new Set((items || []).map(getLikeKey).filter(Boolean))];
    return normalizeLikeIndex({
      owners: [
        {
          color: normalizeColor(color),
          keys,
          ownerName
        }
      ]
    });
  }

  function buildLikeIndexNode(nodes, ownerName, data) {
    const positions = nodes
      .filter(isTextLikeNode)
      .map((node) => parseNodeMetaData(node).position || {});
    const maxX = positions.reduce((value, position) => Math.max(value, Number(position.x) || 0), 0);

    return {
      uuid: crypto.randomUUID(),
      type: "BASE_TEXT",
      metaData: JSON.stringify({
        data: { label: getOwnerLikeIndexLabel(ownerName) },
        position: {
          x: maxX + 360,
          y: -520
        },
        measured: {
          width: 320,
          height: 180
        },
        width: 320,
        height: 180
      }),
      nodeText: buildLikeIndexText(data)
    };
  }

  async function upsertLikeIndexForOwner(fileUuid, canvas, ownerName, color, items, retryCount = 1) {
    const indexNode = findOwnerLikeIndexNode(canvas.nodes ?? [], ownerName);
    const nextIndex = buildOwnerLikeIndex(ownerName, color, items);
    const payload = indexNode
      ? {
          create: [],
          update: [
            {
              uuid: indexNode.uuid,
              metaData: indexNode.metaData || "{}",
              nodeText: buildLikeIndexText(nextIndex)
            }
          ]
        }
      : {
          create: [buildLikeIndexNode(canvas.nodes ?? [], ownerName, nextIndex)],
          update: []
        };

    const result = await apiPostResult("/canvas/node/batch", {
      fileUuid,
      baseRevision: canvas.revision,
      create: payload.create,
      update: payload.update,
      delete: []
    });

    if (!result.success) {
      if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
        const nextCanvas = await fetchCanvas(fileUuid);
        return upsertLikeIndexForOwner(fileUuid, nextCanvas, ownerName, color, items, retryCount - 1);
      }
      throw new Error(result.errMessage || result.errCode || "共享 Likes 索引写入失败。");
    }

    const nextCanvas = await fetchCanvas(fileUuid);
    return getSharedStateFromLikeIndexNodes(nextCanvas.nodes ?? [], ownerName);
  }

  async function syncLikeIndexForOwnerLater(fileUuid, ownerName, color, items) {
    try {
      const canvas = await fetchCanvas(fileUuid);
      await upsertLikeIndexForOwner(fileUuid, canvas, ownerName, color, items);
    } catch (error) {
      window.postMessage(
        {
          source: RESPONSE_SOURCE,
          notification: "shared-like-index-error",
          payload: {
            error: error.message || String(error)
          }
        },
        location.origin
      );
    }
  }

  function getSharedLikeStateFromCanvas(canvas, ownerName) {
    return getSharedStateFromLikeIndexNodes(canvas.nodes ?? [], ownerName);
  }

  function getSharedLikesFromCanvas(canvas, ownerName) {
    const allItems = [];
    let ownItems = [];

    for (const node of canvas.nodes ?? []) {
      if (!isTextLikeNode(node) || !shouldScanTextNodeForLikes(node)) continue;
      const parsed = parseSharedLikeText(getRawNodeText(node));
      if (!parsed) continue;
      const likedBy = parsed.ownerName || getRawNodeLabel(node) || "Unknown";
      const likedByColor = normalizeColor(parsed.color);
      const items = parsed.items.map((item) => ({ ...item, likedBy, likedByColor }));
      allItems.push(...items);
      if (likedBy === ownerName) ownItems = items;
    }

    allItems.sort((first, second) => String(second.likedAt || "").localeCompare(String(first.likedAt || "")));
    const colorByKey = {};
    for (const item of allItems) {
      const key = getLikeKey(item);
      if (!key || colorByKey[key]) continue;
      colorByKey[key] = normalizeColor(item.likedByColor);
    }
    for (const item of allItems) {
      const key = getLikeKey(item);
      if (key && item.likedBy === ownerName) colorByKey[key] = normalizeColor(item.likedByColor);
    }
    return {
      allItems,
      ownItems,
      allKeys: allItems.map(getLikeKey).filter(Boolean),
      ownKeys: ownItems.map(getLikeKey).filter(Boolean),
      colorByKey
    };
  }

  async function getSharedLikedItems(payload) {
    const { color, fileUuid, ownerName } = parseSharedOptions(payload);
    const canvas = await fetchCanvas(fileUuid);
    if (payload?.lightweight) return getSharedLikeStateFromCanvas(canvas, ownerName);
    return getSharedLikesFromCanvas(canvas, ownerName);
  }

  async function toggleSharedLike(payload, retryCount = 1) {
    const { color, fileUuid, ownerName } = parseSharedOptions(payload);
    const item = payload?.item;
    const likeKey = getLikeKey(item);
    if (!likeKey) throw new Error("Selected Pixmax item has no stable Like key.");

    const canvas = await fetchCanvas(fileUuid);
    const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName);
    if (!ownerNode) {
      throw new Error(`共享画布里找不到名字为「${ownerName}」的文字节点。`);
    }

    const parsed = parseSharedLikeText(getRawNodeText(ownerNode));
    const ownerColor = normalizeColor(color || parsed?.color);
    const ownItems = parsed?.items ? [...parsed.items] : [];
    const existingIndex = ownItems.findIndex((likedItem) => getLikeKey(likedItem) === likeKey);
    let liked;

    if (existingIndex >= 0) {
      ownItems.splice(existingIndex, 1);
      liked = false;
    } else {
      ownItems.unshift({
        ...item,
        likedAt: new Date().toISOString(),
        likedBy: ownerName,
        likedByColor: ownerColor
      });
      liked = true;
    }

    const updateResult = await apiPostResult("/canvas/node/batch", {
      fileUuid,
      baseRevision: canvas.revision,
      create: [],
      update: [
        {
          uuid: ownerNode.uuid,
          metaData: ownerNode.metaData || "{}",
          nodeText: buildSharedLikeText(ownerName, ownItems, ownerColor, parsed?.settings || {})
        }
      ],
      delete: []
    });

    if (!updateResult.success) {
      if (updateResult.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
        return toggleSharedLike(payload, retryCount - 1);
      }
      throw new Error(updateResult.errMessage || updateResult.errCode || "共享 Likes 写入失败。");
    }

    window.setTimeout(() => syncLikeIndexForOwnerLater(fileUuid, ownerName, ownerColor, ownItems), 0);
    const state = getSharedStateFromLikeIndex({
      owners: [
        {
          color: ownerColor,
          keys: ownItems.map(getLikeKey).filter(Boolean),
          ownerName
        }
      ]
    }, ownerName);
    return {
      ...(payload?.lightweight
        ? {
            ...state,
            partialState: true
          }
        : {
            ...state,
            allItems: ownItems.map((ownItem) => ({
              ...ownItem,
              likedBy: ownerName,
              likedByColor: ownerColor
            })),
            ownItems
          }),
      liked
    };
  }

  function getEagleAnnotation(rawNodes, rawNode) {
    const ownPrompt = getPromptText(rawNode);
    if (ownPrompt) return ownPrompt;

    for (const sourceUuid of rawNode?.prevNodeUuids ?? []) {
      const sourceNode = rawNodes.find((node) => node.uuid === sourceUuid);
      const sourcePrompt = getPromptText(sourceNode ?? {});
      if (sourcePrompt) return sourcePrompt;
    }

    return "";
  }

  function getDomAssetFallback(nodeId) {
    const node = document.querySelector(`${NODE_SELECTOR}[data-id="${CSS.escape(nodeId)}"]`);
    if (!node) return null;

    const media = [
      ...node.querySelectorAll("video[src], video source[src], audio[src], audio source[src], img[src]")
    ]
      .filter((element) => {
        const url = element.currentSrc || element.src;
        return /^https?:\/\//i.test(url || "");
      })
      .sort((first, second) => {
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
      })[0];
    const url = media?.currentSrc || media?.src || "";
    if (!url) return null;

    return {
      mediaType: inferDomMediaType(media, url),
      name: node.querySelector("input")?.value || "",
      poster: media.poster || "",
      url
    };
  }

  function inferDomMediaType(element, url = "") {
    const tagName = String(element?.tagName || element?.parentElement?.tagName || "").toLowerCase();
    if (tagName === "video") return "video";
    if (tagName === "audio") return "audio";
    if (tagName === "img") return "image";
    return inferAssetMediaType(null, url);
  }

  function buildEagleAsset(rawNodes, nodeId) {
    const rawNode = rawNodes.find((node) => node.uuid === nodeId);
    const url = resolveAssetUrl(rawNode?.defaultAsset);
    const fallback = getDomAssetFallback(nodeId);

    if (!url && !fallback?.url) {
      throw new Error("当前节点没有可导入 Eagle 的图片、视频或音频素材。");
    }

    return {
      annotation: getEagleAnnotation(rawNodes, rawNode ?? {}),
      fileUuid: getCanvasIdentity().fileUuid,
      mediaType: inferAssetMediaType(rawNode?.defaultAsset, url || fallback?.url) || fallback?.mediaType || "",
      name: getNodeLabel(rawNode ?? {}) || fallback?.name || "",
      nodeId,
      poster: resolveAssetPreviewUrl(rawNode?.defaultAsset) || fallback?.poster || "",
      url: url || fallback.url,
      website: location.href
    };
  }

  async function getSelectedEagleAsset() {
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.length !== 1) {
      throw new Error("请只选中一个素材节点，再点击存入 Eagle。");
    }

    const canvas = await fetchCurrentCanvas();
    const rawNodes = canvas.nodes ?? [];
    return buildEagleAsset(rawNodes, selectedIds[0]);
  }

  async function getSelectedLikeAsset() {
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.length !== 1) {
      throw new Error("Please select one generated Pixmax result before clicking Like.");
    }

    const [nodeId] = selectedIds;
    const canvas = await fetchCurrentCanvas();
    const rawNodes = canvas.nodes ?? [];
    const rawNode = rawNodes.find((node) => node.uuid === nodeId);
    const url = resolveAssetUrl(rawNode?.defaultAsset);
    const fallback = getDomAssetFallback(nodeId);

    if (!url && !fallback?.url) {
      throw new Error("The selected Pixmax result does not expose a media URL.");
    }

    return {
      annotation: getEagleAnnotation(rawNodes, rawNode ?? {}),
      fileUuid: getCanvasIdentity().fileUuid,
      mediaType: inferAssetMediaType(rawNode?.defaultAsset, url || fallback?.url) || fallback?.mediaType || "",
      name: getNodeLabel(rawNode ?? {}) || fallback?.name || "",
      nodeId,
      poster: resolveAssetPreviewUrl(rawNode?.defaultAsset) || fallback?.poster || "",
      url: url || fallback.url,
      website: location.href
    };
  }

  function addAdjacencyConnection(adjacency, sourceId, targetId) {
    if (!adjacency.has(sourceId) || !adjacency.has(targetId)) return;
    adjacency.get(sourceId).add(targetId);
    adjacency.get(targetId).add(sourceId);
  }

  function buildAdjacency(rawNodes) {
    const adjacency = new Map(rawNodes.map((node) => [node.uuid, new Set()]));

    for (const node of rawNodes) {
      for (const sourceUuid of node.prevNodeUuids ?? []) {
        addAdjacencyConnection(adjacency, sourceUuid, node.uuid);
      }
    }

    return adjacency;
  }

  function buildLiveAdjacency() {
    const nodeIds = [...document.querySelectorAll(NODE_SELECTOR)].map(
      (node) => node.dataset.id
    );
    const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, new Set()]));

    for (const edge of document.querySelectorAll(EDGE_SELECTOR)) {
      const match = edge.getAttribute("aria-label")?.match(/^Edge from (.+) to (.+)$/);
      if (!match) continue;
      addAdjacencyConnection(adjacency, match[1], match[2]);
    }

    return adjacency;
  }

  function mergeAdjacency(...graphs) {
    const adjacency = new Map();

    for (const graph of graphs) {
      for (const [nodeId, linkedNodeIds] of graph) {
        if (!adjacency.has(nodeId)) adjacency.set(nodeId, new Set());
        for (const linkedNodeId of linkedNodeIds) {
          if (!adjacency.has(linkedNodeId)) adjacency.set(linkedNodeId, new Set());
          adjacency.get(nodeId).add(linkedNodeId);
          adjacency.get(linkedNodeId).add(nodeId);
        }
      }
    }

    return adjacency;
  }

  function findSeedNodeIds(rawNodes, selectedIds) {
    const selected = new Set(selectedIds);
    return rawNodes
      .filter((node) => {
        const metaData = parseMetaData(node);
        return (
          selected.has(node.uuid) ||
          (metaData.parentId && selected.has(metaData.parentId))
        );
      })
      .map((node) => node.uuid);
  }

  function collectDirectlyLinkedNodeIds(rawNodes, selectedIds) {
    const adjacency = mergeAdjacency(
      buildAdjacency(rawNodes),
      buildLiveAdjacency()
    );
    const included = new Set(selectedIds);

    for (const selectedId of selectedIds) {
      for (const linkedUuid of adjacency.get(selectedId) ?? []) {
        included.add(linkedUuid);
      }
    }

    return included;
  }

  function dispatchShiftKey(type) {
    document.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Shift",
        code: "ShiftLeft",
        shiftKey: type === "keydown",
        bubbles: true,
        cancelable: true
      })
    );
  }

  function toggleNodeSelection(node) {
    node.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        shiftKey: true
      })
    );
  }

  async function selectDirectlyLinkedNodes() {
    const canvas = await fetchCurrentCanvas();
    const rawNodes = canvas.nodes ?? [];
    const selectedIds = getSelectedNodeIds();

    if (selectedIds.length !== 1) {
      throw new Error("请只选中一个主节点，再点击扩展按钮。");
    }

    const seedIds = [...new Set([
      ...selectedIds,
      ...findSeedNodeIds(rawNodes, selectedIds)
    ])];
    const included = collectDirectlyLinkedNodeIds(rawNodes, seedIds);

    if (!included.size) {
      throw new Error("请先在画布里选中一个主节点。");
    }

    const domNodes = [...document.querySelectorAll(NODE_SELECTOR)];
    dispatchShiftKey("keydown");
    try {
      for (const node of domNodes) {
        const shouldSelect = included.has(node.dataset.id);
        if (node.classList.contains("selected") !== shouldSelect) {
          toggleNodeSelection(node);
        }
      }
    } finally {
      dispatchShiftKey("keyup");
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const selectedAfter = getSelectedNodeIds();
    const missingCount = [...included].filter(
      (uuid) => !selectedAfter.includes(uuid)
    ).length;

    if (missingCount) {
      throw new Error(`还有 ${missingCount} 个直接连线节点未能选中，请重试。`);
    }

    return {
      directlyLinkedNodeCount: Math.max(0, included.size - seedIds.length),
      selectedNodeCount: selectedAfter.length
    };
  }

  function dispatchShortcut(key, shiftKey = false) {
    const init = {
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true
    };

    document.dispatchEvent(new KeyboardEvent("keydown", init));
    document.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function triggerOfficialSync() {
    dispatchShortcut("s");
    return { triggered: true };
  }

  function rewriteMentionTokens(value, nodeIdMap) {
    let rewrittenMentionCount = 0;

    function rewrite(currentValue) {
      if (typeof currentValue === "string") {
        return currentValue.replace(
          MENTION_TOKEN_PATTERN,
          (token, title, type, index, mentionId) => {
            const replacementId = nodeIdMap.get(mentionId);
            if (!replacementId) return token;

            rewrittenMentionCount += 1;
            return `%%@[${title}][${type}][${index}](${replacementId})%%`;
          }
        );
      }

      if (Array.isArray(currentValue)) {
        return currentValue.map(rewrite);
      }

      if (currentValue && typeof currentValue === "object") {
        return Object.fromEntries(
          Object.entries(currentValue).map(([key, item]) => [key, rewrite(item)])
        );
      }

      return currentValue;
    }

    return {
      value: rewrite(value),
      rewrittenMentionCount
    };
  }

  function getClipboardNodeIds(payload) {
    if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
      return null;
    }

    const payloadNodeIds = payload.nodes.map((node) => node?.id);
    if (!payloadNodeIds.length || payloadNodeIds.some((nodeId) => typeof nodeId !== "string")) {
      return null;
    }

    return new Set(payloadNodeIds);
  }

  function isSameNodeSet(firstNodeIds, secondNodeIds) {
    return (
      firstNodeIds.size === secondNodeIds.size &&
      [...firstNodeIds].every((nodeId) => secondNodeIds.has(nodeId))
    );
  }

  function repairMentionsDuringNextNativePaste(expectedIds) {
    if (mentionRepairActive) {
      return Promise.reject(new Error("已有一个粘贴修复操作正在进行，请稍后重试。"));
    }

    mentionRepairActive = true;
    const expectedNodeIds = expectedIds ? new Set(expectedIds) : null;
    const nativeJsonParse = JSON.parse;
    const nativeMapSet = Map.prototype.set;
    let clipboardNodeIds;
    let clipboardPayload;
    let settled = false;
    let timer;

    return new Promise((resolve, reject) => {
      function restore() {
        JSON.parse = nativeJsonParse;
        Map.prototype.set = nativeMapSet;
        mentionRepairActive = false;
        window.clearTimeout(timer);
      }

      function finish(callback, payload) {
        if (settled) return;
        settled = true;
        restore();
        callback(payload);
      }

      JSON.parse = function pixmaxCanvasClonerJsonParse(...args) {
        const parsed = nativeJsonParse.apply(this, args);
        const parsedNodeIds = getClipboardNodeIds(parsed);
        if (
          parsedNodeIds &&
          (!expectedNodeIds || isSameNodeSet(parsedNodeIds, expectedNodeIds))
        ) {
          clipboardPayload = parsed;
          clipboardNodeIds = parsedNodeIds;
        }
        return parsed;
      };

      Map.prototype.set = function pixmaxCanvasClonerMapSet(key, value) {
        const result = nativeMapSet.call(this, key, value);
        if (
          !settled &&
          clipboardPayload &&
          clipboardNodeIds.has(key) &&
          typeof value === "string"
        ) {
          const nodeIdMap = new Map();
          for (const nodeId of clipboardNodeIds) {
            const replacementId = this.get(nodeId);
            if (typeof replacementId !== "string") return result;
            nativeMapSet.call(nodeIdMap, nodeId, replacementId);
          }

          let rewrittenMentionCount = 0;
          for (const node of clipboardPayload.nodes) {
            if (!node.data?.params) continue;
            const rewritten = rewriteMentionTokens(node.data.params, nodeIdMap);
            node.data.params = rewritten.value;
            rewrittenMentionCount += rewritten.rewrittenMentionCount;
          }

          finish(resolve, { rewrittenMentionCount });
        }
        return result;
      };

      timer = window.setTimeout(() => {
        finish(
          reject,
          new Error("副本粘贴超时，未能自动修复 @节点 引用，请刷新后重试。")
        );
      }, 5000);
    });
  }

  function prepareNativePasteWithMentionRepair() {
    if (mentionRepairActive) {
      throw new Error("已有一个粘贴修复操作正在进行，请稍后重试。");
    }

    repairMentionsDuringNextNativePaste().then(
      (payload) => {
        window.postMessage(
          {
            source: RESPONSE_SOURCE,
            notification: "paste-repair-complete",
            payload
          },
          location.origin
        );
      },
      (error) => {
        window.postMessage(
          {
            source: RESPONSE_SOURCE,
            notification: "paste-repair-error",
            payload: { error: error.message }
          },
          location.origin
        );
      }
    );

    return { armed: true };
  }

  async function duplicateDirectlyLinkedNodes() {
    const selection = await selectDirectlyLinkedNodes();
    dispatchShortcut("c");
    await new Promise((resolve) => setTimeout(resolve, 700));
    const mentionRepair = repairMentionsDuringNextNativePaste(getSelectedNodeIds());
    dispatchShortcut("v", true);
    return {
      ...selection,
      ...(await mentionRepair)
    };
  }

  window.addEventListener(REQUEST_EVENT, async (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }

    const { requestId, action, payload } = request;
    if (!requestId) return;

    try {
      if (action === "select-neighbors") {
        respond(requestId, true, await selectDirectlyLinkedNodes());
        return;
      }

      if (action === "duplicate-neighbors") {
        respond(requestId, true, await duplicateDirectlyLinkedNodes());
        return;
      }

      if (action === "prepare-paste-repair") {
        respond(requestId, true, prepareNativePasteWithMentionRepair());
        return;
      }

      if (action === "get-current-canvas-revision") {
        respond(requestId, true, await getCurrentCanvasRevision());
        return;
      }

      if (action === "get-official-live-sync-status") {
        respond(requestId, true, getOfficialLiveSyncStatus());
        return;
      }

      if (action === "get-official-presence-status") {
        respond(requestId, true, getOfficialPresenceStatus());
        return;
      }

      if (action === "set-live-presence-identity") {
        respond(requestId, true, setLivePresenceIdentity(payload));
        return;
      }

      if (action === "broadcast-official-presence") {
        respond(requestId, true, broadcastOfficialPresence(payload));
        return;
      }

      if (action === "trigger-official-workspace-sync") {
        respond(requestId, true, await triggerOfficialWorkspaceSync(payload));
        return;
      }

      if (action === "pull-official-remote-snapshot") {
        respond(requestId, true, await pullOfficialRemoteSnapshot(payload));
        return;
      }

      if (action === "trigger-official-sync") {
        respond(requestId, true, triggerOfficialSync());
        return;
      }

      if (action === "get-selected-eagle-asset") {
        respond(requestId, true, await getSelectedEagleAsset());
        return;
      }

      if (action === "get-selected-like-asset") {
        respond(requestId, true, await getSelectedLikeAsset());
        return;
      }

      if (action === "get-shared-liked-items") {
        respond(requestId, true, await getSharedLikedItems(payload));
        return;
      }

      if (action === "toggle-shared-like") {
        respond(requestId, true, await toggleSharedLike(payload));
        return;
      }

      respond(requestId, false, { error: "未知操作。" });
    } catch (error) {
      respond(requestId, false, { error: error.message });
    }
  });
})();

(() => {
  if (window.__pixmaxCanvasClonerBridge) return;
  window.__pixmaxCanvasClonerBridge = true;

  const REQUEST_EVENT = "pixmax-canvas-cloner:request";
  const RESPONSE_SOURCE = "pixmax-canvas-cloner:bridge";
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

  function updateLikeIndexOwner(index, ownerName, color, items) {
    const normalized = normalizeLikeIndex(index);
    const keys = [...new Set((items || []).map(getLikeKey).filter(Boolean))];
    const owners = normalized.owners.filter((owner) => owner.ownerName !== ownerName);
    owners.push({
      color: normalizeColor(color),
      keys,
      ownerName
    });
    return normalizeLikeIndex({ owners });
  }

  function buildLikeIndexNode(nodes, data) {
    const positions = nodes
      .filter(isTextLikeNode)
      .map((node) => parseNodeMetaData(node).position || {});
    const maxX = positions.reduce((value, position) => Math.max(value, Number(position.x) || 0), 0);

    return {
      uuid: crypto.randomUUID(),
      type: "BASE_TEXT",
      metaData: JSON.stringify({
        data: { label: LIKE_INDEX_NODE_LABEL },
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
    const indexNode = findLikeIndexNode(canvas.nodes ?? []);
    const currentIndex = indexNode
      ? parseLikeIndexText(getRawNodeText(indexNode)) || normalizeLikeIndex()
      : deriveLikeIndexFromCanvas(canvas);
    const nextIndex = updateLikeIndexOwner(currentIndex, ownerName, color, items);
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
          create: [buildLikeIndexNode(canvas.nodes ?? [], nextIndex)],
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

    return getSharedStateFromLikeIndex(nextIndex, ownerName);
  }

  function getSharedLikeStateFromCanvas(canvas, ownerName) {
    const indexNode = findLikeIndexNode(canvas.nodes ?? []);
    const index = indexNode ? parseLikeIndexText(getRawNodeText(indexNode)) : null;
    if (index) return getSharedStateFromLikeIndex(index, ownerName);

    const allKeys = [];
    const ownKeys = [];
    const colorByKey = {};

    for (const node of canvas.nodes ?? []) {
      if (!isTextLikeNode(node) || !shouldScanTextNodeForLikes(node)) continue;
      const parsed = parseSharedLikeStateText(getRawNodeText(node));
      if (!parsed) continue;
      const likedBy = parsed.ownerName || getRawNodeLabel(node) || "Unknown";

      for (const item of parsed.items) {
        if (!item.key) continue;
        allKeys.push(item.key);
        if (!colorByKey[item.key]) colorByKey[item.key] = normalizeColor(item.likedByColor || parsed.color);
        if (likedBy === ownerName) {
          ownKeys.push(item.key);
          colorByKey[item.key] = normalizeColor(item.likedByColor || parsed.color);
        }
      }
    }

    return {
      allKeys,
      ownKeys,
      colorByKey
    };
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

    const nextCanvas = await fetchCanvas(fileUuid);
    let state;
    try {
      state = await upsertLikeIndexForOwner(fileUuid, nextCanvas, ownerName, ownerColor, ownItems);
    } catch {
      state = getSharedLikeStateFromCanvas(nextCanvas, ownerName);
    }
    return {
      ...(payload?.lightweight
        ? state
        : getSharedLikesFromCanvas(nextCanvas, ownerName)),
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
      name: node.querySelector("input")?.value || "",
      poster: media.poster || "",
      url
    };
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

"use strict";

const MESSAGE = {
  EAGLE_LIST_FOLDERS: "pixmax-cloner:eagle-list-folders"
};

const API_ORIGIN = "https://app.pixmax.cn";
const SHARED_LIKES_MARKER = "PIXMAX_CANVAS_CLONER_LIKES_V1";
const UPDATE_DIRECTORY_DB = "pixmax-canvas-cloner-update";
const UPDATE_DIRECTORY_STORE = "handles";
const UPDATE_DIRECTORY_KEY = "extensionDirectory";
const UPDATE_DIRECTORY_LABEL_KEY = "pixmaxUpdateDirectoryLabel";
const DEFAULT_DATABASE_URL =
  "https://app.pixmax.cn/workspace/3bba9785-24d6-4b1f-84c1-895d85db4bbe?file=1f14fa50-bdeb-6eaf-9168-47138a4a9766";
const DEFAULT_GITHUB_UPDATE_URL = "https://github.com/171896542/PixmaxHub-Plug/tree/main";
const DEFAULT_LIKE_COLOR = "#ff3864";
const CANVAS_REVISION_CONFLICT = "Canvas.Revision.Conflict";
const UPDATE_FILE_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".md",
  ".png",
  ".svg",
  ".txt",
  ".webp",
  ".woff",
  ".woff2"
]);
const IGNORED_UPDATE_DIRECTORIES = new Set([".git", ".github", "node_modules"]);

const DEFAULT_OPTIONS = {
  eagleFolderId: "",
  eagleFolderName: "",
  sharedLikesEnabled: false,
  sharedLikesCanvasUrl: DEFAULT_DATABASE_URL,
  sharedLikesFileUuid: "",
  sharedLikesOwnerName: "",
  sharedLikesColor: DEFAULT_LIKE_COLOR,
  githubUpdateUrl: DEFAULT_GITHUB_UPDATE_URL
};

const folderSelect = document.querySelector("#eagleFolder");
const refreshButton = document.querySelector("#refreshFolders");
const openLikesButton = document.querySelector("#openLikes");
const status = document.querySelector("#status");
const sharedLikesEnabled = document.querySelector("#sharedLikesEnabled");
const sharedLikesCanvasUrl = document.querySelector("#sharedLikesCanvasUrl");
const sharedLikesOwnerName = document.querySelector("#sharedLikesOwnerName");
const sharedLikesColor = document.querySelector("#sharedLikesColor");
const sharedLikesColorText = document.querySelector("#sharedLikesColorText");
const createSharedUserButton = document.querySelector("#createSharedUser");
const saveSharedLikesButton = document.querySelector("#saveSharedLikes");
const sharedStatus = document.querySelector("#sharedStatus");
const githubUpdateUrl = document.querySelector("#githubUpdateUrl");
const checkUpdateButton = document.querySelector("#checkUpdate");
const applyUpdateButton = document.querySelector("#applyUpdate");
const chooseUpdateDirectoryButton = document.querySelector("#chooseUpdateDirectory");
const updateDirectory = document.querySelector("#updateDirectory");
const updateStatus = document.querySelector("#updateStatus");
let storedFolderId = "";
let userStateTimer = 0;
let colorSyncTimer = 0;
let pendingUpdatePackage = null;

init();

function init() {
  chrome.storage.sync.get(DEFAULT_OPTIONS, (options) => {
    storedFolderId = options.eagleFolderId || "";
    if (storedFolderId) {
      folderSelect.textContent = "";
      folderSelect.append(
        new Option(options.eagleFolderName || `已保存目录 (${storedFolderId})`, storedFolderId)
      );
      folderSelect.value = storedFolderId;
      setStatus("已读取保存的 Eagle 目录。点击刷新可重新选择。", "success");
    }
    sharedLikesEnabled.checked = Boolean(options.sharedLikesEnabled);
    sharedLikesCanvasUrl.value = options.sharedLikesCanvasUrl || "";
    if (!sharedLikesCanvasUrl.value) sharedLikesCanvasUrl.value = DEFAULT_DATABASE_URL;
    sharedLikesOwnerName.value = options.sharedLikesOwnerName || "";
    sharedLikesColor.value = normalizeColor(options.sharedLikesColor);
    sharedLikesColorText.textContent = sharedLikesColor.value;
    githubUpdateUrl.value = options.githubUpdateUrl || DEFAULT_GITHUB_UPDATE_URL;
    if (options.sharedLikesEnabled && options.sharedLikesFileUuid && options.sharedLikesOwnerName) {
      setSharedStatus("已启用共享 Likes。", "success");
    }
    if (options.sharedLikesFileUuid && options.sharedLikesOwnerName) {
      window.setTimeout(
        () => refreshSharedUpdateDirectoryLabel(options.sharedLikesFileUuid, options.sharedLikesOwnerName),
        800
      );
    }
    scheduleSharedUserStateRefresh();
    if (options.githubUpdateUrl) {
      window.setTimeout(() => checkForUpdate({ silent: true }), 600);
    }
  });

  refreshButton.addEventListener("click", loadFolders);
  folderSelect.addEventListener("change", saveSelectedFolder);
  sharedLikesCanvasUrl.addEventListener("input", scheduleSharedUserStateRefresh);
  sharedLikesOwnerName.addEventListener("input", scheduleSharedUserStateRefresh);
  sharedLikesColor.addEventListener("input", () => {
    sharedLikesColor.value = normalizeColor(sharedLikesColor.value);
    sharedLikesColorText.textContent = sharedLikesColor.value;
  });
  sharedLikesColor.addEventListener("change", scheduleSharedColorSync);
  createSharedUserButton.addEventListener("click", createSharedUser);
  saveSharedLikesButton.addEventListener("click", saveSharedLikesOptions);
  githubUpdateUrl.addEventListener("change", saveGithubUpdateUrl);
  checkUpdateButton.addEventListener("click", () => checkForUpdate());
  applyUpdateButton.addEventListener("click", applyPendingUpdate);
  chooseUpdateDirectoryButton.addEventListener("click", chooseUpdateDirectory);
  openLikesButton.addEventListener("click", openLikesPage);
  refreshUpdateDirectoryStatus();
}

function openLikesPage() {
  const url = chrome.runtime.getURL("likes.html");
  window.open(url, "_blank", "noopener");
}

async function loadFolders() {
  setBusy(true);
  setStatus("正在连接 Eagle...", "");

  try {
    const response = await sendRuntimeMessage({ type: MESSAGE.EAGLE_LIST_FOLDERS });
    if (!response?.ok) throw new Error(response?.error || "无法读取 Eagle 目录。");

    renderFolders(response.folders || []);
    setStatus(
      response.folders?.length ? "已连接 Eagle，请选择目标目录。" : "Eagle 当前资源库没有目录。",
      "success"
    );
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

function renderFolders(folders) {
  folderSelect.textContent = "";
  folderSelect.append(new Option("选择 Eagle 目录", ""));

  for (const folder of folders) {
    folderSelect.append(new Option(folder.name, folder.id));
  }

  if (storedFolderId && folders.some((folder) => folder.id === storedFolderId)) {
    folderSelect.value = storedFolderId;
  }
}

function saveSelectedFolder() {
  storedFolderId = folderSelect.value;
  const folderName = folderSelect.selectedOptions[0]?.textContent || "";

  chrome.storage.sync.set(
    {
      eagleFolderId: storedFolderId,
      eagleFolderName: storedFolderId ? folderName : ""
    },
    () => {
      setStatus(
        storedFolderId ? `已设置 Eagle 目录：${folderName}` : "请选择 Eagle 目录。",
        storedFolderId ? "success" : ""
      );
    }
  );
}

function saveSharedLikesOptions() {
  const canvasUrl = sharedLikesCanvasUrl.value.trim();
  const ownerName = sharedLikesOwnerName.value.trim();
  const color = normalizeColor(sharedLikesColor.value);
  const enabled = sharedLikesEnabled.checked;
  const fileUuid = extractFileUuid(canvasUrl);

  if (enabled && !fileUuid) {
    setSharedStatus("数据库链接里没有找到 file 参数。", "error");
    return;
  }

  if (enabled && !ownerName) {
    setSharedStatus("请填写你的名字，它要和共享画布里的文字节点对应。", "error");
    return;
  }

  chrome.storage.sync.set(
    {
      sharedLikesEnabled: enabled,
      sharedLikesCanvasUrl: canvasUrl,
      sharedLikesFileUuid: fileUuid,
      sharedLikesOwnerName: ownerName,
      sharedLikesColor: color
    },
    () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        setSharedStatus(runtimeError.message, "error");
        return;
      }

      setSharedStatus(
        enabled ? `已启用共享 Likes：${ownerName}` : "已关闭共享 Likes，收藏会回到本地保存。",
        "success"
      );
      if (enabled) {
        updateSharedUserColor(fileUuid, ownerName, color).then(
          () => setSharedStatus(`已启用共享 Likes：${ownerName}，颜色已同步。`, "success"),
          (error) => setSharedStatus(error.message || String(error), "error")
        );
      }
    }
  );
}

function saveGithubUpdateUrl() {
  const value = githubUpdateUrl.value.trim();
  storageSyncSet({ githubUpdateUrl: value }).catch((error) => {
    setUpdateStatus(error.message || String(error), "error");
  });
}

function scheduleSharedColorSync() {
  window.clearTimeout(colorSyncTimer);
  colorSyncTimer = window.setTimeout(syncSharedColor, 300);
}

async function syncSharedColor() {
  const canvasUrl = sharedLikesCanvasUrl.value.trim();
  const fileUuid = extractFileUuid(canvasUrl);
  const ownerName = sharedLikesOwnerName.value.trim();
  const color = normalizeColor(sharedLikesColor.value);
  sharedLikesColor.value = color;
  sharedLikesColorText.textContent = color;

  try {
    await storageSyncSet({ sharedLikesColor: color });
    if (sharedLikesEnabled.checked && fileUuid && ownerName) {
      await updateSharedUserColor(fileUuid, ownerName, color);
      setSharedStatus(`颜色已同步：${color}`, "success");
    } else {
      setSharedStatus(`颜色已保存：${color}`, "success");
    }
  } catch (error) {
    setSharedStatus(error.message || String(error), "error");
  }
}

async function createSharedUser() {
  const canvasUrl = sharedLikesCanvasUrl.value.trim();
  const ownerName = sharedLikesOwnerName.value.trim();
  const color = normalizeColor(sharedLikesColor.value);
  const fileUuid = extractFileUuid(canvasUrl);

  if (!fileUuid) {
    setSharedStatus("数据库链接里没有找到 file 参数。", "error");
    return;
  }
  if (!ownerName) {
    setSharedStatus("请先填写你的名字。", "error");
    return;
  }

  setCreateUserBusy(true, "创建中...");
  try {
    const created = await createSharedUserNode(fileUuid, ownerName, color);
    await storageSyncSet({
      sharedLikesCanvasUrl: canvasUrl,
      sharedLikesFileUuid: fileUuid,
      sharedLikesOwnerName: ownerName,
      sharedLikesColor: color
    });
    setSharedStatus(
      created ? `已在共享画布创建用户：${ownerName}` : `共享画布里已经有用户：${ownerName}`,
      "success"
    );
    await refreshSharedUserState();
  } catch (error) {
    setSharedStatus(error.message || String(error), "error");
    createSharedUserButton.disabled = false;
    createSharedUserButton.textContent = "创建用户";
  } finally {
    setCreateUserBusy(false);
  }
}

async function createSharedUserNode(fileUuid, ownerName, color, retryCount = 1) {
  const canvas = await fetchSharedCanvas(fileUuid);
  if (findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName)) return false;

  const node = buildSharedUserNode(canvas.nodes ?? [], ownerName, color);
  const result = await apiPost("/canvas/node/batch", {
    fileUuid,
    baseRevision: canvas.revision,
    create: [node],
    update: [],
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return createSharedUserNode(fileUuid, ownerName, color, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "创建共享用户失败。");
  }

  return true;
}

function buildSharedUserNode(nodes, ownerName, color) {
  const storageNodes = nodes.filter(isTextLikeNode);
  const positions = storageNodes.map((node) => parseNodeMetaData(node).position || {});
  const maxX = positions.reduce((value, position) => Math.max(value, Number(position.x) || 0), 0);
  const nextY = positions.length * 180;

  return {
    uuid: crypto.randomUUID(),
    type: "BASE_TEXT",
    metaData: JSON.stringify({
      data: { label: ownerName },
      position: {
        x: maxX + 320,
        y: nextY
      },
      measured: {
        width: 260,
        height: 140
      },
      width: 260,
      height: 140
    }),
    nodeText: buildSharedLikeText(ownerName, [], color)
  };
}

function scheduleSharedUserStateRefresh() {
  window.clearTimeout(userStateTimer);
  userStateTimer = window.setTimeout(refreshSharedUserState, 450);
}

async function refreshSharedUserState() {
  const fileUuid = extractFileUuid(sharedLikesCanvasUrl.value.trim());
  const ownerName = sharedLikesOwnerName.value.trim();
  sharedLikesColor.value = normalizeColor(sharedLikesColor.value);
  sharedLikesColorText.textContent = sharedLikesColor.value;

  if (!fileUuid || !ownerName) {
    createSharedUserButton.disabled = true;
    createSharedUserButton.textContent = "创建用户";
    return;
  }

  setCreateUserBusy(true, "检查中...");
  try {
    const canvas = await fetchSharedCanvas(fileUuid);
    const exists = Boolean(findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName));
    createSharedUserButton.disabled = exists;
    createSharedUserButton.textContent = exists ? "已创建" : "创建用户";
    if (exists) {
      setSharedStatus(`共享画布里已有用户：${ownerName}`, "success");
    } else {
      setSharedStatus("这个名字还没有创建，可以点击创建用户。", "");
    }
  } catch (error) {
    createSharedUserButton.disabled = true;
    createSharedUserButton.textContent = "创建用户";
    setSharedStatus(error.message || String(error), "error");
  }
}

function setCreateUserBusy(busy, text = "") {
  if (text) createSharedUserButton.textContent = text;
  createSharedUserButton.disabled = busy || createSharedUserButton.textContent === "已创建";
}

function extractFileUuid(value) {
  try {
    return new URL(value).searchParams.get("file") || "";
  } catch {
    return "";
  }
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIKE_COLOR;
}

async function apiPost(path, body) {
  const response = await fetch(`${API_ORIGIN}/user/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.errMessage || result.errCode || `Pixmax API 请求失败：${path}`);
  }
  return result;
}

async function fetchSharedCanvas(fileUuid) {
  const result = await apiPost("/canvas/get", { fileUuid });
  if (!result.success) throw new Error(result.errMessage || result.errCode || "无法读取共享画布。");
  return result.data;
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

async function updateSharedUserColor(fileUuid, ownerName, color, retryCount = 1) {
  const canvas = await fetchSharedCanvas(fileUuid);
  const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName);
  if (!ownerNode) {
    throw new Error(`共享画布里还没有用户「${ownerName}」，请先点击创建用户。`);
  }

  const parsed = parseSharedLikeText(getRawNodeText(ownerNode));
  const result = await apiPost("/canvas/node/batch", {
    fileUuid,
    baseRevision: canvas.revision,
    create: [],
    update: [
      {
        uuid: ownerNode.uuid,
        metaData: ownerNode.metaData || "{}",
        nodeText: buildSharedLikeText(ownerName, parsed?.items || [], color, parsed?.settings || {})
      }
    ],
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return updateSharedUserColor(fileUuid, ownerName, color, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "同步共享颜色失败。");
  }
}

async function updateSharedUserSettings(fileUuid, ownerName, settingsPatch, retryCount = 1) {
  const canvas = await fetchSharedCanvas(fileUuid);
  const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName);
  if (!ownerNode) return;

  const parsed = parseSharedLikeText(getRawNodeText(ownerNode));
  const result = await apiPost("/canvas/node/batch", {
    fileUuid,
    baseRevision: canvas.revision,
    create: [],
    update: [
      {
        uuid: ownerNode.uuid,
        metaData: ownerNode.metaData || "{}",
        nodeText: buildSharedLikeText(
          ownerName,
          parsed?.items || [],
          parsed?.color || sharedLikesColor.value,
          {
            ...(parsed?.settings || {}),
            ...settingsPatch
          }
        )
      }
    ],
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return updateSharedUserSettings(fileUuid, ownerName, settingsPatch, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "同步共享设置失败。");
  }
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

function buildSharedLikeText(ownerName, items, color, settings = {}) {
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

async function checkForUpdate(options = {}) {
  const silent = Boolean(options.silent);
  const updateSourceUrl = githubUpdateUrl.value.trim();
  if (!updateSourceUrl) {
    if (!silent) setUpdateStatus("请先填写 GitHub 更新源。", "error");
    return;
  }

  setUpdateBusy(true, silent ? "" : "检查中...");
  pendingUpdatePackage = null;
  applyUpdateButton.disabled = true;

  try {
    await storageSyncSet({ githubUpdateUrl: updateSourceUrl });
    const source = await resolveGithubUpdateSource(updateSourceUrl);
    const latest = await fetchGithubManifest(source);
    const currentVersion = chrome.runtime.getManifest().version;
    if (!isVersion(latest.version)) {
      throw new Error("GitHub 仓库里的 manifest.json 版本号格式不正确。");
    }
    if (compareVersions(latest.version, currentVersion) <= 0) {
      if (!silent) {
        setUpdateStatus(`当前已是最新版本 ${currentVersion}。GitHub 版本：${latest.version}`, "success");
      }
      return;
    }

    pendingUpdatePackage = {
      source,
      type: "github",
      version: latest.version
    };
    applyUpdateButton.disabled = false;
    setUpdateStatus(
      `发现 GitHub 新版本 ${latest.version}，当前 ${currentVersion}。`,
      "success"
    );
  } catch (error) {
    if (!silent) setUpdateStatus(error.message || String(error), "error");
  } finally {
    setUpdateBusy(false);
  }
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

async function resolveGithubUpdateSource(value) {
  const source = parseGithubUpdateUrl(value);
  if (!source) {
    throw new Error("GitHub 更新源格式不正确，请填写 https://github.com/owner/repo。");
  }

  return { ...source, branch: source.branch || "main" };
}

async function fetchGithubManifest(source) {
  const response = await fetch(githubRawUrl(source, "manifest.json"));
  if (!response.ok) {
    throw new Error(await githubResponseError(response, "读取 GitHub manifest 失败"));
  }
  try {
    return await response.json();
  } catch {
    throw new Error("GitHub 仓库里的 manifest.json 无法解析。");
  }
}

async function fetchGithubUpdateFiles(source) {
  const response = await fetch(githubTarballUrl(source));
  if (!response.ok) {
    throw new Error(await githubResponseError(response, "下载 GitHub 更新包失败"));
  }
  const compressedBytes = new Uint8Array(await response.arrayBuffer());
  const archiveBytes = await ungzip(compressedBytes);
  return parseGithubTarArchive(archiveBytes);
}

async function githubResponseError(response, fallback) {
  try {
    const data = await response.json();
    if (data?.message) return `${fallback}：${data.message}`;
  } catch {
    // GitHub raw responses are not always JSON.
  }
  return `${fallback}（HTTP ${response.status}）`;
}

function encodeGithubPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function githubRawUrl(source, path) {
  return (
    `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}` +
    `/${encodeURIComponent(source.repo)}/${encodeGithubPath(source.branch)}/${encodeGithubPath(path)}`
  );
}

function githubTarballUrl(source) {
  return (
    `https://codeload.github.com/${encodeURIComponent(source.owner)}` +
    `/${encodeURIComponent(source.repo)}/tar.gz/refs/heads/${encodeGithubPath(source.branch)}`
  );
}

async function applyPendingUpdate() {
  if (!pendingUpdatePackage) {
    setUpdateStatus("请先检查更新。", "error");
    return;
  }
  if (!globalThis.showDirectoryPicker) {
    setUpdateStatus("当前 Chrome 不支持选择文件夹写入，无法安装更新。", "error");
    return;
  }

  try {
    const directory = await getWritableUpdateDirectory();
    setUpdateBusy(true, "安装中...");

    const files = await fetchGithubUpdateFiles(pendingUpdatePackage.source);
    validateUpdateFiles(files);
    await writeUpdateFiles(directory, files);

    setUpdateStatus(`已安装 ${pendingUpdatePackage.version}，正在重新加载扩展...`, "success");
    window.setTimeout(() => chrome.runtime.reload(), 500);
  } catch (error) {
    setUpdateStatus(error.message || String(error), "error");
  } finally {
    setUpdateBusy(false);
  }
}

async function chooseUpdateDirectory() {
  if (!globalThis.showDirectoryPicker) {
    setUpdateStatus("当前 Chrome 不支持选择文件夹写入，无法记住更新目录。", "error");
    return;
  }

  try {
    setUpdateBusy(true, "选择更新目录中...");
    const directory = await showDirectoryPicker({
      id: "pixmax-canvas-cloner-extension",
      mode: "readwrite"
    });
    await requestDirectoryPermission(directory);
    await saveUpdateDirectoryHandle(directory);
    await storageLocalSet({ [UPDATE_DIRECTORY_LABEL_KEY]: directory.name || "已选择的扩展目录" });
    await syncUpdateDirectoryNameToCanvas(directory.name || "已选择的扩展目录");
    refreshUpdateDirectoryStatus(directory.name);
    setUpdateStatus("已记住更新目录。以后安装更新会直接写入这个目录。", "success");
  } catch (error) {
    setUpdateStatus(error.message || String(error), "error");
  } finally {
    setUpdateBusy(false);
  }
}

async function syncUpdateDirectoryNameToCanvas(directoryName) {
  const fileUuid = extractFileUuid(sharedLikesCanvasUrl.value.trim());
  const ownerName = sharedLikesOwnerName.value.trim();
  if (!fileUuid || !ownerName) return;
  try {
    await updateSharedUserSettings(fileUuid, ownerName, {
      updateDirectoryName: String(directoryName || "").trim()
    });
  } catch {
    // 本地目录权限已经保存，画布配置同步失败不影响安装更新。
  }
}

async function refreshSharedUpdateDirectoryLabel(fileUuid, ownerName) {
  try {
    const canvas = await fetchSharedCanvas(fileUuid);
    const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], ownerName);
    const parsed = ownerNode ? parseSharedLikeText(getRawNodeText(ownerNode)) : null;
    const directoryName = String(parsed?.settings?.updateDirectoryName || "").trim();
    if (directoryName) {
      updateDirectory.textContent = `画布记录目录：${directoryName}`;
      updateDirectory.classList.add("success");
    }
  } catch {
    // 这里只是显示提示；实际安装更新使用本机保存的目录权限。
  }
}

async function getWritableUpdateDirectory() {
  const directory = await getUpdateDirectoryHandle();
  if (!directory) {
    throw new Error("请先点击「选择/更换更新目录」，选中当前 unpacked 扩展文件夹。");
  }
  await requestDirectoryPermission(directory);
  return directory;
}

async function requestDirectoryPermission(directory) {
  if (!directory?.queryPermission || !directory?.requestPermission) return;
  const options = { mode: "readwrite" };
  if ((await directory.queryPermission(options)) === "granted") return;
  if ((await directory.requestPermission(options)) !== "granted") {
    throw new Error("没有获得更新目录的写入权限。");
  }
}

async function openUpdateDirectoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UPDATE_DIRECTORY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(UPDATE_DIRECTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开更新目录存储。"));
  });
}

async function saveUpdateDirectoryHandle(directory) {
  const db = await openUpdateDirectoryDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(UPDATE_DIRECTORY_STORE, "readwrite");
    transaction.objectStore(UPDATE_DIRECTORY_STORE).put(directory, UPDATE_DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法保存更新目录。"));
  });
  db.close();
}

async function getUpdateDirectoryHandle() {
  const db = await openUpdateDirectoryDb();
  const directory = await new Promise((resolve, reject) => {
    const transaction = db.transaction(UPDATE_DIRECTORY_STORE, "readonly");
    const request = transaction.objectStore(UPDATE_DIRECTORY_STORE).get(UPDATE_DIRECTORY_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("无法读取更新目录。"));
  });
  db.close();
  return directory;
}

function refreshUpdateDirectoryStatus(label = "") {
  if (label) {
    updateDirectory.textContent = `已记住目录：${label}`;
    updateDirectory.classList.add("success");
    return;
  }

  chrome.storage.local.get({ [UPDATE_DIRECTORY_LABEL_KEY]: "" }, (values) => {
    const storedLabel = String(values[UPDATE_DIRECTORY_LABEL_KEY] || "").trim();
    updateDirectory.textContent = storedLabel ? `已记住目录：${storedLabel}` : "未记住更新目录";
    updateDirectory.classList.toggle("success", Boolean(storedLabel));
  });
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

function validateUpdateFiles(files) {
  if (!files.size) throw new Error("更新包里没有文件。");
  if (!files.has("manifest.json")) throw new Error("更新包缺少 manifest.json。");

  for (const path of files.keys()) {
    if (!isUpdatableRepositoryPath(path)) {
      throw new Error(`更新包包含不允许写入的文件：${path}`);
    }
  }
}

async function writeUpdateFiles(directory, files) {
  for (const [path, bytes] of files) {
    const handle = await getNestedFileHandle(directory, path);
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }
}

async function getNestedFileHandle(rootDirectory, path) {
  const parts = String(path || "").split("/").filter(Boolean);
  const filename = parts.pop();
  let directory = rootDirectory;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  return directory.getFileHandle(filename, { create: true });
}

async function ungzip(bytes) {
  if (!globalThis.DecompressionStream) {
    throw new Error("当前 Chrome 不支持 gzip 解压。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseGithubTarArchive(bytes) {
  const files = new Map();
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const path = stripTarRootDirectory(rawPath);
    const sizeText = readTarString(header, 124, 12).trim();
    const size = parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156] || 0);
    offset += 512;

    if ((type === "0" || type === "\0" || type === "") && isUpdatableRepositoryPath(path)) {
      files.set(path, bytes.slice(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

function stripTarRootDirectory(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  parts.shift();
  return parts.join("/");
}

function readTarString(bytes, start, length) {
  let output = "";
  for (let index = start; index < start + length; index += 1) {
    const byte = bytes[index];
    if (!byte) break;
    output += String.fromCharCode(byte);
  }
  return output;
}

function isUpdatableRepositoryPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || normalized.endsWith("/")) return false;
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.startsWith(".") || IGNORED_UPDATE_DIRECTORIES.has(part)
    )
  ) {
    return false;
  }

  const filename = parts[parts.length - 1] || "";
  if (filename === "manifest.json") return true;

  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
  return UPDATE_FILE_EXTENSIONS.has(extension);
}

function setUpdateBusy(busy, text = "") {
  checkUpdateButton.disabled = busy;
  applyUpdateButton.disabled = busy || !pendingUpdatePackage;
  chooseUpdateDirectoryButton.disabled = busy;
  if (text) updateStatus.textContent = text;
}

function setUpdateStatus(message, state) {
  updateStatus.textContent = message;
  updateStatus.classList.toggle("success", state === "success");
  updateStatus.classList.toggle("error", state === "error");
}

function storageSyncSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(values, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve();
    });
  });
}

function storageLocalSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve();
    });
  });
}

function setBusy(busy) {
  refreshButton.disabled = busy;
  folderSelect.disabled = busy;
}

function setStatus(message, state) {
  status.textContent = message;
  status.classList.toggle("success", state === "success");
  status.classList.toggle("error", state === "error");
}

function setSharedStatus(message, state) {
  sharedStatus.textContent = message;
  sharedStatus.classList.toggle("success", state === "success");
  sharedStatus.classList.toggle("error", state === "error");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

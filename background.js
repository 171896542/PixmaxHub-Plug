"use strict";

const MESSAGE = {
  EAGLE_IMPORT_URL: "pixmax-cloner:eagle-import-url",
  EAGLE_LIST_FOLDERS: "pixmax-cloner:eagle-list-folders",
  OPEN_REVIEW_BOARD: "pixmax-cloner:open-review-board"
};

const DEFAULT_OPTIONS = {
  eagleApiUrl: "http://localhost:41595",
  eagleFolderId: "",
  eagleFolderName: ""
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MESSAGE.EAGLE_LIST_FOLDERS) {
    listEagleFolders()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === MESSAGE.EAGLE_IMPORT_URL) {
    importUrlToEagle(message.item)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === MESSAGE.OPEN_REVIEW_BOARD) {
    openReviewBoard()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  return false;
});

async function openReviewBoard() {
  const tab = await chrome.tabs.create({
    active: true,
    url: chrome.runtime.getURL("likes.html")
  });
  return { tabId: tab?.id };
}

async function listEagleFolders() {
  const options = await getStoredOptions();
  let result;

  try {
    result = await eagleFetch(
      options.eagleApiUrl,
      "/api/v2/folder/get?limit=1000",
      null,
      "GET"
    );
  } catch (_error) {
    result = await eagleFetch(options.eagleApiUrl, "/api/folder/list", null, "GET");
  }

  return {
    folders: flattenEagleFolders(extractEagleArrayData(result))
  };
}

async function importUrlToEagle(item) {
  const options = await getStoredOptions();
  if (!options.eagleFolderId) {
    throw new Error("请先点击扩展图标，设置 Eagle 目标目录。");
  }

  const url = normalizeAssetUrl(item?.url);
  if (!url) {
    throw new Error("当前节点没有可导入 Eagle 的素材链接。");
  }

  const name = buildEagleItemName(item, url);
  const website = /^https?:\/\//i.test(item?.website || "")
    ? item.website
    : "https://app.pixmax.cn/";
  const result = await eagleFetch(options.eagleApiUrl, "/api/item/addFromURL", {
    annotation: String(item?.annotation || "").trim(),
    folderId: options.eagleFolderId,
    headers: {
      referer: "https://app.pixmax.cn/"
    },
    name,
    url,
    website
  });

  return {
    folderName: options.eagleFolderName || options.eagleFolderId,
    name,
    result
  };
}

async function eagleFetch(apiUrl, path, body, method = "POST") {
  const response = await fetch(`${normalizeEagleApiUrl(apiUrl)}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    method
  });

  if (!response.ok) {
    throw new Error(`Eagle API 请求失败：HTTP ${response.status}`);
  }

  const result = await response.json();
  if (result && result.status && result.status !== "success") {
    throw new Error(result.message || "Eagle API 返回失败。");
  }

  return result;
}

function normalizeEagleApiUrl(value) {
  const url = String(value || DEFAULT_OPTIONS.eagleApiUrl).trim().replace(/\/+$/, "");
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
    throw new Error("Eagle API 地址只能是本机 localhost，例如 http://localhost:41595。");
  }
  return url;
}

function normalizeAssetUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function extractEagleArrayData(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  return [];
}

function flattenEagleFolders(folders, prefix = "") {
  const output = [];

  for (const folder of folders) {
    const name = prefix ? `${prefix} / ${folder.name}` : folder.name;
    output.push({
      id: folder.id,
      name
    });

    if (Array.isArray(folder.children) && folder.children.length) {
      output.push(...flattenEagleFolders(folder.children, name));
    }
  }

  return output;
}

function filenameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function buildEagleItemName(item, url) {
  const baseName = sanitizeFilename(item?.name || filenameFromUrl(url) || "pixmax-asset");
  if (!isVideoAsset(item, url)) return baseName;
  return appendTimestampToName(baseName);
}

function isVideoAsset(item, url) {
  const haystack = [
    item?.mediaType,
    item?.type,
    item?.mimeType,
    item?.mime,
    item?.contentType,
    item?.name,
    filenameFromUrl(url),
    url
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /(^|\b)video(\b|\/)|视频|\.mp4(\?|#|$)|\.webm(\?|#|$)|\.mov(\?|#|$)|\.m4v(\?|#|$)|\.avi(\?|#|$)|\.mkv(\?|#|$)/i.test(haystack);
}

function appendTimestampToName(name) {
  const timestamp = formatTimestamp(new Date());
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < name.length - 1) {
    return `${name.slice(0, dotIndex)} ${timestamp}${name.slice(dotIndex)}`;
  }
  return `${name} ${timestamp}`;
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function sanitizeFilename(value) {
  return String(value || "pixmax-asset")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim()
    .slice(0, 180) || "pixmax-asset";
}

function getStoredOptions() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_OPTIONS, resolve);
  });
}

function friendlyError(error) {
  if (/Failed to fetch|NetworkError|fetch/i.test(error?.message || "")) {
    return "无法连接 Eagle。请先打开 Eagle App。";
  }
  return error?.message || String(error);
}

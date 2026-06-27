"use strict";

const LIKES_STORAGE_KEY = "pixmaxLikedItems";
const REVIEW_VIDEO_SOUND_KEY = "pixmaxReviewVideoSoundEnabled";
const WATCHED_VIDEO_STORAGE_KEY = "pixmaxWatchedVideoKeys";
const KNOWN_VIDEO_STORAGE_KEY = "pixmaxKnownVideoKeys";
const UNREAD_VIDEO_STORAGE_KEY = "pixmaxUnreadVideoKeys";
const WATCHED_VIDEO_BASELINE_KEY = "pixmaxWatchedVideoBaselineAt";
const WATCHED_VIDEO_REVIEW_BASELINE_KEY = "pixmaxWatchedVideoReviewBaselineAt";
const KNOWN_VIDEO_REVIEW_MODEL_KEY = "pixmaxKnownVideoReviewModelAt";
const FOCUS_PARAM = "pixmaxClonerFocus";
const API_ORIGIN = "https://app.pixmax.cn";
const SHARED_LIKES_MARKER = "PIXMAX_CANVAS_CLONER_LIKES_V1";
const LIKE_INDEX_MARKER = "PIXMAX_CANVAS_CLONER_LIKE_INDEX_V1";
const LIKE_INDEX_NODE_LABEL = "Pixmax Likes Index";
const SOCIAL_DATA_MARKER = "PIXMAX_LIKES_SOCIAL_V1";
const SOCIAL_DATA_NODE_LABEL = "Pixmax Likes Review Data";
const CANVAS_REVISION_CONFLICT = "Canvas.Revision.Conflict";
const PAGE_SIZE = 60;
const REVIEW_STATUSES = {
  maybe: "Maybe",
  pick: "Pick",
  reject: "Reject"
};
const MESSAGE = {
  EAGLE_IMPORT_URL: "pixmax-cloner:eagle-import-url"
};
const DEFAULT_LIKE_COLOR = "#ff3864";
const SHARED_OPTIONS_DEFAULTS = {
  sharedLikesEnabled: false,
  sharedLikesFileUuid: "",
  sharedLikesOwnerName: "",
  sharedLikesColor: DEFAULT_LIKE_COLOR
};

const grid = document.querySelector("#likesGrid");
const count = document.querySelector("#count");
const ownerFilters = document.querySelector("#ownerFilters");
const reviewStats = document.querySelector("#reviewStats");
const searchLikesInput = document.querySelector("#searchLikes");
const statusFilterButtons = [...document.querySelectorAll("[data-status-filter]")];
const refreshLikesButton = document.querySelector("#refreshLikes");
const togglePromptsButton = document.querySelector("#togglePrompts");
const multiSelectButton = document.querySelector("#multiSelect");
const batchEagleButton = document.querySelector("#batchEagle");
const exportHtmlButton = document.querySelector("#exportHtml");
const exportJsonButton = document.querySelector("#exportJson");
const clearButton = document.querySelector("#clearLikes");
const template = document.querySelector("#likeTemplate");
let currentItems = [];
let allSharedItems = [];
let activeOwnerFilter = "";
let renderedCount = 0;
let sharedMode = false;
let sharedOptions = null;
let selectedLikeKeys = new Set();
let promptsVisible = false;
let multiSelectMode = false;
let activeSearchQuery = "";
let activeStatusFilter = "all";
let activeSourceItems = [];
let activeRenderOptions = {};
let reviewVideoSoundEnabled = true;
let expandedMediaPreview = null;
let watchedVideoKeys = new Set();
let knownVideoKeys = new Set();
let unreadVideoKeys = new Set();

init();

function init() {
  document.body.classList.add("prompts-hidden");
  chrome.storage.local.get({ [REVIEW_VIDEO_SOUND_KEY]: true }, (result) => {
    reviewVideoSoundEnabled = result[REVIEW_VIDEO_SOUND_KEY] !== false;
    syncReviewVideoSoundPreference();
  });
  refreshLikesButton?.addEventListener("click", refreshLikes);
  togglePromptsButton.addEventListener("click", togglePrompts);
  multiSelectButton.addEventListener("click", toggleMultiSelect);
  batchEagleButton.addEventListener("click", importSelectedLikesToEagle);
  exportHtmlButton.addEventListener("click", exportHtml);
  exportJsonButton.addEventListener("click", exportJson);
  clearButton.addEventListener("click", clearLikes);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expandedMediaPreview) collapseReviewMediaPreview();
  });
  searchLikesInput?.addEventListener("input", () => {
    activeSearchQuery = searchLikesInput.value.trim().toLowerCase();
    renderFilteredItems();
  });
  for (const button of statusFilterButtons) {
    button.addEventListener("click", () => {
      activeStatusFilter = button.dataset.statusFilter || "all";
      for (const item of statusFilterButtons) {
        item.setAttribute("aria-pressed", String(item === button));
      }
      renderFilteredItems();
    });
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[LIKES_STORAGE_KEY]) {
      if (sharedMode) return;
      setActiveItems(changes[LIKES_STORAGE_KEY].newValue || []);
    }
    if (
      areaName === "sync" &&
      (changes.sharedLikesEnabled ||
        changes.sharedLikesFileUuid ||
        changes.sharedLikesOwnerName ||
        changes.sharedLikesColor)
    ) {
      loadLikes();
    }
  });
  loadLikes();
}

function loadLikes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SHARED_OPTIONS_DEFAULTS, async (options) => {
      sharedOptions = getSharedOptions(options);
      sharedMode = sharedOptions.enabled;

      if (sharedMode) {
        try {
          const result = await getSharedLikedItems(sharedOptions);
          allSharedItems = result.allItems;
          await initializeSharedWatchedVideoBaseline(result);
          renderOwnerFilters(allSharedItems, sharedOptions.ownerName);
        } catch (error) {
          renderError(error.message || String(error));
        } finally {
          resolve();
        }
        return;
      }

      chrome.storage.local.get({ [LIKES_STORAGE_KEY]: [] }, async (result) => {
        allSharedItems = [];
        renderOwnerFilters([]);
        const items = Array.isArray(result[LIKES_STORAGE_KEY]) ? result[LIKES_STORAGE_KEY] : [];
        if (await enrichItemsWithOriginalAssetInfo(items)) {
          setLocalLikedItems(items).catch(() => {});
        }
        await initializeLocalWatchedVideoBaseline(items);
        setActiveItems(items);
        resolve();
      });
    });
  });
}

async function refreshLikes() {
  if (!refreshLikesButton) return;
  refreshLikesButton.disabled = true;
  refreshLikesButton.textContent = "刷新中...";
  try {
    await loadLikes();
    refreshLikesButton.textContent = "已刷新";
  } finally {
    window.setTimeout(() => {
      refreshLikesButton.textContent = "刷新收藏库";
      refreshLikesButton.disabled = false;
    }, 650);
  }
}

function renderOwnerFilters(items, preferredOwner = "") {
  ownerFilters.textContent = "";
  ownerFilters.classList.toggle("active", sharedMode);
  if (!sharedMode) return;

  const counts = new Map();
  const colors = new Map();
  for (const item of items) {
    const owner = item.likedBy || "Unknown";
    counts.set(owner, (counts.get(owner) || 0) + 1);
    if (!colors.has(owner)) colors.set(owner, normalizeColor(item.likedByColor));
  }

  const owners = [...counts.keys()].sort((first, second) => {
    if (first === preferredOwner) return -1;
    if (second === preferredOwner) return 1;
    return first.localeCompare(second);
  });

  if (!owners.length) {
    activeOwnerFilter = preferredOwner || "";
    setActiveItems([], {
      ownerName: activeOwnerFilter,
      shared: true
    });
    return;
  }

  const nextActiveOwner = owners.includes(activeOwnerFilter)
    ? activeOwnerFilter
    : owners.includes(preferredOwner)
      ? preferredOwner
      : owners[0];
  activeOwnerFilter = nextActiveOwner;

  for (const owner of owners) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${owner} (${counts.get(owner)})`;
    button.dataset.ownerColor = normalizeColor(colors.get(owner));
    button.style.setProperty("--owner-color", normalizeColor(colors.get(owner)));
    button.setAttribute("aria-pressed", owner === activeOwnerFilter ? "true" : "false");
    button.addEventListener("click", () => {
      activeOwnerFilter = owner;
      renderOwnerFilters(allSharedItems, preferredOwner);
    });
    ownerFilters.append(button);
  }

  setActiveItems(
    items.filter((item) => (item.likedBy || "Unknown") === activeOwnerFilter),
    {
      ownerName: activeOwnerFilter,
      shared: true,
      totalSharedCount: items.length
    }
  );
}

function setActiveItems(items, options = {}) {
  activeSourceItems = Array.isArray(items) ? items : [];
  activeRenderOptions = options;
  renderFilteredItems();
}

function renderFilteredItems() {
  render(filterItems(activeSourceItems), {
    ...activeRenderOptions,
    filteredCount: activeSourceItems.length
  });
}

function filterItems(items) {
  return items.filter((item) => matchesSearch(item) && matchesStatus(item));
}

function matchesSearch(item) {
  if (!activeSearchQuery) return true;
  const haystack = [
    item.name,
    item.annotation,
    item.url,
    item.website,
    item.likedBy,
    item.assetUuid,
    item.downloadCode,
    item.eagleCode,
    item.nodeId,
    getItemDownloadCode(item),
    ...(Array.isArray(item.reviewTags) ? item.reviewTags : []),
    ...(Array.isArray(item.socialComments) ? item.socialComments.map((comment) => comment.text) : [])
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(activeSearchQuery);
}

function matchesStatus(item) {
  if (activeStatusFilter === "all") return true;
  if (activeStatusFilter === "unreviewed") return !item.reviewStatus;
  return item.reviewStatus === activeStatusFilter;
}

function render(items, options = {}) {
  currentItems = items;
  selectedLikeKeys = new Set([...selectedLikeKeys].filter((key) => items.some((item) => getLikeKey(item) === key)));
  renderedCount = 0;
  grid.textContent = "";
  if (options.shared && options.ownerName) {
    const suffix = options.filteredCount && options.filteredCount !== items.length
      ? ` / ${options.filteredCount}`
      : "";
    count.textContent = `${options.ownerName}: ${items.length}${suffix} review items`;
  } else {
    const suffix = options.filteredCount && options.filteredCount !== items.length
      ? ` / ${options.filteredCount}`
      : "";
    count.textContent = `${items.length}${suffix} ${options.shared ? "shared" : "local"} likes`;
  }
  renderReviewStats(options.shared ? activeSourceItems : items);
  exportHtmlButton.disabled = items.length === 0;
  exportJsonButton.disabled = items.length === 0;
  clearButton.disabled = items.length === 0;
  clearButton.textContent = options.shared ? "Clear Mine" : "Clear All";
  updateSelectionActions();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = options.shared
      ? options.ownerName
        ? "No items match the current review filters."
        : "No shared likes yet. Configure a shared canvas, then click Like in Pixmax."
      : "No local likes yet. Select a Pixmax result and click Like in its toolbar.";    grid.append(empty);
    return;
  }

  appendNextItems();
}

function appendNextItems() {
  const previousLoadMore = grid.querySelector(".load-more");
  previousLoadMore?.remove();

  const nextItems = currentItems.slice(renderedCount, renderedCount + PAGE_SIZE);
  renderedCount += nextItems.length;

  for (const item of nextItems) {
    grid.append(renderItem(item));
  }

  if (renderedCount < currentItems.length) {
    const wrapper = document.createElement("div");
    wrapper.className = "load-more";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Load ${Math.min(PAGE_SIZE, currentItems.length - renderedCount)} more`;
    button.addEventListener("click", appendNextItems);
    wrapper.append(button);
    grid.append(wrapper);
  }
}

function renderReviewStats(items) {
  if (!reviewStats) return;
  reviewStats.textContent = "";
  reviewStats.classList.toggle("active", sharedMode || Boolean(items.length));
  if (!items.length) return;

  const stats = {
    all: items.length,
    pick: 0,
    maybe: 0,
    reject: 0,
    unreviewed: 0,
    comments: 0,
    likes: 0
  };

  for (const item of items) {
    if (item.reviewStatus && hasReviewStatus(item.reviewStatus)) {
      stats[item.reviewStatus] += 1;
    } else {
      stats.unreviewed += 1;
    }
    stats.comments += Array.isArray(item.socialComments) ? item.socialComments.length : 0;
    stats.likes += Array.isArray(item.socialLikes) ? item.socialLikes.length : 0;
  }

  const entries = [
    ["All", stats.all, "all"],
    ["Pick", stats.pick, "pick"],
    ["Maybe", stats.maybe, "maybe"],
    ["Reject", stats.reject, "reject"],
    ["Open", stats.unreviewed, "unreviewed"],
    ["Comments", stats.comments, "comments"],
    ["Likes", stats.likes, "likes"]
  ];
  for (const [label, value, key] of entries) {
    const item = document.createElement("div");
    item.className = "stat";
    item.dataset.stat = key;
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    reviewStats.append(item);
  }
}

function renderError(message) {
  currentItems = [];
  grid.textContent = "";
  count.textContent = "Shared Likes unavailable";
  exportHtmlButton.disabled = true;
  exportJsonButton.disabled = true;
  clearButton.disabled = true;
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = message;
  grid.append(empty);
}

function renderItem(item) {
  const card = template.content.firstElementChild.cloneNode(true);
  const select = card.querySelector(".select-like");
  const preview = card.querySelector(".preview");
  const ribbon = card.querySelector(".review-ribbon");
  const eagle = card.querySelector(".eagle");
  const title = card.querySelector("h2");
  const prompt = card.querySelector(".prompt");
  const meta = card.querySelector(".meta");
  const open = card.querySelector(".open");
  const copy = card.querySelector(".copy");
  const remove = card.querySelector(".remove");

  const mediaUrl = normalizeUrl(item.url);
  const pageUrl = normalizeUrl(item.website) || mediaUrl;
  const isVideo = isVideoUrl(mediaUrl);
  const isAudio = isAudioUrl(mediaUrl);
  const isExpandableMedia = Boolean(mediaUrl && !isAudio);
  const likeColor = normalizeColor(item.likedByColor);
  const likeKey = getLikeKey(item);
  const downloadCode = getItemDownloadCode(item);
  const videoWatchKey = getItemVideoWatchKey(item);

  card.dataset.likeKey = likeKey;
  card.dataset.likeColor = likeColor;
  if (videoWatchKey) {
    card.dataset.watchKey = videoWatchKey;
    card.classList.toggle("video-unwatched", unreadVideoKeys.has(videoWatchKey));
  }
  card.style.setProperty("--like-color", likeColor);
  select.checked = selectedLikeKeys.has(likeKey);
  card.addEventListener("click", (event) => {
    if (!multiSelectMode) return;
    if (event.target.closest("button, a, input, textarea, form, video, audio, .social")) return;
    event.preventDefault();
    select.checked = !select.checked;
    updateSelectedKey(likeKey, select.checked);
  });
  select.addEventListener("change", () => {
    updateSelectedKey(likeKey, select.checked);
  });
  if (isExpandableMedia) {
    preview.removeAttribute("href");
    preview.classList.add("media-preview");
    if (isVideo) preview.classList.add("video-preview");
    else preview.classList.add("image-preview");
    preview.setAttribute("role", "button");
    preview.tabIndex = 0;
    preview.title = isVideo ? "点击画面放大/缩小视频" : "点击图片放大/缩小";
    preview.addEventListener("click", (event) => {
      event.preventDefault();
      if (isLikelyVideoControlClick(event)) return;
      toggleReviewMediaPreview(preview);
    });
    preview.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleReviewMediaPreview(preview);
    });
  } else {
    preview.href = mediaUrl || pageUrl || "#";
  }
  preview.append(createPreview(item));
  title.textContent = item.name || filenameFromUrl(mediaUrl) || "Pixmax result";
  prompt.textContent = item.annotation || "No prompt captured.";
  prompt.title = item.annotation || "";
  meta.textContent = downloadCode
    ? `${formatLikedAt(item.likedAt, item.likedBy)} · ${downloadCode}`
    : formatLikedAt(item.likedAt, item.likedBy);
  if (downloadCode) meta.title = `Eagle 下载编码：${downloadCode}`;
  open.href = buildFocusUrl(pageUrl, item.nodeId) || mediaUrl || "#";
  renderReviewPanel(item, card, ribbon);
  if (eagle) {
    eagle.disabled = !mediaUrl;
    eagle.addEventListener("click", async () => {
      try {
        eagle.disabled = true;
        eagle.textContent = "Importing...";
        const response = await sendRuntimeMessage({
          type: MESSAGE.EAGLE_IMPORT_URL,
          item
        });
        if (!response?.ok) throw new Error(response?.error || "Eagle import failed.");
        eagle.textContent = "Saved";
      } catch (error) {
        eagle.textContent = error.message || "Import failed";
      } finally {
        window.setTimeout(() => {
          eagle.textContent = "存入 Eagle";
          eagle.disabled = !mediaUrl;
        }, 1500);
      }
    });
  }

  copy.addEventListener("click", async () => {
    if (!mediaUrl) return;
    await navigator.clipboard.writeText(mediaUrl);
    copy.textContent = "Copied";
    window.setTimeout(() => {
      copy.textContent = "Copy URL";
    }, 1200);
  });

  if (sharedMode && item.likedBy && item.likedBy !== sharedOptions.ownerName) {
    remove.disabled = true;
    remove.title = "Only the owner can remove this shared like.";
  } else {
    remove.addEventListener("click", () => removeLike(item));
  }

  renderSocial(item, card);
  return card;
}

function renderReviewPanel(item, card, ribbon) {
  const panel = card.querySelector(".review-panel");
  if (!panel) return;
  panel.hidden = false;

  const status = item.reviewStatus || "";
  const label = REVIEW_STATUSES[status] || "Open";
  card.dataset.reviewStatus = status || "unreviewed";
  if (ribbon) {
    ribbon.hidden = false;
    ribbon.textContent = label;
    ribbon.dataset.reviewStatus = status || "unreviewed";
  }

  for (const button of panel.querySelectorAll("[data-review-status]")) {
    const nextStatus = button.dataset.reviewStatus;
    button.setAttribute("aria-pressed", String(nextStatus === status));
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await setReviewStatus(item, nextStatus === status ? "" : nextStatus);
        loadLikes();
      } catch (error) {
        button.textContent = error.message || "Failed";
        window.setTimeout(loadLikes, 1200);
      }
    });
  }

  renderTagChips(item, panel.querySelector(".review-tags"));

  const form = panel.querySelector(".tag-form");
  const input = panel.querySelector(".tag-input");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tags = parseTags(input.value);
    if (!tags.length) return;
    const submit = form.querySelector(".tag-submit");
    submit.disabled = true;
    try {
      await addReviewTags(item, tags);
      input.value = "";
      loadLikes();
    } catch (error) {
      input.value = error.message || input.value;
      window.setTimeout(() => {
        input.value = tags.join(", ");
      }, 1200);
    } finally {
      submit.disabled = false;
    }
  });
}

function renderTagChips(item, wrapper) {
  if (!wrapper) return;
  wrapper.textContent = "";
  const tags = Array.isArray(item.reviewTags) ? item.reviewTags : [];
  if (!tags.length) {
    const empty = document.createElement("span");
    empty.className = "tag-empty";
    empty.textContent = "No tags";
    wrapper.append(empty);
    return;
  }

  for (const tag of tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    button.textContent = `#${tag}`;
    button.title = "Remove this tag from your review";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await removeReviewTag(item, tag);
        loadLikes();
      } catch (error) {
        button.textContent = error.message || "Remove failed";
        window.setTimeout(loadLikes, 1200);
      }
    });
    wrapper.append(button);
  }
}
function renderSocial(item, card) {
  const social = card.querySelector(".social");
  if (!social) return;
  social.hidden = !sharedMode;
  if (!sharedMode) return;

  const likeButton = social.querySelector(".social-like");
  const commentToggle = social.querySelector(".comment-toggle");
  const likers = social.querySelector(".social-likers");
  const comments = social.querySelector(".comments");
  const form = social.querySelector(".comment-form");
  const input = social.querySelector(".comment-input");
  const myAvatar = social.querySelector(".my-avatar");
  const socialLikes = Array.isArray(item.socialLikes) ? item.socialLikes : [];
  const socialComments = Array.isArray(item.socialComments) ? item.socialComments : [];
  const ownColor = normalizeColor(sharedOptions?.color);

  myAvatar.textContent = avatarInitial(sharedOptions.ownerName);
  myAvatar.style.setProperty("--avatar-color", ownColor);
  setSocialLikeButtonState(likeButton, item.socialLikedByMe, socialLikes.length);

  likers.textContent = "";
  if (socialLikes.length) likers.append(createLikeSummary(socialLikes));

  comments.textContent = "";
  for (const comment of socialComments.slice(-8)) {
    comments.append(createCommentRow(comment));
  }

  likeButton.addEventListener("click", async () => {
    likeButton.disabled = true;
    setSocialLikeButtonState(likeButton, item.socialLikedByMe, socialLikes.length, item.socialLikedByMe ? "Removing..." : "Liking...");
    try {
      await toggleSocialLike(item);
      loadLikes();
    } catch (error) {
      likeButton.textContent = error.message || "Action failed";
      window.setTimeout(loadLikes, 1200);
    }
  });

  commentToggle.addEventListener("click", () => {
    const nextHidden = !form.hidden;
    form.hidden = nextHidden;
    commentToggle.classList.toggle("active", !nextHidden);
    commentToggle.textContent = nextHidden ? "评论" : "收起评论";
    if (!nextHidden) input.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const submit = form.querySelector(".comment-submit");
    submit.disabled = true;
    try {
      await addSocialComment(item, text);
      input.value = "";
      loadLikes();
    } catch (error) {
      input.value = error.message || "Comment failed";
      window.setTimeout(() => {
        input.value = text;
      }, 1200);
    } finally {
      submit.disabled = false;
    }
  });
}

function thumbIconSvg() {
  return `<svg class="thumb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 21H4.8a1.8 1.8 0 0 1-1.8-1.8v-7.4A1.8 1.8 0 0 1 4.8 10h2.7m0 11V9.4c1.8-1.4 3-3.5 3.2-5.8.1-1 .9-1.6 1.8-1.4 1.2.2 2 1.1 2 2.4V9h3.4c1.5 0 2.6 1.4 2.2 2.9l-1.4 5.6A4.5 4.5 0 0 1 14.4 21H7.5Z"/></svg>`;
}

function setSocialLikeButtonState(button, liked, count, overrideText = "") {
  button.classList.toggle("active", Boolean(liked));
  const label = overrideText || (liked ? "Liked" : "Like");
  button.innerHTML = `${thumbIconSvg()}<span>${label}${count ? ` ${count}` : ""}</span>`;
}

function createLikeSummary(likes) {
  const summary = document.createElement("div");
  summary.className = "like-summary";
  const icon = document.createElement("span");
  icon.className = "like-summary-icon";
  icon.innerHTML = thumbIconSvg();
  const text = document.createElement("span");
  const names = likes.slice(0, 5).map((like) => like.userName || "Unknown");
  text.textContent = `${names.join(", ")}${likes.length > 5 ? ` and ${likes.length - 5} more` : ""} liked this`;
  summary.append(icon, text);
  return summary;
}

function createPersonChip(name, color) {
  const chip = document.createElement("span");
  chip.className = "person-chip";
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = avatarInitial(name);
  avatar.style.setProperty("--avatar-color", normalizeColor(color));
  const label = document.createElement("span");
  label.textContent = name || "Unknown";
  chip.append(avatar, label);
  return chip;
}

function createCommentRow(comment) {
  const row = document.createElement("div");
  row.className = "comment";
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = avatarInitial(comment.userName);
  avatar.style.setProperty("--avatar-color", normalizeColor(comment.color));
  const body = document.createElement("div");
  body.className = "comment-body";
  const meta = document.createElement("div");
  meta.className = "comment-meta";
  const name = document.createElement("strong");
  name.textContent = comment.userName || "Unknown";
  const time = document.createElement("span");
  time.textContent = compactTime(comment.createdAt);
  const text = document.createElement("p");
  text.textContent = comment.text || "";
  meta.append(name, time);
  body.append(meta, text);
  row.append(avatar, body);
  return row;
}

function avatarInitial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function togglePrompts() {
  promptsVisible = !promptsVisible;
  document.body.classList.toggle("prompts-hidden", !promptsVisible);
  togglePromptsButton.textContent = promptsVisible ? "隐藏提示词" : "显示提示词";
}

function toggleMultiSelect() {
  multiSelectMode = !multiSelectMode;
  document.body.classList.toggle("multi-select", multiSelectMode);
  multiSelectButton.textContent = multiSelectMode ? "完成多选" : "多选存入 Eagle";
  if (!multiSelectMode) {
    selectedLikeKeys.clear();
    syncRenderedSelection();
  }
  updateSelectionActions();
}

function updateSelectedKey(likeKey, selected) {
  if (!likeKey) return;
  if (selected) selectedLikeKeys.add(likeKey);
  else selectedLikeKeys.delete(likeKey);
  updateSelectionActions();
}

function syncRenderedSelection() {
  for (const checkbox of grid.querySelectorAll(".select-like")) {
    const card = checkbox.closest(".card");
    checkbox.checked = selectedLikeKeys.has(card?.dataset.likeKey || "");
  }
}

function updateSelectionActions() {
  const selectedCount = currentItems.filter((item) => selectedLikeKeys.has(getLikeKey(item))).length;
  batchEagleButton.disabled = !multiSelectMode || selectedCount === 0;
  batchEagleButton.textContent = selectedCount ? `批量存入 Eagle (${selectedCount})` : "批量存入 Eagle";
}

async function importSelectedLikesToEagle() {
  const items = currentItems.filter((item) => selectedLikeKeys.has(getLikeKey(item)));
  if (!items.length) return;

  batchEagleButton.disabled = true;
  try {
    let importedCount = 0;
    for (const item of items) {
      batchEagleButton.textContent = `导入中 ${importedCount + 1}/${items.length}`;
      const response = await sendRuntimeMessage({
        type: MESSAGE.EAGLE_IMPORT_URL,
        item
      });
      if (!response?.ok) throw new Error(response?.error || "Eagle 导入失败。");
      importedCount += 1;
    }
    batchEagleButton.textContent = `已存入 ${importedCount} 个`;
    selectedLikeKeys.clear();
    syncRenderedSelection();
    window.setTimeout(updateSelectionActions, 1400);
  } catch (error) {
    batchEagleButton.textContent = error.message || "导入失败";
    window.setTimeout(updateSelectionActions, 1800);
  } finally {
    batchEagleButton.disabled = false;
  }
}
function createPreview(item) {
  const url = normalizeUrl(item?.url);
  if (!url) return document.createTextNode("No preview");

  if (isVideoUrl(url)) {
    const video = document.createElement("video");
    const poster = normalizeUrl(item.poster || item.thumbnailUrl || item.previewUrl);
    video.src = url;
    video.controls = true;
    video.muted = !reviewVideoSoundEnabled;
    video.playsInline = true;
    video.preload = "metadata";
    video.dataset.reviewVideo = "true";
    video.dataset.watchKey = getItemVideoWatchKey(item);
    video.addEventListener("play", () => {
      markItemVideoWatched(item).catch(() => {});
    });
    video.addEventListener("volumechange", () => {
      const enabled = !video.muted && video.volume > 0;
      if (enabled === reviewVideoSoundEnabled) return;
      setReviewVideoSoundPreference(enabled);
    });
    if (poster) video.poster = poster;
    return video;
  }

  if (isAudioUrl(url)) {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.controls = true;
    audio.preload = "metadata";
    return audio;
  }

  const image = document.createElement("img");
  image.src = url;
  image.loading = "lazy";
  image.alt = "";
  image.addEventListener("error", () => {
    image.replaceWith(document.createTextNode("Preview unavailable"));
  });
  return image;
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(String(url || ""));
}

function isVideoItem(item) {
  return item?.mediaType === "video" || isVideoUrl(normalizeUrl(item?.url));
}

function extractVideoWatchKeyFromUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  const resMatch = url.match(/RES-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (resMatch) return `res:${resMatch[0].toLowerCase()}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return `url:${parsed.href}`;
  } catch {
    return `url:${url.split(/[?#]/, 1)[0]}`;
  }
}

function getItemVideoWatchKey(item) {
  if (!isVideoItem(item)) return "";
  return (
    extractVideoWatchKeyFromUrl(item.url) ||
    extractVideoWatchKeyFromUrl(item.previewUrl) ||
    extractVideoWatchKeyFromUrl(item.poster) ||
    (getItemDownloadCode(item) ? `code:${getItemDownloadCode(item)}` : "") ||
    (item.assetUuid ? `asset:${String(item.assetUuid).toLowerCase()}` : "") ||
    (item.nodeId ? `node:${String(item.nodeId).toLowerCase()}` : "")
  );
}

function getWatchedVideoKeys(settings = {}) {
  const keys = Array.isArray(settings?.watchedVideoKeys) ? settings.watchedVideoKeys : [];
  return [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
}

function getKnownVideoKeys(settings = {}) {
  const keys = Array.isArray(settings?.knownVideoKeys) ? settings.knownVideoKeys : [];
  return [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
}

function getUnreadVideoKeys(settings = {}) {
  const keys = Array.isArray(settings?.unreadVideoKeys) ? settings.unreadVideoKeys : [];
  return [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
}

function hasReviewWatchedVideoBaseline(settings = {}) {
  return Boolean(settings?.knownVideoReviewModelAt);
}

function getItemVideoWatchKeys(items) {
  return [
    ...new Set(
      (items || [])
        .map(getItemVideoWatchKey)
        .filter(Boolean)
    )
  ];
}

async function initializeSharedWatchedVideoBaseline(result) {
  const settings = result.currentOwnerSettings || {};
  const watchedKeys = new Set(getWatchedVideoKeys(settings));
  const knownKeys = new Set(getKnownVideoKeys(settings));
  const unreadKeys = new Set(getUnreadVideoKeys(settings).filter((key) => !watchedKeys.has(key)));
  let changed = unreadKeys.size !== getUnreadVideoKeys(settings).length;
  if (!hasReviewWatchedVideoBaseline(settings)) {
    unreadKeys.clear();
    for (const key of getItemVideoWatchKeys(result.allItems)) knownKeys.add(key);
    watchedVideoKeys = watchedKeys;
    knownVideoKeys = knownKeys;
    unreadVideoKeys = unreadKeys;
    const now = new Date().toISOString();
    await persistSharedVideoState({
      ...settings,
      knownVideoKeys: [...knownKeys],
      knownVideoReviewModelAt: now,
      unreadVideoKeys: [...unreadKeys],
      watchedVideoBaselineAt: settings.watchedVideoBaselineAt || now,
      watchedVideoReviewBaselineAt: now
    }).catch(() => {});
    return;
  }
  for (const key of getItemVideoWatchKeys(result.allItems)) {
    if (knownKeys.has(key)) continue;
    knownKeys.add(key);
    if (!watchedKeys.has(key)) unreadKeys.add(key);
    changed = true;
  }
  watchedVideoKeys = watchedKeys;
  knownVideoKeys = knownKeys;
  unreadVideoKeys = unreadKeys;
  if (changed) {
    persistSharedVideoState({
      ...settings,
      knownVideoKeys: [...knownKeys],
      knownVideoReviewModelAt: settings.knownVideoReviewModelAt || new Date().toISOString(),
      unreadVideoKeys: [...unreadKeys],
      watchedVideoKeys: [...watchedKeys]
    }).catch(() => {});
  }
}

async function initializeLocalWatchedVideoBaseline(items) {
  const { knownKeys, reviewModelAt, unreadKeys, watchedKeys } = await getLocalWatchedVideoState();
  const nextKnownKeys = new Set(knownKeys);
  const nextUnreadKeys = new Set(unreadKeys.filter((key) => !watchedKeys.includes(key)));
  let changed = nextUnreadKeys.size !== unreadKeys.length;
  if (!reviewModelAt) {
    nextUnreadKeys.clear();
    for (const key of getItemVideoWatchKeys(items)) nextKnownKeys.add(key);
    watchedVideoKeys = new Set(watchedKeys);
    knownVideoKeys = nextKnownKeys;
    unreadVideoKeys = nextUnreadKeys;
    const now = new Date().toISOString();
    await setLocalWatchedVideoState({
      knownKeys: [...nextKnownKeys],
      reviewModelAt: now,
      reviewBaselineAt: now,
      baselineAt: now,
      unreadKeys: [...nextUnreadKeys],
      watchedKeys
    }).catch(() => {});
    return;
  }
  for (const key of getItemVideoWatchKeys(items)) {
    if (nextKnownKeys.has(key)) continue;
    nextKnownKeys.add(key);
    if (!watchedKeys.includes(key)) nextUnreadKeys.add(key);
    changed = true;
  }
  watchedVideoKeys = new Set(watchedKeys);
  knownVideoKeys = nextKnownKeys;
  unreadVideoKeys = nextUnreadKeys;
  if (changed) {
    setLocalWatchedVideoState({
      knownKeys: [...nextKnownKeys],
      reviewModelAt,
      reviewBaselineAt: reviewModelAt,
      unreadKeys: [...nextUnreadKeys],
      watchedKeys
    }).catch(() => {});
  }
}

async function markItemVideoWatched(item) {
  const watchKey = getItemVideoWatchKey(item);
  if (!watchKey) return;
  if (watchedVideoKeys.has(watchKey) && !unreadVideoKeys.has(watchKey)) return;
  watchedVideoKeys.add(watchKey);
  knownVideoKeys.add(watchKey);
  unreadVideoKeys.delete(watchKey);
  syncRenderedVideoWatchState(watchKey);
  if (sharedMode && sharedOptions?.enabled) {
    await persistSharedVideoState({
      knownVideoKeys: [...knownVideoKeys],
      unreadVideoKeys: [...unreadVideoKeys],
      watchedVideoKeys: [...watchedVideoKeys]
    });
  } else {
    const state = await getLocalWatchedVideoState();
    const now = new Date().toISOString();
    await setLocalWatchedVideoState({
      ...state,
      baselineAt: state.baselineAt || now,
      knownKeys: [...knownVideoKeys],
      reviewModelAt: state.reviewModelAt || now,
      reviewBaselineAt: state.reviewBaselineAt || now,
      unreadKeys: [...unreadVideoKeys],
      watchedKeys: [...watchedVideoKeys]
    });
  }
}

function syncRenderedVideoWatchState(changedKey = "") {
  for (const card of grid.querySelectorAll(".card[data-watch-key]")) {
    const watchKey = card.dataset.watchKey || "";
    if (changedKey && watchKey !== changedKey) continue;
    card.classList.toggle("video-unwatched", Boolean(watchKey && unreadVideoKeys.has(watchKey)));
  }
}

function isAudioUrl(url) {
  return /\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/i.test(String(url || ""));
}

function isLikelyVideoControlClick(event) {
  const video = event.currentTarget?.querySelector?.("video");
  if (!video) return false;
  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const controlHeight = Math.min(56, Math.max(38, rect.height * 0.18));
  return event.clientY >= rect.bottom - controlHeight;
}

function toggleReviewMediaPreview(preview) {
  if (!preview?.classList?.contains("media-preview")) return;
  if (expandedMediaPreview === preview) {
    collapseReviewMediaPreview();
    return;
  }
  expandReviewMediaPreview(preview);
}

function expandReviewMediaPreview(preview) {
  if (expandedMediaPreview && expandedMediaPreview !== preview) {
    collapseReviewMediaPreview();
  }
  expandedMediaPreview = preview;
  document.body.classList.add("media-expanded");
  preview.classList.add("expanded");
  preview.setAttribute("aria-expanded", "true");
  const video = preview.querySelector("video");
  if (video) applyReviewVideoSoundPreference(video);
}

function collapseReviewMediaPreview() {
  if (!expandedMediaPreview) return;
  expandedMediaPreview.classList.remove("expanded");
  expandedMediaPreview.setAttribute("aria-expanded", "false");
  expandedMediaPreview = null;
  document.body.classList.remove("media-expanded");
}

function setReviewVideoSoundPreference(enabled) {
  reviewVideoSoundEnabled = Boolean(enabled);
  chrome.storage.local.set({ [REVIEW_VIDEO_SOUND_KEY]: reviewVideoSoundEnabled }, () => {});
  syncReviewVideoSoundPreference();
}

function syncReviewVideoSoundPreference() {
  for (const video of document.querySelectorAll("video[data-review-video='true']")) {
    applyReviewVideoSoundPreference(video);
  }
}

function applyReviewVideoSoundPreference(video) {
  if (!video) return;
  video.muted = !reviewVideoSoundEnabled;
  if (reviewVideoSoundEnabled && video.volume === 0) video.volume = 1;
}

function getLikeKey(item) {
  return item?.nodeId || item?.url || "";
}

function removeLike(item) {
  if (sharedMode) {
    removeSharedLike(item).then(loadLikes, (error) => renderError(error.message || String(error)));
    return;
  }

  chrome.storage.local.get({ [LIKES_STORAGE_KEY]: [] }, (result) => {
    const targetKey = getLikeKey(item);
    const items = (Array.isArray(result[LIKES_STORAGE_KEY]) ? result[LIKES_STORAGE_KEY] : [])
      .filter((likedItem) => getLikeKey(likedItem) !== targetKey);
    chrome.storage.local.set({ [LIKES_STORAGE_KEY]: items });
  });
}

function clearLikes() {
  if (sharedMode) {
    if (!confirm("Clear your shared Pixmax Likes? Other users will not be changed.")) return;
    clearSharedLikes().then(loadLikes, (error) => renderError(error.message || String(error)));
    return;
  }

  if (!confirm("Clear all Pixmax Likes?")) return;
  chrome.storage.local.set({ [LIKES_STORAGE_KEY]: [] });
}

function exportHtml() {
  downloadBlob(
    `pixmax-likes-${dateSlug()}.html`,
    "text/html;charset=utf-8",
    buildExportHtml(currentItems)
  );
}

function exportJson() {
  downloadBlob(
    `pixmax-likes-${dateSlug()}.json`,
    "application/json;charset=utf-8",
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        source: "PixmaxHub Plug",
        items: currentItems
      },
      null,
      2
    )
  );
}

function downloadBlob(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExportHtml(items) {
  const cards = items.map(renderExportCard).join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pixmax Likes Export</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #151618; color: #f3f4f6; }
    header { padding: 24px; border-bottom: 1px solid #30343a; background: #1e2024; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 22px; }
    .sub { margin-top: 6px; color: #a9adb5; font-size: 13px; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 20px 24px 28px; }
    article { overflow: hidden; border: 1px solid #30343a; border-radius: 8px; background: #1e2024; }
    .preview { display: grid; min-height: 210px; aspect-ratio: 4 / 3; place-items: center; background: #0f1012; color: #858b95; text-decoration: none; }
    img, video { width: 100%; height: 100%; object-fit: cover; }
    audio { width: calc(100% - 24px); }
    .body { display: grid; gap: 9px; padding: 12px; }
    h2 { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .prompt { max-height: 190px; overflow: auto; white-space: pre-wrap; word-break: break-word; color: #a9adb5; font-size: 12px; line-height: 1.5; }
    .meta { color: #858b95; font-size: 12px; line-height: 1.5; }
    .open { color: #f3f4f6; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>Pixmax Likes Export</h1>
    <p class="sub">${items.length} liked result${items.length === 1 ? "" : "s"} 路 Exported ${escapeHtml(new Date().toLocaleString())}</p>
  </header>
  <main>
${cards || "    <p>No liked results.</p>"}
  </main>
</body>
</html>`;
}

function renderExportCard(item) {
  const mediaUrl = normalizeUrl(item.url);
  const pageUrl = normalizeUrl(item.website);
  const title = item.name || filenameFromUrl(mediaUrl) || "Pixmax result";
  const preview = renderExportPreview(mediaUrl);
  const prompt = item.annotation || "No prompt captured.";
  const meta = formatLikedAt(item.likedAt, item.likedBy);
  const openLink = pageUrl
    ? `<a class="open" href="${escapeAttribute(buildFocusUrl(pageUrl, item.nodeId))}" target="_blank" rel="noreferrer">Open original</a>`
    : "";

  return `    <article>
      <a class="preview" href="${escapeAttribute(mediaUrl || pageUrl || "#")}" target="_blank" rel="noreferrer">${preview}</a>
      <div class="body">
        <h2 title="${escapeAttribute(title)}">${escapeHtml(title)}</h2>
        <p class="prompt">${escapeHtml(prompt)}</p>
        <p class="meta">${escapeHtml(meta)}</p>
        ${openLink}
      </div>
    </article>`;
}

function renderExportPreview(url) {
  if (!url) return "No preview";
  const escapedUrl = escapeAttribute(url);
  if (/\.(mp4|webm|mov)(\?|#|$)/i.test(url)) {
    return `<video src="${escapedUrl}" controls muted preload="metadata"></video>`;
  }
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/i.test(url)) {
    return `<audio src="${escapedUrl}" controls preload="metadata"></audio>`;
  }
  return `<img src="${escapedUrl}" alt="">`;
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function buildFocusUrl(value, nodeId) {
  const url = normalizeUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (nodeId) parsed.searchParams.set(FOCUS_PARAM, nodeId);
    return parsed.href;
  } catch {
    return url;
  }
}

function filenameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function dateSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function formatLikedAt(value, likedBy = "") {
  const suffix = likedBy ? ` by ${likedBy}` : "";
  if (!value) return `Saved${suffix || " locally"}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `Saved${suffix || " locally"}`;
  return `Liked ${date.toLocaleString()}${suffix}`;
}

function compactTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const delta = Date.now() - date.getTime();
  if (delta >= 0 && delta < 60_000) return "now";
  if (delta >= 0 && delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta >= 0 && delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return date.toLocaleDateString();
}

function getSharedOptions(options) {
  const fileUuid = String(options.sharedLikesFileUuid || "").trim();
  const ownerName = String(options.sharedLikesOwnerName || "").trim();
  return {
    color: normalizeColor(options.sharedLikesColor),
    enabled: Boolean(options.sharedLikesEnabled && fileUuid && ownerName),
    fileUuid,
    ownerName
  };
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
    throw new Error(result.errMessage || result.errCode || `Pixmax API failed: ${path}`);
  }
  return result;
}

async function fetchSharedCanvas() {
  const result = await apiPost("/canvas/get", { fileUuid: sharedOptions.fileUuid });
  if (!result.success) throw new Error(result.errMessage || result.errCode || "Could not read shared canvas.");
  return result.data;
}

async function fetchCanvas(fileUuid) {
  const result = await apiPost("/canvas/get", { fileUuid });
  if (!result.success) throw new Error(result.errMessage || result.errCode || "Could not read canvas.");
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

function parseSocialDataText(value) {
  const text = String(value || "");
  const markerIndex = text.indexOf(SOCIAL_DATA_MARKER);
  if (markerIndex < 0) return null;
  const jsonStart = text.indexOf("{", markerIndex + SOCIAL_DATA_MARKER.length);
  if (jsonStart < 0) return null;

  try {
    const data = JSON.parse(text.slice(jsonStart).trim());
    if (!data || data.version !== 1) return null;
    return normalizeSocialData(data);
  } catch {
    return null;
  }
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

function normalizeSocialData(data = {}) {
  return {
    comments: Array.isArray(data.comments)
      ? data.comments
          .filter((comment) => comment && typeof comment === "object")
          .map((comment) => ({
            id: String(comment.id || crypto.randomUUID()),
            targetKey: String(comment.targetKey || ""),
            targetOwner: String(comment.targetOwner || ""),
            userName: String(comment.userName || "").trim(),
            color: normalizeColor(comment.color),
            text: String(comment.text || "").trim().slice(0, 500),
            createdAt: String(comment.createdAt || "")
          }))
          .filter((comment) => comment.targetKey && comment.userName && comment.text)
      : [],
    likes: Array.isArray(data.likes)
      ? data.likes
          .filter((like) => like && typeof like === "object")
          .map((like) => ({
            targetKey: String(like.targetKey || ""),
            targetOwner: String(like.targetOwner || ""),
            userName: String(like.userName || "").trim(),
            color: normalizeColor(like.color),
            createdAt: String(like.createdAt || "")
          }))
          .filter((like) => like.targetKey && like.userName)
      : [],
    reviews: Array.isArray(data.reviews)
      ? data.reviews
          .filter((review) => review && typeof review === "object")
          .map((review) => ({
            targetKey: String(review.targetKey || ""),
            targetOwner: String(review.targetOwner || ""),
            userName: String(review.userName || "").trim(),
            color: normalizeColor(review.color),
            status: hasReviewStatus(review.status) ? review.status : "",
            tags: parseTags(Array.isArray(review.tags) ? review.tags.join(",") : review.tags),
            updatedAt: String(review.updatedAt || "")
          }))
          .filter((review) => review.targetKey && review.userName)
      : []
  };
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

function compactId(value, length = 12) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").slice(0, length);
}

function getAssetUuidFromNode(rawNode) {
  return String(
    rawNode?.defaultAsset?.assetsUuid ||
      rawNode?.defaultAsset?.assetUuid ||
      rawNode?.defaultAsset?.uuid ||
      rawNode?.defaultAsset?.id ||
      ""
  ).trim();
}

function buildDownloadCode(assetUuid, nodeId) {
  const assetCode = compactId(assetUuid);
  const nodeCode = compactId(nodeId);
  return assetCode && nodeCode ? `${assetCode}-${nodeCode}` : "";
}

function getItemDownloadCode(item) {
  const explicitCode = String(item?.downloadCode || item?.eagleCode || "").trim();
  if (/^[0-9a-z]{12}-[0-9a-z]{12}$/i.test(explicitCode)) return explicitCode;
  return buildDownloadCode(item?.assetUuid, item?.nodeId);
}

function buildAssetInfoByNodeId(nodes) {
  const map = new Map();
  for (const node of nodes || []) {
    const assetUuid = getAssetUuidFromNode(node);
    if (!assetUuid || !node?.uuid) continue;
    map.set(node.uuid, {
      assetUuid,
      downloadCode: buildDownloadCode(assetUuid, node.uuid),
      mediaType: inferNodeMediaType(node)
    });
  }
  return map;
}

function inferNodeMediaType(node) {
  const asset = node?.defaultAsset || {};
  const fields = [
    asset.fileType,
    asset.type,
    asset.mimeType,
    asset.mime,
    asset.contentType,
    asset.mediaType,
    asset.name,
    asset.fileName,
    asset.filename,
    asset.webUrl,
    asset.relativePath
  ].map((value) => String(value || "").toLowerCase());
  if (fields.some((value) => /video|\.mp4|\.webm|\.mov|\.m4v|\.avi|\.mkv/.test(value))) return "video";
  if (fields.some((value) => /audio|\.mp3|\.wav|\.m4a|\.aac|\.ogg/.test(value))) return "audio";
  if (fields.some((value) => /image|\.png|\.jpe?g|\.webp|\.gif|\.avif|\.bmp/.test(value))) return "image";
  return "";
}

function enrichItemWithAssetInfo(item, assetInfoByNodeId) {
  const info = assetInfoByNodeId.get(item?.nodeId);
  if (!info) return item;
  return {
    ...item,
    assetUuid: item.assetUuid || info.assetUuid,
    downloadCode: item.downloadCode || info.downloadCode,
    mediaType: item.mediaType || info.mediaType
  };
}

async function enrichItemsWithOriginalAssetInfo(items) {
  const pendingByFileUuid = new Map();
  let changed = false;
  for (const item of items || []) {
    if (getItemDownloadCode(item)) continue;
    const fileUuid = String(item?.fileUuid || "").trim();
    const nodeId = String(item?.nodeId || "").trim();
    if (!fileUuid || !nodeId) continue;
    if (!pendingByFileUuid.has(fileUuid)) pendingByFileUuid.set(fileUuid, []);
    pendingByFileUuid.get(fileUuid).push(item);
  }

  await Promise.all(
    [...pendingByFileUuid.entries()].map(async ([fileUuid, fileItems]) => {
      try {
        const canvas = await fetchCanvas(fileUuid);
        const assetInfoByNodeId = buildAssetInfoByNodeId(canvas.nodes ?? []);
        for (const item of fileItems) {
          const info = assetInfoByNodeId.get(item.nodeId);
          if (!info) continue;
          if (!item.assetUuid && info.assetUuid) {
            item.assetUuid = info.assetUuid;
            changed = true;
          }
          if (!item.downloadCode && info.downloadCode) {
            item.downloadCode = info.downloadCode;
            changed = true;
          }
          if (!item.mediaType && info.mediaType) {
            item.mediaType = info.mediaType;
            changed = true;
          }
        }
      } catch {
        // Some source canvases may be unavailable; keep the review board usable.
      }
    })
  );
  return changed;
}

function findSharedLikesOwnerNode(nodes, ownerName) {
  const textNodes = nodes.filter(isTextLikeNode);
  const marked = textNodes.find((node) => parseSharedLikeText(getRawNodeText(node))?.ownerName === ownerName);
  if (marked) return marked;

  const byLabel = textNodes.find((node) => getRawNodeLabel(node) === ownerName);
  if (byLabel) return byLabel;

  return textNodes.find((node) => {
    const text = getRawNodeText(node).trim();
    return text === ownerName || text.split(/\r?\n/, 1)[0]?.trim() === ownerName;
  });
}

function findSocialDataNode(nodes) {
  const textNodes = nodes.filter(isTextLikeNode);
  const marked = textNodes.find((node) => parseSocialDataText(getRawNodeText(node)));
  if (marked) return marked;

  const byLabel = textNodes.find((node) => getRawNodeLabel(node) === SOCIAL_DATA_NODE_LABEL);
  if (byLabel) return byLabel;

  return textNodes.find((node) => {
    const text = getRawNodeText(node).trim();
    return text === SOCIAL_DATA_NODE_LABEL || text.split(/\r?\n/, 1)[0]?.trim() === SOCIAL_DATA_NODE_LABEL;
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

function buildSocialDataText(data) {
  const normalized = normalizeSocialData(data);
  return [
    SOCIAL_DATA_NODE_LABEL,
    SOCIAL_DATA_MARKER,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        likes: normalized.likes,
        comments: normalized.comments,
        reviews: normalized.reviews
      },
      null,
      2
    )
  ].join("\n");
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

function deriveLikeIndexFromCanvas(canvas) {
  const owners = [];

  for (const node of canvas.nodes ?? []) {
    if (!isTextLikeNode(node)) continue;
    const parsed = parseSharedLikeText(getRawNodeText(node));
    if (!parsed) continue;
    owners.push({
      color: parsed.color,
      keys: parsed.items.map(getLikeKey).filter(Boolean),
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

function getSharedLikesFromCanvas(canvas, ownerName) {
  const allItems = [];
  let ownItems = [];
  let currentOwnerSettings = {};
  const ownerColors = new Map();
  const ownerRecords = [];
  const assetInfoByNodeId = buildAssetInfoByNodeId(canvas.nodes ?? []);
  let socialData = normalizeSocialData();

  for (const node of canvas.nodes ?? []) {
    if (!isTextLikeNode(node)) continue;
    const parsed = parseSharedLikeText(getRawNodeText(node));
    if (parsed) {
      const likedBy = parsed.ownerName || getRawNodeLabel(node) || "Unknown";
      const likedByColor = normalizeColor(parsed.color);
      ownerColors.set(likedBy, likedByColor);
      const items = parsed.items.map((item) =>
        enrichItemWithAssetInfo({ ...item, likedBy, likedByColor }, assetInfoByNodeId)
      );
      ownerRecords.push({
        color: likedByColor,
        items,
        node,
        ownerName: likedBy,
        settings: parsed.settings || {}
      });
      allItems.push(...items);
      if (likedBy === ownerName) {
        ownItems = items;
        currentOwnerSettings = parsed.settings || {};
      }
      continue;
    }

    const parsedSocialData = parseSocialDataText(getRawNodeText(node));
    if (parsedSocialData) socialData = parsedSocialData;
  }

  allItems.sort((first, second) => String(second.likedAt || "").localeCompare(String(first.likedAt || "")));
  return {
    allItems: attachSocialData(allItems, socialData, ownerName, ownerColors),
    ownItems,
    currentOwnerSettings,
    ownerRecords,
    socialData
  };
}

function attachSocialData(items, socialData, ownerName, ownerColors) {
  const likesByTarget = new Map();
  const commentsByTarget = new Map();
  const reviewsByTarget = new Map();

  for (const like of socialData.likes) {
    const targetId = getSocialEntryTargetId(like);
    const entry = {
      ...like,
      color: normalizeColor(ownerColors.get(like.userName) || like.color)
    };
    if (!likesByTarget.has(targetId)) likesByTarget.set(targetId, []);
    const existing = likesByTarget.get(targetId);
    if (!existing.some((item) => item.userName === entry.userName)) existing.push(entry);
  }

  for (const comment of socialData.comments) {
    const targetId = getSocialEntryTargetId(comment);
    const entry = {
      ...comment,
      color: normalizeColor(ownerColors.get(comment.userName) || comment.color)
    };
    if (!commentsByTarget.has(targetId)) commentsByTarget.set(targetId, []);
    commentsByTarget.get(targetId).push(entry);
  }

  for (const review of socialData.reviews) {
    const targetId = getSocialEntryTargetId(review);
    const entry = {
      ...review,
      color: normalizeColor(ownerColors.get(review.userName) || review.color)
    };
    if (!reviewsByTarget.has(targetId)) reviewsByTarget.set(targetId, []);
    reviewsByTarget.get(targetId).push(entry);
  }

  return items.map((item) => {
    const targetId = getSocialTargetId(item);
    const socialLikes = likesByTarget.get(targetId) || [];
    const socialComments = (commentsByTarget.get(targetId) || []).sort((first, second) =>
      String(first.createdAt || "").localeCompare(String(second.createdAt || ""))
    );
    const reviews = (reviewsByTarget.get(targetId) || []).sort((first, second) =>
      String(second.updatedAt || "").localeCompare(String(first.updatedAt || ""))
    );
    const ownReview = reviews.find((review) => review.userName === ownerName) || null;
    const pickedReview = reviews.find((review) => review.status === "pick");
    const maybeReview = reviews.find((review) => review.status === "maybe");
    const rejectReview = reviews.find((review) => review.status === "reject");
    const statusReview = pickedReview || maybeReview || rejectReview || ownReview;
    return {
      ...item,
      reviewStatus: statusReview?.status || "",
      reviewTags: mergeReviewTags(reviews),
      reviewByMe: ownReview,
      reviews,
      socialComments,
      socialLikedByMe: socialLikes.some((like) => like.userName === ownerName),
      socialLikes
    };
  });
}

function mergeReviewTags(reviews) {
  const output = [];
  const seen = new Set();
  for (const review of reviews) {
    for (const tag of review.tags || []) {
      const normalized = normalizeTag(tag);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function getSocialTargetId(item) {
  return JSON.stringify([String(item?.likedBy || ""), getLikeKey(item)]);
}

function getSocialEntryTargetId(entry) {
  return JSON.stringify([String(entry?.targetOwner || ""), String(entry?.targetKey || "")]);
}

async function getSharedLikedItems(options) {
  sharedOptions = options;
  const canvas = await fetchSharedCanvas();
  const result = getSharedLikesFromCanvas(canvas, options.ownerName);
  const changedRecords = [];
  await Promise.all(
    result.ownerRecords.map(async (record) => {
      const changed = await enrichItemsWithOriginalAssetInfo(record.items);
      if (changed) changedRecords.push(record);
    })
  );
  if (changedRecords.length) {
    persistEnrichedSharedItems(canvas, changedRecords).catch(() => {});
  }
  return result;
}

async function persistEnrichedSharedItems(canvas, records, retryCount = 1) {
  const update = records.map((record) => ({
    uuid: record.node.uuid,
    metaData: record.node.metaData || "{}",
    nodeText: buildSharedLikeText(
      record.ownerName,
      stripRuntimeFields(record.items),
      record.color,
      record.settings
    )
  }));
  if (!update.length) return;

  const result = await apiPost("/canvas/node/batch", {
    fileUuid: sharedOptions.fileUuid,
    baseRevision: canvas.revision,
    create: [],
    update,
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      const nextCanvas = await fetchSharedCanvas();
      const nextRecords = records
        .map((record) => {
          const node = findSharedLikesOwnerNode(nextCanvas.nodes ?? [], record.ownerName);
          return node ? { ...record, node } : null;
        })
        .filter(Boolean);
      return persistEnrichedSharedItems(nextCanvas, nextRecords, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "Could not persist Eagle codes.");
  }
}

function stripRuntimeFields(items) {
  return (items || []).map((item) => {
    const {
      likedBy,
      likedByColor,
      reviewStatus,
      reviewTags,
      reviewByMe,
      reviews,
      socialComments,
      socialLikedByMe,
      socialLikes,
      ...storedItem
    } = item;
    return storedItem;
  });
}

async function saveSharedOwnItems(items, retryCount = 1) {
  const canvas = await fetchSharedCanvas();
  const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], sharedOptions.ownerName);
  if (!ownerNode) {
    throw new Error(`Shared canvas has no text node named "${sharedOptions.ownerName}".`);
  }

  const result = await apiPost("/canvas/node/batch", {
    fileUuid: sharedOptions.fileUuid,
    baseRevision: canvas.revision,
    create: [],
    update: [
      {
        uuid: ownerNode.uuid,
        metaData: ownerNode.metaData || "{}",
        nodeText: buildSharedLikeText(
          sharedOptions.ownerName,
          items,
          sharedOptions.color || parseSharedLikeText(getRawNodeText(ownerNode))?.color,
          parseSharedLikeText(getRawNodeText(ownerNode))?.settings || {}
        )
      }
    ],
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return saveSharedOwnItems(items, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "Could not update shared Likes.");
  }

  try {
    const nextCanvas = await fetchSharedCanvas();
    await upsertLikeIndexForOwner(nextCanvas, sharedOptions.ownerName, sharedOptions.color, items);
  } catch {
    // Likes were saved successfully; the index can be repaired on the next write.
  }
}

async function upsertLikeIndexForOwner(canvas, ownerName, color, items, retryCount = 1) {
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

  const result = await apiPost("/canvas/node/batch", {
    fileUuid: sharedOptions.fileUuid,
    baseRevision: canvas.revision,
    create: payload.create,
    update: payload.update,
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      const nextCanvas = await fetchSharedCanvas();
      return upsertLikeIndexForOwner(nextCanvas, ownerName, color, items, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "Could not update shared Likes index.");
  }
}

async function updateSocialData(mutator, retryCount = 1) {
  const canvas = await fetchSharedCanvas();
  const socialNode = findSocialDataNode(canvas.nodes ?? []);
  const previousData = socialNode ? parseSocialDataText(getRawNodeText(socialNode)) : null;
  const nextData = normalizeSocialData(mutator(previousData || normalizeSocialData()));
  const payload = socialNode
    ? {
        create: [],
        update: [
          {
            uuid: socialNode.uuid,
            metaData: socialNode.metaData || "{}",
            nodeText: buildSocialDataText(nextData)
          }
        ]
      }
    : {
        create: [buildSocialDataNode(canvas.nodes ?? [], nextData)],
        update: []
      };

  const result = await apiPost("/canvas/node/batch", {
    fileUuid: sharedOptions.fileUuid,
    baseRevision: canvas.revision,
    create: payload.create,
    update: payload.update,
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return updateSocialData(mutator, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "Could not update Pixmax Likes comments.");
  }
}

function buildSocialDataNode(nodes, data) {
  const positions = nodes
    .filter(isTextLikeNode)
    .map((node) => parseNodeMetaData(node).position || {});
  const maxX = positions.reduce((value, position) => Math.max(value, Number(position.x) || 0), 0);

  return {
    uuid: crypto.randomUUID(),
    type: "BASE_TEXT",
    metaData: JSON.stringify({
      data: { label: SOCIAL_DATA_NODE_LABEL },
      position: {
        x: maxX + 360,
        y: 120
      },
      measured: {
        width: 360,
        height: 220
      },
      width: 360,
      height: 220
    }),
    nodeText: buildSocialDataText(data)
  };
}

async function toggleSocialLike(item) {
  if (!sharedMode) return;
  const targetKey = getLikeKey(item);
  const targetOwner = String(item.likedBy || "");
  const userName = sharedOptions.ownerName;
  const color = normalizeColor(sharedOptions.color);
  if (!targetKey || !userName) return;

  await updateSocialData((data) => {
    const likes = data.likes.filter(
      (like) =>
        !(
          like.targetKey === targetKey &&
          like.targetOwner === targetOwner &&
          like.userName === userName
        )
    );
    if (likes.length === data.likes.length) {
      likes.push({
        targetKey,
        targetOwner,
        userName,
        color,
        createdAt: new Date().toISOString()
      });
    }
    return {
      ...data,
      likes
    };
  });
}

async function addSocialComment(item, text) {
  if (!sharedMode) return;
  const targetKey = getLikeKey(item);
  const targetOwner = String(item.likedBy || "");
  const userName = sharedOptions.ownerName;
  const color = normalizeColor(sharedOptions.color);
  const commentText = String(text || "").trim().slice(0, 500);
  if (!targetKey || !userName || !commentText) return;

  await updateSocialData((data) => ({
    ...data,
    comments: [
      ...data.comments,
      {
        id: crypto.randomUUID(),
        targetKey,
        targetOwner,
        userName,
        color,
        text: commentText,
        createdAt: new Date().toISOString()
      }
    ]
  }));
}

async function setReviewStatus(item, status) {
  const normalizedStatus = hasReviewStatus(status) ? status : "";
  await updateReviewData(item, (review) => ({
    ...review,
    status: normalizedStatus
  }));
}

async function addReviewTags(item, tags) {
  const nextTags = parseTags(tags.join(","));
  if (!nextTags.length) return;
  await updateReviewData(item, (review) => ({
    ...review,
    tags: mergeTags(review.tags, nextTags)
  }));
}

async function removeReviewTag(item, tag) {
  const targetTag = normalizeTag(tag);
  if (!targetTag) return;
  await updateReviewData(item, (review) => ({
    ...review,
    tags: (review.tags || []).filter((itemTag) => normalizeTag(itemTag) !== targetTag)
  }));
}

async function updateReviewData(item, mutator) {
  if (!sharedMode) {
    await updateLocalReviewData(item, mutator);
    return;
  }

  const targetKey = getLikeKey(item);
  const targetOwner = String(item.likedBy || "");
  const userName = sharedOptions.ownerName;
  const color = normalizeColor(sharedOptions.color);
  if (!targetKey || !userName) return;

  await updateSocialData((data) => {
    const reviews = data.reviews.filter(
      (review) =>
        !(
          review.targetKey === targetKey &&
          review.targetOwner === targetOwner &&
          review.userName === userName
        )
    );
    const previous = data.reviews.find(
      (review) =>
        review.targetKey === targetKey &&
        review.targetOwner === targetOwner &&
        review.userName === userName
    ) || {
      targetKey,
      targetOwner,
      userName,
      color,
      status: "",
      tags: []
    };
    const mutated = mutator(previous);
    const next = {
      ...mutated,
      targetKey,
      targetOwner,
      userName,
      color,
      tags: parseTags((mutated.tags || []).join(",")),
      updatedAt: new Date().toISOString()
    };
    if (next.status || next.tags.length) reviews.push(next);
    return {
      ...data,
      reviews
    };
  });
}

async function updateLocalReviewData(item, mutator) {
  const targetKey = getLikeKey(item);
  if (!targetKey) return;

  const items = await getLocalLikedItems();
  const index = items.findIndex((likedItem) => getLikeKey(likedItem) === targetKey);
  if (index < 0) return;

  const previous = {
    status: items[index].reviewStatus || "",
    tags: Array.isArray(items[index].reviewTags) ? items[index].reviewTags : []
  };
  const mutated = mutator(previous);
  items[index] = {
    ...items[index],
    reviewStatus: hasReviewStatus(mutated.status) ? mutated.status : "",
    reviewTags: parseTags((mutated.tags || []).join(",")),
    reviewedAt: new Date().toISOString()
  };

  await setLocalLikedItems(items);
}

function getLocalLikedItems() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ [LIKES_STORAGE_KEY]: [] }, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(Array.isArray(result[LIKES_STORAGE_KEY]) ? result[LIKES_STORAGE_KEY] : []);
    });
  });
}

function setLocalLikedItems(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [LIKES_STORAGE_KEY]: items }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve();
    });
  });
}

function getLocalWatchedVideoKeys() {
  return getLocalWatchedVideoState().then((state) => state.watchedKeys);
}

function getLocalWatchedVideoState() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(
      {
        [KNOWN_VIDEO_STORAGE_KEY]: [],
        [UNREAD_VIDEO_STORAGE_KEY]: [],
        [WATCHED_VIDEO_STORAGE_KEY]: [],
        [WATCHED_VIDEO_BASELINE_KEY]: "",
        [WATCHED_VIDEO_REVIEW_BASELINE_KEY]: "",
        [KNOWN_VIDEO_REVIEW_MODEL_KEY]: ""
      },
      (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        const watchedKeys = getWatchedVideoKeys({ watchedVideoKeys: result[WATCHED_VIDEO_STORAGE_KEY] });
        resolve({
          baselineAt: String(result[WATCHED_VIDEO_BASELINE_KEY] || ""),
          knownKeys: getKnownVideoKeys({ knownVideoKeys: result[KNOWN_VIDEO_STORAGE_KEY] }),
          reviewBaselineAt: String(result[WATCHED_VIDEO_REVIEW_BASELINE_KEY] || ""),
          reviewModelAt: String(result[KNOWN_VIDEO_REVIEW_MODEL_KEY] || ""),
          unreadKeys: getUnreadVideoKeys({ unreadVideoKeys: result[UNREAD_VIDEO_STORAGE_KEY] }).filter(
            (key) => !watchedKeys.includes(key)
          ),
          watchedKeys
        });
      }
    );
  });
}

function setLocalWatchedVideoState(state = {}) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(
      {
        [KNOWN_VIDEO_STORAGE_KEY]: getKnownVideoKeys({ knownVideoKeys: state.knownKeys }),
        [UNREAD_VIDEO_STORAGE_KEY]: getUnreadVideoKeys({ unreadVideoKeys: state.unreadKeys }),
        [WATCHED_VIDEO_STORAGE_KEY]: getWatchedVideoKeys({ watchedVideoKeys: state.watchedKeys }),
        [WATCHED_VIDEO_BASELINE_KEY]: state.baselineAt || "",
        [WATCHED_VIDEO_REVIEW_BASELINE_KEY]: state.reviewBaselineAt || "",
        [KNOWN_VIDEO_REVIEW_MODEL_KEY]: state.reviewModelAt || ""
      },
      () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve();
      }
    );
  });
}

async function persistSharedVideoState(nextSettings = null, retryCount = 1) {
  const canvas = await fetchSharedCanvas();
  const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], sharedOptions.ownerName);
  if (!ownerNode) throw new Error(`Shared canvas has no text node named "${sharedOptions.ownerName}".`);
  const parsed = parseSharedLikeText(getRawNodeText(ownerNode));
  const settings = parsed?.settings && typeof parsed.settings === "object" ? parsed.settings : {};
  const mergedWatchedKeys = getWatchedVideoKeys({
    watchedVideoKeys: [
      ...getWatchedVideoKeys(settings),
      ...getWatchedVideoKeys(nextSettings)
    ]
  });
  const mergedSettings = {
    ...settings,
    ...(nextSettings || {}),
    watchedVideoBaselineAt:
      nextSettings?.watchedVideoBaselineAt || settings.watchedVideoBaselineAt || new Date().toISOString(),
    watchedVideoReviewBaselineAt:
      nextSettings?.watchedVideoReviewBaselineAt || settings.watchedVideoReviewBaselineAt || "",
    knownVideoReviewModelAt:
      nextSettings?.knownVideoReviewModelAt || settings.knownVideoReviewModelAt || "",
    knownVideoKeys: getKnownVideoKeys({
      knownVideoKeys: [
        ...getKnownVideoKeys(settings),
        ...getKnownVideoKeys(nextSettings)
      ]
    }),
    unreadVideoKeys: getUnreadVideoKeys({
      unreadVideoKeys: [
        ...getUnreadVideoKeys(settings),
        ...getUnreadVideoKeys(nextSettings)
      ]
    }).filter((key) => !mergedWatchedKeys.includes(key)),
    watchedVideoKeys: mergedWatchedKeys
  };
  const result = await apiPost("/canvas/node/batch", {
    fileUuid: sharedOptions.fileUuid,
    baseRevision: canvas.revision,
    create: [],
    update: [
      {
        uuid: ownerNode.uuid,
        metaData: ownerNode.metaData || "{}",
        nodeText: buildSharedLikeText(
          sharedOptions.ownerName,
          parsed?.items || [],
          sharedOptions.color || parsed?.color,
          mergedSettings
        )
      }
    ],
    delete: []
  });

  if (!result.success) {
    if (result.errCode === CANVAS_REVISION_CONFLICT && retryCount > 0) {
      return persistSharedVideoState(nextSettings, retryCount - 1);
    }
    throw new Error(result.errMessage || result.errCode || "Could not update watched videos.");
  }
}

function parseTags(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  const tags = raw
    .split(/[,\n,#\uFF0C\u3001]+/)
    .map(normalizeTag)
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 12);
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 28);
}

function mergeTags(first = [], second = []) {
  return parseTags([...first, ...second].join(","));
}

function hasReviewStatus(status) {
  return Object.prototype.hasOwnProperty.call(REVIEW_STATUSES, status);
}

async function removeSharedLike(item) {
  if (item.likedBy && item.likedBy !== sharedOptions.ownerName) return;
  const canvas = await fetchSharedCanvas();
  const ownerNode = findSharedLikesOwnerNode(canvas.nodes ?? [], sharedOptions.ownerName);
  if (!ownerNode) throw new Error(`Shared canvas has no text node named "${sharedOptions.ownerName}".`);
  const parsed = parseSharedLikeText(getRawNodeText(ownerNode));
  const targetKey = getLikeKey(item);
  const items = (parsed?.items || []).filter((likedItem) => getLikeKey(likedItem) !== targetKey);
  await saveSharedOwnItems(items);
}

async function clearSharedLikes() {
  await saveSharedOwnItems([]);
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIKE_COLOR;
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

# PixmaxHub Plug

Chrome extension that adds helper actions to Pixmax's selected-node toolbar:

- Select linked nodes: keep the main node selected and add directly linked nodes.
- Create duplicate: run the same selection step, then trigger Pixmax's native copy and paste-with-links shortcuts.
- Repaired paste-with-links: add a fixed variant next to Pixmax's native context-menu paste-with-links action.
- Save to Eagle: send Pixmax's original asset URL to Eagle's local Web API.
- Like: save generated Pixmax results locally, or sync them through a shared Pixmax text node.
- Review Board: search shared Likes, filter by review status, mark results as Pick/Maybe/Reject, tag results, and keep team comments/likes in the shared canvas.

## Local Likes

Generated results with Pixmax's native download action get a heart Like button in the selected-node toolbar.

By default, Likes are stored locally with `chrome.storage.local`.

To share Likes across the team, open the extension popup, enable **共享 Likes**, use the configured **数据库链接**, and enter your name. In that shared canvas, create one text node whose visible text or title matches that name. The extension will only update that user's text node and will read all marked user nodes when showing shared Likes.

Open the extension popup and click **Open Likes** to view, copy, open, or remove saved results. In the Likes page, **Open** adds a focus hint so the Pixmax page can select and highlight the original node after the canvas renders.

In shared mode, the Likes page becomes a lightweight review board. Team members can filter by owner, search across names/prompts/tags/comments, mark each result as Pick/Maybe/Reject, add tags, and leave likes/comments. Review data is stored in the shared canvas text node marked `PIXMAX_LIKES_SOCIAL_V1`.

Use **Export HTML** to download a standalone share page, or **Export JSON** to download the raw local Likes data for backup.

## Eagle Import

1. Open Eagle App.
2. Click the extension icon, refresh the Eagle folder list, and select a target folder.
3. Select a Pixmax image, video, or audio node that has Pixmax's native download action.
4. Click the Eagle import action in the selected-node toolbar.

The extension sends Pixmax's original asset URL to Eagle at `http://localhost:41595`. When the Pixmax node has a generation prompt, the extension saves that prompt as the Eagle item description.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this extension folder.
5. Refresh an open `https://app.pixmax.cn/workspace/...` page.

## GitHub Online Update

This internal build can check a GitHub repository for a newer `manifest.json` version and install the allowed extension files into the local unpacked extension folder after the user clicks **安装更新**.

In the extension popup:

1. Enter a GitHub repository URL such as `https://github.com/owner/repo`, or a branch URL such as `https://github.com/owner/repo/tree/main`.
2. Click **选择/更换更新目录** and select the current unpacked extension folder.
3. Click **检查更新**.
4. If a newer version is found, click **安装更新**.

The updater downloads files from the repository root and writes only the files in the extension allowlist.

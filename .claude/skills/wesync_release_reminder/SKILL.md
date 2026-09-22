---
name: wesync-release-reminder
description: "wesync（夫妻共享待办微信小程序）发版版本号同步提醒（仅本仓库内生效）。当用户对 wesync 做了功能优化/修 bug 且涉及要推给线上用户时，本 skill 会提醒：把 `utils/config.js` 的 `APP_VERSION`（当前见 .claude/skills/wesync_release_reminder/version.txt 且与 `utils/config.js` 同步）+ 云数据库 `app_config.version` 更新成新版本号，否则「首页横幅」不会提醒用户更新。可直接运行该 skill 的 py 脚本查看/自增版本号。"
---

# wesync 发版版本号同步提醒（项目内）

只适用于**本仓库**（wesync 夫妻共享待办微信小程序，CloudBase 云开发）。

版本更新提醒是「**双保险** + 首页横幅」机制：

- 冷启动弹窗：`wx.getUpdateManager().onUpdateReady`，由微信自动判断（零维护）。
- 首页横幅「悄悄话：我藏了个新功能」：靠 `pages/index/index.js` 的 `checkLatestVersion()`，
  其中 **② 兜底**调云函数 `getLatestVersion` 读云数据库 `app_config` 的 `latest-version` 记录，
  与本地 `utils/config.js` 的 `APP_VERSION` 对比，**不一致就弹横幅**。

> ⚠️ **只要改了 wesync 的功能想推到线上**，就必须同步版本号，
> 否则老用户收不到「有新版本」横幅，改了等于白改。

## 版本号要同步的 3 个地方

| # | 位置 | 路径 / 记录 | 谁来改 |
|---|---|---|---|
| 1 | 前端版本号 | `utils/config.js` 的 `APP_VERSION` | 本仓代码 |
| 2 | 云数据库兜底版本 | 云开发控制台 → `app_config` 集合 → `_id=latest-version` 的 `version` | 手动 |
| 3 | 云函数 | `cloudfunctions/getLatestVersion/index.js`（新函数首次需部署） | 部署 |

> 第 1、2 处必须改成**相同**的新版本号。只改前端 → 横幅不显示；只改库不改前端 → 横幅永远挂着。

## 何时触发本 skill

当用户对 wesync 做了以下任一操作时，**发版前提醒同步版本号**：

- 新增/优化功能、修 bug（关系到线上用户）
- 改了 `pages/`、`app.js`、`utils/`、`cloudfunctions/` 中的代码

**不**需要提醒改版本号的场景：纯文案调整、不推线上的本地调试、文档修改。

## 查看/更新版本号（可选）

脚本读取 `.claude/skills/wesync_release_reminder/version.txt` 里的项目版本号，
打印该版本号应同步写入的各个位置，供你对照核查。

```bash
python .claude/skills/wesync_release_reminder/wesync_release_reminder.py            # 查看 + 同步点
python .claude/skills/wesync_release_reminder/wesync_release_reminder.py --bump     # 自增（1.0.11 → 1.0.12）
python .claude/skills/wesync_release_reminder/wesync_release_reminder.py --set 1.0.13  # 手动指定
```

### 发版前最小清单（提醒用户核对）

1. `utils/config.js` 的 `APP_VERSION` 是否为最新（与 version.txt 一致）。
2. 云数据库 `app_config.latest-version.version` 是否与第 1 处相同（手动改库）。
3. 部署 `getLatestVersion`（新增时）+ 本次改动的其它云函数。
4. 开发者工具「上传」→ 微信公众平台审核 → 发布。

> 完整版参见本仓根目录的 `RELEASE_CHECKLIST.md`。
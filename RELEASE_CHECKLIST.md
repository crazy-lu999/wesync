# 发版检查清单（wesync）

> 每次发版按顺序过一遍即可。下面用 `1.0.16` 作示例，实际发版时替换成自己的版本号。

## 0. 先确定版本号

- 本次版本号：`1.0.16`
- 上一版：`1.0.15`

需要保持一致的地方：

- [ ] `utils/config.js` 的 `APP_VERSION`
- [ ] `utils/release-notes.js` 里最新一条的 `version`
- [ ] 云端 `app_config/latest-version` 的 `version`
- [ ] 微信开发者工具「上传」时填的版本号
- [ ] 小程序后台提交审核时的版本号

---

## 1. 代码里的更新点（必须改）

### `utils/config.js`

- [ ] 修改 `APP_VERSION`

```js
APP_VERSION: '1.0.16',
```

### `utils/release-notes.js`

- [ ] 在数组最前面加本次版本
- [ ] `notes` 控制在 1~3 条
- [ ] 写用户能直接感知的变化，不写技术实现
- [ ] 不要出现「公开 / 社区 / 社交 / 点赞 / 关注 / 建议墙」等词

```js
{
  version: '1.0.16',
  title: '这次更新',
  notes: [
    '用起来更跟手更稳了：勾选、删除点完立刻生效，不会再闪一下又变回去',
    '相片墙打开更顺，照片不再重新加载一闪',
    '「我的」页小改版：两个人的头像各有一抹颜色，纪念日卡片也变得暖暖的',
  ],
}
```

### `README.md`（可选）

- [ ] 在「发版记录」里加一条本次版本，方便以后回看

---

## 2. 云端更新点（建议每次同步）

### `app_config` → `latest-version`

云开发控制台 → 数据库 → `app_config` → `latest-version`

- [ ] `version` 与 `APP_VERSION` 一致
- [ ] `title` 是弹窗标题
- [ ] `notes` 与 `utils/release-notes.js` 保持一致
- [ ] `releasedAt` 写上发布日期

```json
{
  "_id": "latest-version",
  "version": "1.0.16",
  "title": "这次更新",
  "notes": [
    "用起来更跟手更稳了：勾选、删除点完立刻生效，不会再闪一下又变回去",
    "相片墙打开更顺，照片不再重新加载一闪",
    "「我的」页小改版：两个人的头像各有一抹颜色，纪念日卡片也变得暖暖的"
  ],
  "releasedAt": "2025-XX-XX"
}
```

### 数据库安全规则（每次发版必查）

- [ ] `todos` 使用**自定义安全规则**（不能是「所有用户可读写」）：

```json
{
  "read": "auth.openid in doc.members",
  "write": false
}
```

> `write` 是布尔 `false`，**不要加引号**（写成 `"false"` 会报 `rule invalid`）。

- [ ] `todos` 集合已开启「实时数据推送」（否则 `watch` 不生效，会降级为 10 秒轮询）
- [ ] `families` 保持默认权限（读写全走云函数）
- [ ] `feedbacks` 为 `{ "read": false, "write": false }`

> 改规则前如果担心老数据不满足 `auth.openid in doc.members`，先跑一次 `cloudfunctions/fixTodoMembers`：
> 入参 `{}` 看报告（看 `fixed` / `orphans`），确认后传 `{"apply": true}` 写入，再跑 `{}` 确认 `fixed` 为 0。
> 理由：`watch` 的权限校验是**整查询级**的，只要有一条文档读不了，整个订阅就会失败且不重试。

### 反馈相关

- [ ] `feedbacks` 集合权限保持：

```json
{ "read": false, "write": false }
```

- [ ] `utils/config.js` 和 `cloudfunctions/adminFeedback/index.js` 的 `ADMIN_OPENID` 一致

### 提醒相关（如果本次改了提醒）

- [ ] `utils/config.js` 的 `REMIND_TMPL_ID`
- [ ] `cloudfunctions/sendReminders/index.js` 的 `REMIND_TMPL_ID`
- [ ] 云函数环境变量 `MINI_STATE=formal`（正式版）
- [ ] `sendReminders` 定时触发器还在
- [ ] 模板字段与 `REMIND_FIELDS` 对得上

---

## 3. 云函数部署

有改动才重新部署；没改动可跳过。

- [ ] `getLatestVersion`（本次更新说明相关）
- [ ] `submitFeedback`（意见反馈）
- [ ] `adminFeedback`（反馈管理）
- [ ] `sendReminders`（提醒，如果改了）
- [ ] `todoOps` / `updateFamily` / `updateNickname` 等（如果改了）

> 本次 1.0.16 无业务云函数改动，可跳过。`fixTodoMembers` 是数据修复工具，不需要长期部署。

> 部署方式：右键云函数目录 →「上传并部署：云端安装依赖（不上传 node_modules）」

---

## 4. 本地自测

### 版本与更新说明

- [ ] 「我的」页底部显示 `v1.0.16`
- [ ] 「我的 → 更新日志」能看到 1.0.16 和 1.0.15
- [ ] 预览「本次更新」弹窗，更新点左对齐、换行正常
- [ ] 模拟旧版本升级：
  - 在 Console 执行：
    ```js
    const p = getCurrentPages().find((x) => x.route === 'pages/index/index');
    wx.setStorageSync('lastVersion', '1.0.15');
    p.maybeShowReleaseNotes();
    ```
  - 应弹出 1.0.16 更新说明
  - 弹完后 `lastVersion` 应为 `1.0.16`
- [ ] 测试完把 `lastVersion` 设为当前版本，避免重复弹

### 核心功能

- [ ] 创建家庭 / 输入邀请码加入
- [ ] 添加待办、勾选完成、取消完成（勾选后**不得跳回未完成区**）
- [ ] 对方端实时同步 / 约 10 秒内出现
- [ ] 长按编辑、删除、5 秒撤销（窗口内**不得闪回**；删除失败应提示「已恢复」）
- [ ] 重要标记、清空已完成
- [ ] 相片墙上传 / 删除 / 改标题（反复进出「我的」页**照片不得重新加载一闪**）
- [ ] 纪念日添加 / 编辑 / 删除
- [ ] 昵称修改

### 提醒功能（如果本次涉及）

- [ ] 「我的 → 开启微信提醒」授权成功
- [ ] 新建带提醒的待办
- [ ] 到点能收到订阅消息
- [ ] 双方分别授权后都能收到

### 意见反馈

- [ ] 「我的 → 意见反馈」提交一条
- [ ] 提示「已收到」
- [ ] 开发者「我的 → 反馈管理」能看到
- [ ] 标记已读 / 删除正常
- [ ] 普通用户看不到「反馈管理」入口

---

## 5. 提审前检查

- [ ] 已删除调试代码：搜索 `isDebug`、`onDebug`、`debug-fab`、`🧪`
- [ ] 用户可见文案没有「公开 / 社区 / 社交 / 点赞 / 关注 / 建议墙」
- [ ] 没有公开列表、公开点赞、公开回复等社交功能
- [ ] 意见反馈是私密提交，页面文案友好
- [ ] 服务类目选工具类，不选社交类目
- [ ] 小程序能正常编译，无报错

---

## 6. 上传与发布

- [ ] 开发者工具「上传」，版本号与 `APP_VERSION` 一致
- [ ] 小程序后台提交审核
- [ ] 审核通过后发布

---

## 7. 发布后验证

- [ ] 用旧版本（如 1.0.15）打开，能看到首页更新横幅
- [ ] 点横幅能看到「这次更新」内容
- [ ] 更新到 1.0.16 后首次进入首页，弹一次更新说明
- [ ] 「我的 → 更新日志」正常
- [ ] 云函数日志无异常
- [ ] `app_config` 的 notes 与本地说明一致

---

## 8. 常用位置速查

| 内容 | 位置 | 作用 |
|---|---|---|
| 版本号 | `utils/config.js` → `APP_VERSION` | App 内部版本 |
| 更新点（本地） | `utils/release-notes.js` | 更新弹窗 + 更新日志兜底 |
| 更新点（云端） | `app_config/latest-version` | 旧版横幅预览 + 更新日志合并 |
| 发版记录 | `README.md` | 开发记录，可选 |
| 反馈管理权限 | `utils/config.js` + `adminFeedback/index.js` 的 `ADMIN_OPENID` | 仅开发者可见 |
| 提醒模板 | `utils/config.js` + `sendReminders/index.js` | 两处必须一致 |
| 云函数 | `cloudfunctions/*` | 有改动才部署 |

---

## 9. 常见问题

### 更新弹窗不弹

- `lastVersion` 的 key 是不是写成了 `lastversion`（V 要大写）
- 当前页面是不是首页（`pages/index/index`）
- `utils/release-notes.js` 里有没有当前 `APP_VERSION` 的说明
- 修改 Storage 后有没有重新编译或手动触发 `maybeShowReleaseNotes`

### 旧版横幅点开没有更新内容

- `app_config/latest-version` 的 `version` 是否比当前版本新
- `notes` 是否为空
- `getLatestVersion` 是否已重新部署

### 「反馈管理」入口不显示

- `ADMIN_OPENID` 是否是你的 openid
- `utils/config.js` 与 `cloudfunctions/adminFeedback/index.js` 是否一致

### 收不到提醒

- 模板 ID 两处是否一致
- `sendReminders` 是否部署、定时触发器是否存在
- 环境变量 `MINI_STATE` 是否设为 `formal`
- 用户是否授权了订阅消息

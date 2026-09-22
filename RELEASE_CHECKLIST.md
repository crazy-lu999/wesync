# 📦 发版 Checklist（每次发版逐项打卡）

> 版本更新横幅采用**双保险**：
> ① `wx.getUpdateManager.onCheckForUpdate` 自动判断（零维护，主治常规）；
> ② `app_config` 版本号对比兜底（覆盖“从旧版一直挂后台、期间发版、从不重新冷启动”的极端热启动）。
> 常规场景靠①即可，想让极端热启动也不漏，则发版时需同步**改一次 `app_config`**（见第 2 步）。

## 🚦 必做项

### 1. 改前端版本号
- [ ] `utils/config.js` 的 `APP_VERSION` 改成新版本号
      （例：`1.0.10` → `1.0.11`）

### 2. 同步云数据库版本号（兜底用，常规场景也建议同步）
- [ ] 打开 **微信开发者工具 → 云开发 → 数据库 → `app_config`** 集合
- [ ] 找到 `_id = latest-version` 那条记录
- [ ] 把 `version` 改成**和 `utils/config.js` 相同的新版本号**
- [ ] 保存

> 💡 **为什么建议同步**：两处版本号一致对齐后，横幅的兜底判断才准确。
> 只改前端不改这 → 老用户本地还旧版、服务端还是旧号，两端相等，兜底不触发（但①仍会工作）。
> 只改这不改前端 → 横幅永远显示（用户升级也消不掉）。
> **所以最好两处一起改。**

### 3. 重新部署有改动的云函数
- [ ] `cloudfunctions/` 下有改动的函数，逐一「上传并部署」。
      ⚠️ 尤其：`updateFamily`（封面裁剪/来源/孤儿清理）、`getLatestVersion`（兜底横幅）。
- [ ] 确认用 **「云端安装依赖」** 方式部署（不在本地装 node_modules）。

### 4. 上传代码 & 发版
- [ ] 开发者工具 **「上传」** 代码
- [ ] 到 **微信公众平台 → 版本管理** → 提交审核
- [ ] 审核通过后点 **「发布」**

---

## 🔁 双保险怎么分工（无需你操心代码）

```js
// ① 自动：app.js onCheckForUpdate → globalData.hasUpdate
// ② 兜底：index.js checkLatestVersion 查 app_config.version ≠ APP_VERSION → 都点亮横幅
```
- **冷启动弹窗**：`onUpdateReady`（自动）→「悄悄话：有更新啦 🎉」一键重启
- **首页横幅**：`onShow` 先读 `hasUpdate`（自动），再查 `app_config` 对比（兜底）→ 都能看到

---

## 🔁 首次部署 `app_config`（仅第一次，之后每次只改 `version`）

1. **云开发 → 数据库 → + 添加集合**，集合名填 **`app_config`**，确定。
2. 进入 `app_config` → **+ 新增记录**。
3. 手动把 `_id` 改成 **`latest-version`**，并加 `version` 字段填当前版本号：
   ```json
   {
     "_id": "latest-version",
     "version": "1.0.10"
   }
   ```
4. 确定保存。

> 之后每次发版，只需改这条记录的 `version`。

---

## 🚨 常见坑速查

- **横幅一直不出现** → 常规①已自动判断；若仍无，检查 `app_config` 是否建好/`_id` 是否 `latest-version`/`version` 是否高于本地 `APP_VERSION`。
- **横幅一直不消失** → `app_config.version` 高于代码 `APP_VERSION` 且没同步，对齐即可。
- **裁剪封面保存失败** → `updateFamily` 云函数没重新部署（旧版拒绝 `covers/` 文件）。
- **热启动收不到** → 确认 `app.js` 已注册 `onCheckForUpdate`、`index.js` `onShow` 调了 `checkLatestVersion()`，且 `getLatestVersion` 已部署。
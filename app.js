// app.js
const config = require('./utils/config.js');

App({
  onLaunch() {
    this.checkUpdate();
    this.checkRemindSetting();

    if (!wx.cloud) {
      console.error('请用 2.2.3 或以上基础库以使用云开发');
      return;
    }
    // 云开发初始化：填入你的云环境 envId（开发者工具左上角"云开发"按钮里可看到）
    wx.cloud.init({
      env: 'cloud1-d7gyqmu912767f384',
      traceUser: true,
    });
  },

  // 检测新版本 & 维护全局「有无新版」标志
  checkUpdate() {
    if (!wx.canIUse('getUpdateManager') || !wx.getUpdateManager) return;
    const updateManager = wx.getUpdateManager();

    // 自动判断线上是否有新版本：结果存全局，供首页横幅读取（无需手动维护版本号）
    updateManager.onCheckForUpdate((res) => {
      if (res && res.hasUpdate) this.globalData.hasUpdate = true;
    });

    updateManager.onUpdateReady(() => {
      // 新版已下载完成，可以应用
      this.globalData.hasUpdate = true;
      this.globalData.updateReady = true;
      // 已用弹窗提醒：打个全局标记，首页横幅据此让位，避免弹窗+横幅重复提醒
      this.globalData.updateDialogShown = true;
      wx.showModal({
        title: '有更新啦 🎉',
        content: '我又偷偷加了好玩的功能，\n重启一下就能用上新版哦～❤️',
        showCancel: false,
        confirmText: '马上重启',
        success: (res) => {
          if (res.confirm) updateManager.applyUpdate();
        },
      });
    });

    updateManager.onUpdateFailed(() => {
      // 下载失败：不强制提示，等微信后续自然同步（下次冷启动仍会用新版）
      console.warn('新版本下载失败，将在下次冷启动时自动更新');
    });
  },

  // 读取订阅消息的用户选择，用于判断能否「静默续额度」：
  // 用户勾选「总是保持以上选择」后，itemSettings[模板] === 'accept'，
  // 此时再调 requestSubscribeMessage 不会弹窗，可无人感知地 +1 条额度。
  checkRemindSetting() {
    const tmplId = (config.REMIND_TMPL_ID || '').trim();
    if (!tmplId || !wx.getSetting) return;
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const item = (res.subscriptionsSetting && res.subscriptionsSetting.itemSettings) || {};
        this.globalData.remindTmplAccept = item[tmplId] === 'accept';
      },
      fail: () => { /* 忽略 */ },
    });
  },

  globalData: {
    openid: null,
    family: null, // { _id, name, inviteCode, members, memberNicks, ... }
    hasUpdate: false, // 线上是否有新版本（由 onCheckForUpdate 自动写入）
    updateReady: false, // 新版本是否已下载完成（由 onUpdateReady 自动写入）
    updateDialogShown: false, // 热启动已弹窗提醒一张卡，首页横幅据此让位不重复
    remindTmplAccept: false, // 用户是否对提醒模板选了「总是保持以上选择」（可静默续额度）
    latestRelease: null, // 云端最新版本说明 { version, title, notes, releasedAt }
  },
});

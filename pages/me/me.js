// pages/me/me.js
const { getMyFamily, leaveFamily, updateNickname, getMyReminders, cancelReminder } = require('../../utils/db.js');
const { fmtDateTime } = require('../../utils/format.js');
const app = getApp();

// 由 (family, openid) 生成页面视图数据
function buildView(family, openid) {
  const memberNicks = (family && family.memberNicks) || {};
  const myNick = memberNicks[openid] || '我';
  const members = ((family && family.members) || []).map((o) => ({
    openid: o,
    nick: memberNicks[o] || '成员',
    me: o === openid,
  }));
  return { family: family || null, myOpenid: openid || '', myNick, members };
}

// 生成提醒列表视图：显示触发时间 + 倒计时
function buildReminders(list) {
  const now = Date.now();
  return (list || []).map((r) => {
    const ts = r.remindAt ? new Date(r.remindAt).getTime() : 0;
    return {
      ...r,
      timeText: r.remindAt ? '🔥 ' + fmtDateTime(r.remindAt) : '',
      remainingText: fmtRemaining(ts - now),
    };
  });
}

function fmtRemaining(ms) {
  if (!ms || ms <= -60000) return '即将触发';
  const min = Math.round(ms / 60000);
  if (min <= 0) return '即将触发';
  if (min < 60) return `${min} 分钟后`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时后`;
  const day = Math.floor(hour / 24);
  return `${day} 天后`;
}

Page({
  data: {
    family: null,
    myOpenid: '',
    myNick: '我',
    members: [], // [{ openid, nick, me }]
    reminders: [], // [{ _id, todoId, content, timeText, remainingText }]
    loading: true,
    editingNick: false,
    nickInput: '',
  },

  onShow() {
    // 首屏秒显：先用当前全局数据/本地缓存立即渲染，不等云函数返回（避免空白）
    const cachedFamily = app.globalData.family || wx.getStorageSync('myFamily');
    const cachedOpenid = app.globalData.openid || wx.getStorageSync('myOpenid');
    if (cachedFamily && cachedOpenid) {
      this.setData({ ...buildView(cachedFamily, cachedOpenid), loading: false });
    }
    // 后台静默拉一次最新家庭数据覆盖，保证成员/昵称是最新的
    this.load();
  },

  async load() {
    try {
      const data = await getMyFamily();
      const { family, openid } = data;
      if (!family) {
        // 确认真实无家庭：清缓存回引导页
        this.clearCache(app.globalData.family && app.globalData.family._id);
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      app.globalData.openid = openid;
      app.globalData.family = family;
      // 缓存，下次进入无需等云函数
      wx.setStorageSync('myFamily', family);
      wx.setStorageSync('myOpenid', openid);
      this.setData({ ...buildView(family, openid), loading: false });
      this.loadReminders();
    } catch (e) {
      // 网络失败但已有缓存时保留缓存内容，不打断浏览
      if (!this.data.family) this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  async loadReminders() {
    try {
      const data = await getMyReminders();
      this.setData({ reminders: buildReminders(data.reminders) });
    } catch (e) {
      // 拉取失败不影响本页其它内容
    }
  },

  onCancelReminder(e) {
    const { id, todoId } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消提醒',
      content: '确定取消这条待办的提醒吗？',
      confirmColor: '#FF6F5E',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          await cancelReminder(id, todoId);
          await this.loadReminders();
          wx.hideLoading();
          wx.showToast({ title: '已取消', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        }
      },
    });
  },

  clearCache(fid) {
    wx.removeStorageSync('myFamily');
    wx.removeStorageSync('myOpenid');
    if (fid) wx.removeStorageSync('todos_' + fid);
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.family.inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
    });
  },

  onEditNick() {
    this.setData({ nickInput: this.data.myNick || '', editingNick: true });
  },

  onCancelNick() {
    this.setData({ editingNick: false, nickInput: '' });
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value });
  },

  async onSaveNick() {
    const nick = (this.data.nickInput || '').trim();
    if (!nick) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    try {
      await updateNickname(nick);
      // 刷新拿到最新成员昵称（含其它成员的更新）
      await this.load();
      wx.hideLoading();
      this.setData({ editingNick: false, nickInput: '' });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  onLeave() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后你将不再看到共享清单。确定吗？',
      confirmColor: '#FF7A59',
      success: (res) => {
        if (res.confirm) this.doLeave();
      },
    });
  },

  async doLeave() {
    wx.showLoading({ title: '处理中' });
    try {
      await leaveFamily();
      wx.hideLoading();
      app.globalData.family = null;
      wx.removeStorageSync('familyId');
      // 清掉本家庭待办缓存与本页家庭缓存，避免退出后仍显示旧数据
      const fid = this.data.family && this.data.family._id;
      this.clearCache(fid);
      wx.showToast({ title: '已退出', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },
});
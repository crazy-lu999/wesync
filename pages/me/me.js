// pages/me/me.js
const { getMyFamily, leaveFamily } = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    family: null,
    myOpenid: '',
    myNick: '我',
    members: [], // [{ openid, nick, me }]
    loading: true,
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const data = await getMyFamily();
      const { family, openid } = data;
      if (!family) {
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      app.globalData.openid = openid;
      app.globalData.family = family;
      const memberNicks = family.memberNicks || {};
      const myNick = memberNicks[openid] || '我';
      const members = (family.members || []).map((o) => ({
        openid: o,
        nick: memberNicks[o] || '成员',
        me: o === openid,
      }));
      this.setData({ family, myOpenid: openid, myNick, members, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.family.inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
    });
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
      // 清掉本家庭待办缓存，避免退出后仍显示旧数据
      const fid = this.data.family && this.data.family._id;
      if (fid) wx.removeStorageSync('todos_' + fid);
      wx.showToast({ title: '已退出', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },
});

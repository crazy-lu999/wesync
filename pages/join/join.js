// pages/join/join.js
const { joinFamily } = require('../../utils/db.js');
const { buildShare } = require('../../utils/share.js');
const app = getApp();

Page({
  data: {
    inviteCode: '',
    myNick: '',
    submitting: false,
    preFilled: false, // 是否通过分享卡片带入邀请码
  },

  onLoad(options) {
    // 分享卡片/朋友圈带码进来：自动填入邀请码，用户只起个昵称即可加入
    const code = String((options && options.inviteCode) || '').trim();
    if (/^\d{6}$/.test(code)) {
      this.setData({ inviteCode: code, preFilled: true });
    }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    let val = e.detail.value;
    if (field === 'inviteCode') {
      val = val.replace(/\D/g, '').slice(0, 6);
    }
    this.setData({ [field]: val });
  },

  async onSubmit() {
    const inviteCode = (this.data.inviteCode || '').trim();
    const myNick = (this.data.myNick || '').trim() || '我';
    if (!/^\d{6}$/.test(inviteCode)) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '加入中' });
    try {
      const data = await joinFamily(inviteCode, myNick);
      wx.hideLoading();
      app.globalData.openid = data.openid;
      wx.showToast({ title: '加入成功', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' });
      }, 600);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '加入失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  // 转发给朋友/朋友圈：统一品牌卡，引导新用户建自己的小家
  onShareAppMessage() {
    return buildShare();
  },

  onShareTimeline() {
    return buildShare();
  },
});

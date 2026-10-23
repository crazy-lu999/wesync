// pages/create/create.js
const { createFamily } = require('../../utils/db.js');
const { buildShare } = require('../../utils/share.js');
const app = getApp();

Page({
  data: {
    myNick: '',
    submitting: false,
    result: null, // { inviteCode, familyId }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
  },

  async onSubmit() {
    const myNick = (this.data.myNick || '').trim() || '我';
    this.setData({ submitting: true });
    wx.showLoading({ title: '创建中' });
    try {
      const data = await createFamily(myNick);
      wx.hideLoading();
      this.setData({ result: data });
      // 预填 globalData，回到 index 后会自动开 watch
      app.globalData.openid = data.openid;
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.result.inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
    });
  },

  backHome() {
    // 重新拉取家庭并回到首页
    wx.reLaunch({ url: '/pages/index/index' });
  },

  // 转发给朋友：统一品牌卡，引导新用户建自己的小家（分享诉求只有拉新家庭）
  onShareAppMessage() {
    return buildShare();
  },

  onShareTimeline() {
    return buildShare();
  },
});

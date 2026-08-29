// pages/create/create.js
const { createFamily } = require('../../utils/db.js');
const app = getApp();

Page({
  data: {
    familyName: '我们的家',
    myNick: '',
    submitting: false,
    result: null, // { inviteCode, familyId }
  },

  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
  },

  async onSubmit() {
    const familyName = (this.data.familyName || '').trim() || '我们的家';
    const myNick = (this.data.myNick || '').trim() || '我';
    this.setData({ submitting: true });
    wx.showLoading({ title: '创建中' });
    try {
      const data = await createFamily(familyName, myNick);
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
});

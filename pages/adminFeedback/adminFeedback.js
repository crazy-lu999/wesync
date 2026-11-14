// pages/adminFeedback/adminFeedback.js — 反馈管理（仅开发者本人）
// 权限：入口仅对开发者 openid 显示；页面加载后仍由云函数 adminFeedback 二次校验，
// 非开发者即使手动打开本页也读不到任何数据。
const { adminListFeedback, adminMarkFeedbackRead, adminDeleteFeedback } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');

Page({
  data: {
    loading: true,
    denied: false,
    list: [],
    unread: 0,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
      const d = await adminListFeedback();
      const list = (d.list || []).map((it) => ({
        id: it.id,
        content: it.content,
        read: !!it.read,
        timeText: fmtTime(it.createdAt) || '时间未知',
        userSuffix: it.userSuffix || '',
      }));
      this.setData({
        loading: false,
        denied: false,
        list,
        unread: list.filter((x) => !x.read).length,
      });
    } catch (e) {
      const msg = e.message || '加载失败';
      const denied = msg.indexOf('无权') >= 0;
      this.setData({ loading: false, denied, list: [], unread: 0 });
      if (!denied) wx.showToast({ title: msg, icon: 'none' });
    }
  },

  async onMarkRead(e) {
    const id = e.currentTarget.dataset.id;
    const idx = this.data.list.findIndex((x) => x.id === id);
    if (idx < 0 || this.data.list[idx].read) return;
    try {
      await adminMarkFeedbackRead(id);
      const list = this.data.list.slice();
      list[idx] = { ...list[idx], read: true };
      this.setData({ list, unread: list.filter((x) => !x.read).length });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条反馈？',
      content: '删除后无法恢复。',
      confirmColor: '#F0413B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await adminDeleteFeedback(id);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'none' });
          this.load();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 长按反馈内容复制，方便保存或跟进
  onCopy(e) {
    const content = e.currentTarget.dataset.content || '';
    if (!content) return;
    wx.setClipboardData({ data: content });
  },
});

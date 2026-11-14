// pages/wall/wall.js — 意见反馈（私有通道）
//
// 说明：本页已从「公开建议墙」改为「私密意见反馈」。
// 不展示任何用户内容，没有公开列表、点赞、回复、发动态等社交互动；
// 用户提交的内容只会写入云端数据库，由开发者单独查看，不会公开给其他用户。
// （文件路径沿用旧命名，页面语义与线上功能均不含公开社区能力。）
const { submitFeedback } = require('../../utils/db.js');
const config = require('../../utils/config.js');

Page({
  data: {
    input: '',
    max: config.FEEDBACK_MAX_LEN,
    submitting: false,
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const content = (this.data.input || '').trim();
    if (!content) {
      wx.showToast({ title: '先写下你的想法吧', icon: 'none' });
      return;
    }
    if (content.length > this.data.max) {
      wx.showToast({ title: `反馈最多 ${this.data.max} 字`, icon: 'none' });
      return;
    }

    // 提交前轻确认：不强调“公开/不公开”，用更亲密的说法
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '把想法告诉我们？',
        content: '确定把这条想法送给我们吗？',
        confirmText: '发送',
        cancelText: '再想想',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });
    try {
      await submitFeedback(content);
      this.setData({ input: '', submitting: false });
      wx.hideLoading();
      wx.showModal({
        title: '已收到 💛',
        content: '谢谢你的想法，我会认真看。',
        showCancel: false,
        confirmText: '好的',
      });
    } catch (e) {
      this.setData({ submitting: false });
      wx.hideLoading();
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },
});

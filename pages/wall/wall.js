// pages/wall/wall.js — 建议墙（全平台公开）
// 顶部：开发者发版动态（type=update）；下方：所有用户建议（带状态/回复，本人高亮）。
// 底部固定提交框；开发账户额外获得管理能力（标记状态/回复/删除/发动态）。
const { listWall, submitFeedback, wallSetStatus, wallReply, wallDelete, wallPostUpdate } = require('../../utils/db.js');
const config = require('../../utils/config.js');
const app = getApp();

const STATUS_TEXT = { new: '已收录', doing: '进行中', done: '已上线' };
const STATUS_ORDER = ['new', 'doing', 'done'];

function fmtTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

Page({
  data: {
    loading: true,
    updates: [],        // 开发者发版动态
    suggestions: [],    // 用户建议
    allSug: [],         // 完整建议（未按“只看我的”过滤），供切换复用
    showMine: false,    // 只看我提的
    input: '',
    max: config.FEEDBACK_MAX_LEN,
    isAdmin: false,
    myOpenid: '',
    myNick: '我的',
    myAvatar: '',
    statusText: STATUS_TEXT,
    // 管理态
    postOpen: false,
    postInput: '',
    manageDrafts: {},   // 各建议的回复草稿 { [id]: text }
    targetId: null,     // 当前要回复的建议 id
  },

  onLoad() {
    const openid = app.globalData.openid || wx.getStorageSync('myOpenid');
    const family = app.globalData.family || wx.getStorageSync('myFamily');
    const myNick = ((family && family.memberNicks && family.memberNicks[openid]) || '我的');
    const myAvatar = (family && family.memberAvatars && family.memberAvatars[openid]) || '';
    this.setData({
      myOpenid: openid || '',
      isAdmin: openid === config.ADMIN_OPENID,
      myNick,
      myAvatar,
    });
    this.load();
  },

  onShow() {
    if (this.data.myOpenid) this.load();
  },

  async load() {
    try {
      const d = await listWall();
      const updates = [];
      const suggestions = [];
      let latestUpdateShown = false;
      (d.list || []).forEach((it) => {
        const row = { ...it, timeText: fmtTime(it.createdAt) };
        // 只展示最近一条版本动态；其它全部进建议列表
        if (it.type === 'update') {
          if (!latestUpdateShown) { updates.push(row); latestUpdateShown = true; }
          return;
        }
        suggestions.push(row);
      });
      this.setData({ updates, allSug: suggestions, suggestions, loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // —— 提交建议 ——
  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  // 头像加载失败：清掉该条 avatar，回退显示首字母圆标（同步 allSug 与 suggestions 两套缓存）
  onSugAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const patch = {};
    const a = (this.data.allSug || []).findIndex((x) => x.id === id);
    if (a >= 0 && this.data.allSug[a].avatar) patch[`allSug[${a}].avatar`] = '';
    const s = (this.data.suggestions || []).findIndex((x) => x.id === id);
    if (s >= 0 && this.data.suggestions[s].avatar) patch[`suggestions[${s}].avatar`] = '';
    if (Object.keys(patch).length) this.setData(patch);
  },
  async onSubmit() {
    const content = (this.data.input || '').trim();
    if (!content) {
      wx.showToast({ title: '先写下你的想法吧', icon: 'none' });
      return;
    }
    if (content.length > this.data.max) {
      wx.showToast({ title: `建议最多 ${this.data.max} 字`, icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交中' });
    try {
      await submitFeedback(content, this.data.myNick, this.data.myAvatar);
      this.setData({ input: '' });
      wx.hideLoading();
      wx.showToast({ title: '已收到，谢谢建议 💛', icon: 'none' });
      this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },

  // —— “只看我提的”过滤 ——
  onToggleMine() {
    const showMine = !this.data.showMine;
    this.setData({
      showMine,
      suggestions: showMine ? this.data.allSug.filter((x) => x.isMine) : this.data.allSug,
    });
  },

  // —— 〔管理〕标记状态（循环切换）——
  async onStatusTap(e) {
    const id = e.currentTarget.dataset.id;
    const cur = e.currentTarget.dataset.status;
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
    wx.showLoading({ title: '更新中' });
    try {
      await wallSetStatus(id, next);
      wx.hideLoading();
      wx.showToast({ title: STATUS_TEXT[next], icon: 'none' });
      this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // —— 〔管理〕点“回复”进入该条回复编辑 ——
  onStartReply(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ targetId: id });
  },
  onReplyInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`manageDrafts.${id}`]: e.detail.value });
  },
  async onSaveReply(e) {
    const id = e.currentTarget.dataset.id;
    const reply = (this.data.manageDrafts[id] || '').trim();
    if (!reply) {
      wx.showToast({ title: '写点回复吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发布中' });
    try {
      await wallReply(id, reply);
      this.setData({ targetId: null });
      wx.hideLoading();
      wx.showToast({ title: '已回复', icon: 'success' });
      this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '回复失败', icon: 'none' });
    }
  },

  // —— 〔管理〕删除 ——
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这条？',
      content: '将从建议墙永久移除。',
      confirmColor: '#F0413B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await wallDelete(id);
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

  // —— 〔管理〕发布一条发版动态 ——
  onTogglePost() {
    this.setData({ postOpen: !this.data.postOpen, postInput: '' });
  },
  onPostInput(e) {
    this.setData({ postInput: e.detail.value });
  },
  async onPostSubmit() {
    const content = (this.data.postInput || '').trim();
    if (!content) {
      wx.showToast({ title: '写点内容吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发布中' });
    try {
      await wallPostUpdate(content);
      this.setData({ postOpen: false, postInput: '' });
      wx.hideLoading();
      wx.showToast({ title: '动态已发布 🎉', icon: 'none' });
      this.load();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '发布失败', icon: 'none' });
    }
  },

  // 顶部固定提交框的聚焦态：避免底部输入框被键盘顶飞
  onFocus() {},
});
// pages/notes/notes.js — 我们的记录（随笔 / 待办转的记录）
//
// 笔记与待办是「同一条 todos 集合 + 同一个 watch」，只是一条数据上打了 isNote:true 标记。
// 这里复用 utils/db 的 getMyTodos + subscribeTodos，按 isNote 过滤出笔记展示；
// 增删改照旧的云函数 todoOps，实时同步与成员权限规则完全沿用待办那套。
// 首页待办的「转为记录」也进这里，和本页「写一条」是同一类数据，互相同步可见。
const { getMyTodos, addTodo, editTodo, removeTodo, convertTodo, subscribeTodos } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');
const config = require('../../utils/config.js');
const app = getApp();

const NOTE_MAX = config.NOTE_MAX_LEN || 200;

Page({
  data: {
    loading: true,
    notes: [],
    composing: false, // 写/编辑的输入态
    editingId: '',    // 空 = 新建；有值 = 编辑
    input: '',
    inputFocus: false,
    noteMax: NOTE_MAX,
  },

  onShow() {
    // 每次进入都拉起最新（含对方刚转/刚写的）
    this.load();
    this.startWatch();
  },

  onHide() {
    this.stopWatch();
  },

  onUnload() {
    this.stopWatch();
  },

  // 读共享数据，按 isNote 过滤出笔记
  async load() {
    try {
      const d = await getMyTodos();
      this.setData({ notes: this.pickNotes(d.todos || []), loading: false });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  pickNotes(list) {
    return (list || [])
      .filter((t) => t.isNote)
      .map((t) => ({
        ...t,
        mine: (t.creatorOpenid || '') === (this.data.myOpenid || app.globalData.openid),
        timeText: (t.done && t.doneTimeText) ? t.doneTimeText : fmtTime(t.createTime),
      }));
  },

  // 与首页一致的实时推送；只取 isNote 的条目
  startWatch() {
    const familyId = this.data.familyId || (app.globalData.family && app.globalData.family._id);
    if (!familyId) { this.load(); return; } // 没有家庭则退回轮询式加载
    this._familyId = familyId;
    this.setData({ familyId });
    this._watchClose = subscribeTodos(
      familyId,
      (todos) => {
        const notes = this.pickNotes(todos || []);
        // 保持编辑态时别把正在输入的内容刷掉（对方改动只刷新列表）
        this.setData({ notes, loading: false });
      },
      () => { /* watch 失败自动退化为手动刷新/下拉，不打断使用 */ }
    );
  },

  stopWatch() {
    if (this._watchClose) {
      const close = this._watchClose;
      this._watchClose = null;
      try { close(); } catch (e) { /* 连接已断，忽略 */ }
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  // —— 写 / 编辑 ——
  onComposeTap() {
    if (this.data.composing) this.onCancelCompose();
    else this.onCompose();
  },

  onCompose() {
    this.setData({ composing: true, editingId: '', input: '', inputFocus: false });
    wx.nextTick(() => this.setData({ inputFocus: true }));
  },

  onCancelCompose() {
    this.setData({ composing: false, editingId: '', input: '', inputFocus: false });
  },

  onEditNote(e) {
    const id = e.currentTarget.dataset.id;
    const n = this.data.notes.find((x) => x._id === id);
    if (!n) return;
    this.setData({ composing: true, editingId: id, input: n.content || '', inputFocus: false });
    wx.nextTick(() => this.setData({ inputFocus: true }));
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async onSave() {
    const content = (this.data.input || '').trim();
    if (!content) { wx.showToast({ title: '写点内容吧', icon: 'none' }); return; }
    if (content.length > NOTE_MAX) { wx.showToast({ title: `最多 ${NOTE_MAX} 字`, icon: 'none' }); return; }
    const familyId = this.data.familyId || (app.globalData.family && app.globalData.family._id);
    const openid = this.data.myOpenid || app.globalData.openid;
    // 昵称取家庭成员表（与首页署名来源一致）
    const memberNicks = (app.globalData.family && app.globalData.family.memberNicks) || {};
    const nick = memberNicks[openid] || '我';
    wx.showLoading({ title: '保存中' });
    try {
      if (this.data.editingId) {
        await editTodo(this.data.editingId, content, '');
        this.suppressLocal(this.data.editingId);
      } else {
        await addTodo(familyId, content, openid, nick, '', true); // isNote=true
      }
      wx.hideLoading();
      this.setData({ composing: false, editingId: '', input: '', inputFocus: false });
      await this.load();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  // —— 长按菜单：转回待办 / 删除 ——
  onNoteLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const n = this.data.notes.find((x) => x._id === id);
    if (!n) return;
    wx.showActionSheet({
      itemList: ['✏️ 编辑', '↩️ 转回待办', '🗑️ 删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.onEditNote(e);
        else if (res.tapIndex === 1) this.onBackToTodo(id);
        else if (res.tapIndex === 2) this.onDeleteNote(id);
      },
    });
  },

  // 笔记 → 待办：清掉 isNote 标记，回到首页待办列表
  onBackToTodo(id) {
    wx.showModal({
      title: '转回待办？',
      content: '这条会回到首页的待办清单里。',
      confirmText: '转回',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await convertTodo(id, false);
          this.suppressLocal(id);
          this.setData({ notes: this.data.notes.filter((x) => x._id !== id) });
          wx.showToast({ title: '已转回待办', icon: 'none' });
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败', icon: 'none' });
        }
      },
    });
  },

  onDeleteNote(id) {
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复。',
      confirmColor: '#F0413B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await removeTodo(id);
          wx.hideLoading();
          this.setData({ notes: this.data.notes.filter((x) => x._id !== id) });
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 自己刚下手过的条目，短暂不播报（本页无播报条，仅为衔接预留；watch 刷新时无害）
  suppressLocal(id) { /* 预留：暂无播报，保持接口对称 */ },

  goBack() {
    wx.navigateBack();
  },

  onShareAppMessage() {
    return {
      title: '我们的记录 💕',
      path: '/pages/notes/notes',
    };
  },
});
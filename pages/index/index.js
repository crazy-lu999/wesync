// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, toggleTodo, removeTodo } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');
const app = getApp();

Page({
  data: {
    loading: true,
    hasFamily: false,
    family: null,
    myOpenid: '',
    myNick: '我',
    todos: [],
    inputVal: '',
    pollTimer: null,
    subscribing: false,
    activeCount: 0,
    doneCount: 0,
  },

  onLoad() {
    this.loadFamily();
  },

  onShow() {
    // 从 create/join 返回时刷新家庭
    if (app.globalData.family !== this.data.family) {
      this.loadFamily();
    }
    // 重新开始轮询
    if (this.data.hasFamily) this.startPoll();
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopPoll();
  },

  async loadFamily() {
    try {
      const data = await getMyFamily();
      const openid = data.openid;
      const family = data.family;
      app.globalData.openid = openid;
      app.globalData.family = family;

      if (family) {
        const myNick = (family.memberNicks && family.memberNicks[openid]) || '我';
        this.setData({ loading: false, hasFamily: true, family, myOpenid: openid, myNick });
        wx.setStorageSync('familyId', family._id);
        this.startPoll();
      } else {
        this.stopPoll();
        wx.removeStorageSync('familyId');
        this.setData({ loading: false, hasFamily: false, family: null, todos: [], myOpenid: openid });
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // 定时轮询拉取待办（绕开安全规则 UI）。单位秒
  startPoll() {
    this.stopPoll();
    this.fetchTodos();
    this.setData({ subscribing: true });
    this.data.pollTimer = setInterval(() => this.fetchTodos(), 5000);
  },

  stopPoll() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.data.pollTimer = null;
    }
  },

  async fetchTodos() {
    try {
      const data = await getMyTodos();
      this.renderTodos(data.todos || []);
      this.setData({ subscribing: true });
    } catch (e) {
      this.setData({ subscribing: false });
    }
  },

  renderTodos(todos) {
    const mapped = todos.map((t) => ({
      ...t,
      timeText: fmtTime(t.createTime),
      mine: t.creatorOpenid === this.data.myOpenid,
    }));
    mapped.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    const doneCount = mapped.filter((t) => t.done).length;
    this.setData({ todos: mapped, doneCount, activeCount: mapped.length - doneCount });
  },

  closeWatch() {
    this.stopPoll();
    this.setData({ subscribing: false });
  },

  onInput(e) {
    this.setData({ inputVal: e.detail.value });
  },

  async onAdd() {
    const content = (this.data.inputVal || '').trim();
    if (!content) return;
    this.setData({ inputVal: '' });
    wx.showLoading({ title: '添加中' });
    try {
      await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '添加失败', icon: 'none' });
    }
  },

  async onToggle(e) {
    const { id, index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    const done = !todo.done;
    // 乐观更新：先改本地，失败回滚
    const prev = this.data.todos.slice();
    this.applyToggle(index, done);
    try {
      await toggleTodo(id, done);
    } catch (err) {
      this.setData({ todos: prev });
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  applyToggle(index, done) {
    const todos = this.data.todos.slice();
    todos[index] = { ...todos[index], done };
    todos.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    const doneCount = todos.filter((t) => t.done).length;
    this.setData({ todos, doneCount, activeCount: todos.length - doneCount });
  },

  onLongPress(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除待办',
      content: '确定删除这条吗？',
      success: (res) => {
        if (res.confirm) this.doRemove(id);
      },
    });
  },

  async doRemove(id) {
    wx.showLoading({ title: '删除中' });
    try {
      await removeTodo(id);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/join' });
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/me' });
  },
});

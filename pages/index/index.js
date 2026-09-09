// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, toggleTodo, removeTodo, subscribeTodos } = require('../../utils/db.js');
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
    watchClose: null,
    subscribing: false,
    syncMode: 'poll', // 'realtime' 实时推送 | 'poll' 轮询兜底
    todosReady: false, // 首次从服务端拉到待办后才置 true（用于区分真假空态）
    activeCount: 0,
    doneCount: 0,
  },

  onShow() {
    // 从 create/join 返回时刷新家庭
    if (app.globalData.family !== this.data.family) {
      this.loadFamily();
    }
    // 有家庭则开启同步
    if (this.data.hasFamily) this.syncStart();
  },

  onHide() {
    this.syncStop();
  },

  onUnload() {
    this.syncStop();
  },

  onLoad() {
    this.loadFamily();
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
        // 先用本地缓存立即可见，避免等云函数返回时空白（首屏秒显）
        const cached = wx.getStorageSync('todos_' + family._id) || [];
        if (cached.length) this.renderTodos(cached);
        this.setData({ loading: false, hasFamily: true, family, myOpenid: openid, myNick, todosReady: !!cached.length });
        wx.setStorageSync('familyId', family._id);
        this.syncStart();
      } else {
        this.syncStop();
        wx.removeStorageSync('familyId');
        this.setData({ loading: false, hasFamily: false, family: null, todos: [], myOpenid: openid });
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // 同步策略：实时推送为主，失败自动降级轮询（永不中断）
  syncStart() {
    const familyId = this.data.family && this.data.family._id;
    if (!familyId) return;
    this.syncStop();
    this.setData({ subscribing: true, syncMode: 'realtime' });
    this.fetchTodos(); // 立即拉一次，保证首屏
    this.watchClose = subscribeTodos(
      familyId,
      (todos) => {
        this.renderTodos(todos || []);
        this.setData({ syncMode: 'realtime' });
      },
      (err) => {
        // watch 不可用（未开通实时推送/未配读规则）→ 降级为轮询
        console.warn('[sync] watch 不可用，降级为轮询', err);
        this.setData({ syncMode: 'poll' });
        this.startPoll();
      }
    );
  },

  syncStop() {
    if (this.watchClose) {
      try { this.watchClose(); } catch (e) { /* ignore */ }
      this.watchClose = null;
    }
    this.stopPoll();
    this.setData({ subscribing: false });
  },

  startPoll() {
    this.stopPoll();
    this.data.pollTimer = setInterval(() => this.fetchTodos(), 3000);
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
      this.setData({ todosReady: true });
      // 缓存本次服务端快照，下次进入秒显
      const familyId = this.data.family && this.data.family._id;
      if (familyId) wx.setStorageSync('todos_' + familyId, data.todos || []);
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
    // 未完成在前，同类按创建时间倒序
    mapped.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ta = a.createTime ? +new Date(a.createTime) : 0;
      const tb = b.createTime ? +new Date(b.createTime) : 0;
      return tb - ta;
    });
    const doneCount = mapped.filter((t) => t.done).length;
    this.setData({ todos: mapped, doneCount, activeCount: mapped.length - doneCount });
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
      this.fetchTodos(); // 立刻刷新，自己的新任务零延迟出现
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
      this.fetchTodos(); // 立刻对齐服务端真实状态
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
      this.fetchTodos(); // 立刻刷新，删除零延迟生效
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

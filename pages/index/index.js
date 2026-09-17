// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, toggleTodo, editTodo, removeTodo, subscribeTodos } = require('../../utils/db.js');
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
    // 编辑态
    editing: false,
    editingId: '',
    inputFocus: false,
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
    if (this.data.editing) {
      await this.saveEdit(content);
      return;
    }
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

  // 行内按钮：编辑（直接进入编辑态，输入框回填已有内容再聚焦）
  onEnterEdit(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    // 先把 value 写进 input，再 nextTick 聚焦，避免微信 input 的 value 与
    // focus 同帧 setData 时 value 被吞，导致看不到已有内容/像是在“追加”。
    this.setData({
      editing: true,
      editingId: todo._id,
      inputVal: todo.content || '',
      inputFocus: false,
    });
    const that = this;
    wx.nextTick(() => that.setData({ inputFocus: true }));
  },

  // 行内按钮：删除（用 wx 原生确认弹框）
  onDeleteTodo(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    wx.showModal({
      title: '删除待办',
      content: `确定删除「${todo.content}」吗？删除后不可恢复。`,
      confirmText: '删除',
      confirmColor: '#FF4D3D',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await removeTodo(todo._id);
          this.fetchTodos(); // 立刻刷新，删除零延迟生效
          wx.hideLoading();
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        }
      },
    });
  },


  // 取消编辑
  cancelEdit() {
    this.setData({ editing: false, editingId: '', inputVal: '', inputFocus: false });
  },

  async saveEdit(content) {
    wx.showLoading({ title: '保存中' });
    try {
      await editTodo(this.data.editingId, content);
      this.cancelEdit();
      this.fetchTodos(); // 立刻刷新，编辑零延迟可见
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
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

// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, toggleTodo, editTodo, removeTodo, setRemind, subscribeTodos } = require('../../utils/db.js');
const { fmtTime, fmtDateTime } = require('../../utils/format.js');
const { REMIND_TMPL_ID } = require('../../utils/config.js');
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
    // 长按操作面板
    menuVisible: false,
    menuId: '', // 当前长按选中的待办 id
    menuContent: '', // 待办摘要，用于删除确认预览
    confirmDelete: false, // 面板切到删除确认态
    // 编辑态
    editing: false,
    editingId: '',
    inputFocus: false,
    // 提醒面板（对长按选中的待办设置提醒）
    remindPanel: false,
    remindTodoId: '',
    remindDate: '',
    remindTime: '09:00',
    selectedRemindOn: false, // 当前选中待办是否已有提醒（决定菜单项文案）
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
      remindText: t.remindAt ? ('🔔 ' + fmtDateTime(t.remindAt)) : '',
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

  // —— 提醒（对长按选中的待办设置/取消）——
  _pad(n) { return n < 10 ? '0' + n : '' + n; },
  // 请求一次性订阅授权，返回用户是否接受
  requestSubscribe() {
    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [REMIND_TMPL_ID],
        success: (res) => {
          // 打印完整返回，便于排查模板/授权问题
          console.log('[subscribe] res=', res);
          resolve(res[REMIND_TMPL_ID] === 'accept');
        },
        fail: (err) => {
          // 把完整 errMsg 打出来，方便定位（如模板无效、类目不符等）
          console.error('[subscribe] fail=', err);
          resolve(false);
        },
      });
    });
  },
  // 菜单项：打开提醒面板（若该待办已设提醒，则回填原时间）
  openRemindPanel() {
    const todo = this.data.todos.find((t) => t._id === this.data.menuId);
    if (!todo) return;
    let date = '';
    let time = '09:00';
    if (todo.remindAt) {
      const d = new Date(todo.remindAt);
      if (!isNaN(d.getTime())) {
        date = `${d.getFullYear()}-${this._pad(d.getMonth() + 1)}-${this._pad(d.getDate())}`;
        time = `${this._pad(d.getHours())}:${this._pad(d.getMinutes())}`;
      }
    }
    if (!date) {
      const now = new Date();
      date = `${now.getFullYear()}-${this._pad(now.getMonth() + 1)}-${this._pad(now.getDate())}`;
    }
    this.setData({
      menuVisible: false,
      menuId: '',
      menuContent: todo.content || '', // 供提醒面板预览显示待办内容
      confirmDelete: false,
      remindPanel: true,
      remindTodoId: todo._id,
      remindDate: date,
      remindTime: time,
    });
  },
  closeRemindPanel() {
    this.setData({ remindPanel: false, remindTodoId: '' });
  },
  onRemindDateChange(e) { this.setData({ remindDate: e.detail.value }); },
  onRemindTimeChange(e) { this.setData({ remindTime: e.detail.value }); },
  // 面板确认：先请求订阅授权，成功才写入提醒
  async confirmRemind() {
    const t = new Date(`${this.data.remindDate} ${this.data.remindTime}:00`).getTime();
    if (isNaN(t)) {
      wx.showToast({ title: '时间无效', icon: 'none' });
      return;
    }
    const accept = await this.requestSubscribe();
    if (!accept) {
      wx.showToast({ title: '未授权订阅消息，无法提醒', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '设置中' });
    try {
      await setRemind(this.data.remindTodoId, t);
      this.closeRemindPanel();
      this.fetchTodos();
      wx.hideLoading();
      wx.showToast({ title: '已设置提醒', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '设置失败', icon: 'none' });
    }
  },
  onMenuRemind() {
    if (this.data.selectedRemindOn) this.onMenuUnRemind();
    else this.openRemindPanel();
  },
  // 菜单项：取消当前待办的提醒
  async onMenuUnRemind() {
    const id = this.data.menuId;
    this.closeMenu();
    wx.showLoading({ title: '取消中' });
    try {
      await setRemind(id, '');
      this.fetchTodos();
      wx.hideLoading();
      wx.showToast({ title: '已取消提醒', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '取消失败', icon: 'none' });
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
    const todo = this.data.todos.find((t) => t._id === id);
    this.setData({
      menuId: id,
      menuContent: todo ? todo.content : '',
      menuVisible: true,
      selectedRemindOn: !!(todo && todo.remindAt),
    });
  },

  // —— 底部操作面板 ——
  closeMenu() {
    this.setData({ menuVisible: false, menuId: '', menuContent: '', confirmDelete: false });
  },

  noop() {},

  // 菜单：编辑
  onMenuEdit() {
    const todo = this.data.todos.find((t) => t._id === this.data.menuId);
    this.setData({
      menuVisible: false,
      confirmDelete: false,
      editing: true,
      editingId: this.data.menuId,
      inputVal: todo ? todo.content : '',
      inputFocus: true,
    });
  },

  // 菜单：删除 → 面板内二段式确认
  onMenuDelete() {
    this.setData({ confirmDelete: true });
  },

  // 确认删除：真正执行
  async confirmRemove() {
    const id = this.data.menuId;
    this.closeMenu();
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

// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, editTodo, toggleTodo, removeTodo, setImportant, clearDoneTodos, subscribeTodos, renameFamily } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');
const config = require('../../utils/config.js');
const app = getApp();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    totalDone: 0, // 你们一起累计完成的件数（里程碑）
    syncTip: '', // 语义化同步提示（TA 刚完成了…）
    templates: config.TODO_TEMPLATES,
    undoLabel: '', // 删除/清空的撤销提示条文案
    // 编辑态
    editing: false,
    editingId: '',
    inputFocus: false,
    // 撒花庆祝
    celebrate: false,
    petals: [],
    // 家庭名编辑
    editingFamName: false,
    famNameInput: '',
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
        this.setData({ loading: false, hasFamily: true, family, myOpenid: openid, myNick, todosReady: !!cached.length, totalDone: (family && family.totalDone) || 0 });
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
        const list = todos || [];
        this.announceChanges(list);
        this.renderTodos(list);
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
      const list = data.todos || [];
      if (this._inited) this.announceChanges(list);
      this.renderTodos(list);
      this._inited = true;
      this.setData({ todosReady: true });
      // 缓存本次服务端快照，下次进入秒显
      const familyId = this.data.family && this.data.family._id;
      if (familyId) wx.setStorageSync('todos_' + familyId, data.todos || []);
    } catch (e) {
      this.setData({ subscribing: false });
    }
  },

  // 语义化同步提示：对比上一份快照，把对方(非我本人)的动作转化为一句话提示
  announceChanges(todos) {
    if (!this._inited) return;
    const myOpenid = this.data.myOpenid;
    const prev = this._prevTodos || {};
    const emoji = { add: '➕', done: '🎉', undo: '↩️', edit: '✏️', important: '⭐' };
    for (const t of todos) {
      const id = t._id;
      if (this._suppressed && this._suppressed[id] && Date.now() < this._suppressed[id]) continue;
      const mine = t.creatorOpenid && t.creatorOpenid === myOpenid;
      const isOther = !mine;
      const old = prev[id];
      const nick = t.creatorNick || 'TA';
      if (!old && isOther) this.showSyncTip(`${emoji.add} ${nick} 添加了「${t.content}」`);
      else if (old && isOther) {
        if (!old.done && t.done) this.showSyncTip(`${emoji.done} ${nick} 完成了「${t.content}」`);
        else if (old.done && !t.done) this.showSyncTip(`${emoji.undo} 恢复了「${t.content}」`);
        else if (!old.important && t.important) this.showSyncTip(`${emoji.important} ${nick} 把「${t.content}」标为重要`);
        else if (old.content !== t.content) this.showSyncTip(`${emoji.edit} ${nick} 编辑了「${t.content}」`);
      }
    }
  },

  renderTodos(todos) {
    const mapped = todos.map((t) => ({
      ...t,
      timeText: fmtTime(t.createTime),
      doneTimeText: fmtTime(t.doneTime),
      mine: t.creatorOpenid === this.data.myOpenid,
    }));
    // 未完成在前（重要未完成再优先）；已完成沉底，同类按创建时间倒序
    mapped.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.done && (a.important !== b.important)) return a.important ? -1 : 1;
      const ta = a.createTime ? +new Date(a.createTime) : 0;
      const tb = b.createTime ? +new Date(b.createTime) : 0;
      return tb - ta;
    });
    const doneCount = mapped.filter((t) => t.done).length;
    this.setData({ todos: mapped, doneCount, activeCount: mapped.length - doneCount });
    // 记录本次快照，供 announceChanges 做同源对比
    this._prevTodos = {};
    mapped.forEach((t) => { this._prevTodos[t._id] = { done: !!t.done, content: t.content, important: !!t.important }; });
  },

  // 顶部的短暂同步事件提示条
  showSyncTip(text) {
    this.setData({ syncTip: text });
    if (this._syncTipTimer) clearTimeout(this._syncTipTimer);
    this._syncTipTimer = setTimeout(() => this.setData({ syncTip: '' }), 2600);
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

  // 空态一键填入示例模板
  async useTemplate(e) {
    const content = (e.currentTarget.dataset.content || '').trim();
    if (!content) return;
    wx.showLoading({ title: '添加中' });
    try {
      await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick);
      this.fetchTodos();
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '添加失败', icon: 'none' });
    }
  },

  // 点击圆形勾选：切换完成状态（完成=标记，保留在列表并计入"已完成"，不删除）+ 撒花庆祝
  async onToggle(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    const becomingDone = !todo.done;
    const prev = this.data.todos.slice();
    // 乐观更新：先"原位"标记完成（不排序），让完成动画在这条卡片上原位播完
    this.setLocallyDone(todo._id, becomingDone);
    try {
      const r = (await toggleTodo(todo._id, becomingDone)) || {};
      this.suppressChange(todo._id);
      // 完成：等完成动画（划线/缩放/勾选弹出）播完后，再把该条沉到列表底部
      if (becomingDone) {
        await sleep(480);
        this.sinkDone();
      }
      this.fetchTodos(); // 对齐服务端（早已按状态排好序，无额外视觉跳动）
      if (becomingDone) { // 仅在"完成"时庆祝
        wx.vibrateShort({ type: 'light' });
        this.showCelebrate();
      }
      // 里程碑：一起完成累计件数到 10/50/100… 时弹一次庆祝
      if (becomingDone) {
        const total = r.totalDone || 0;
        if (total) {
          this.setData({ totalDone: total });
          if (config.DONE_MILESTONES.includes(total)) this.showMilestone(total);
        }
      }
    } catch (err) {
      this.setData({ todos: prev, doneCount: prev.filter((t) => t.done).length, activeCount: prev.filter((t) => !t.done).length });
      wx.showToast({ title: becomingDone ? '完成失败，请重试' : '恢复失败，请重试', icon: 'none' });
    }
  },

  // 本地仅切换完成状态（不排序，让完成动画原位播放）
  setLocallyDone(id, done) {
    const todos = this.data.todos.slice();
    const t = todos.find((x) => x._id === id);
    if (!t) return;
    t.done = done;
    const doneCount = todos.filter((x) => x.done).length;
    this.setData({ todos, doneCount, activeCount: todos.length - doneCount });
  },

  // 排序规则：未完成在前（重要优先），已完成沉底，同类按创建时间倒序
  sortTodos(arr) {
    return arr.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.done && (a.important !== b.important)) return a.important ? -1 : 1;
      const ta = a.createTime ? +new Date(a.createTime) : 0;
      const tb = b.createTime ? +new Date(b.createTime) : 0;
      return tb - ta;
    });
  },

  // 完成动画结束后，把已完成的统一沉到列表底部
  sinkDone() {
    const todos = this.sortTodos(this.data.todos);
    const doneCount = todos.filter((x) => x.done).length;
    this.setData({ todos, doneCount, activeCount: todos.length - doneCount });
  },

  // 长按弹出二级菜单：重要 / 编辑 / 删除
  onTodoLongPress(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    const markLabel = todo.important ? '⭐ 取消重要' : '⭐ 设为重要';
    wx.showActionSheet({
      itemList: [markLabel, '✏️ 编辑', '🗑️ 删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.onToggleImportant(e);
        else if (res.tapIndex === 1) this.onEnterEdit(e);
        else if (res.tapIndex === 2) this.onDeleteTodo(e);
      },
    });
  },

  // 标记/取消重要
  async onToggleImportant(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    const imp = !todo.important;
    const prev = this.data.todos.slice();
    this.setImportantLocal(todo._id, imp);
    try {
      await setImportant(todo._id, imp);
      this.suppressChange(todo._id);
      this.fetchTodos();
      wx.showToast({ title: imp ? '已设为重要' : '已取消重要', icon: 'none' });
    } catch (err) {
      this.setData({ todos: prev, doneCount: prev.filter((t) => t.done).length, activeCount: prev.filter((t) => !t.done).length });
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  setImportantLocal(id, imp) {
    const todos = this.data.todos.slice();
    const t = todos.find((x) => x._id === id);
    if (t) t.important = imp;
    this.renderTodos(todos);
  },

  // 一键清空已完成（5 秒内可撤销）
  onClearDone() {
    const doneItems = this.data.doneCount;
    if (!doneItems) return;
    wx.showModal({
      title: '清空已完成',
      content: `将清空 ${doneItems} 条已完成待办，5 秒内可撤销。`,
      confirmText: '清空',
      confirmColor: '#FF4D3D',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return;
        const removed = this.removeLocally((t) => t.done);
        if (!removed.length) return;
        wx.vibrateShort({ type: 'light' });
        this.startUndo({
          removed,
          label: `已清空 ${removed.length} 条已完成`,
          proc: clearDoneTodos,
        });
      },
    });
  },

  // —— 撤销机制 ——
  // 从列表临时移除（删除/清空时先隐藏，供撤销恢复），返回被移除的条目
  removeLocally(predicate) {
    const todos = this.data.todos.slice();
    const removed = todos.filter(predicate);
    const rest = todos.filter((t) => !predicate(t));
    const doneCount = rest.filter((t) => t.done).length;
    this.setData({ todos: rest, doneCount, activeCount: rest.length - doneCount });
    return removed;
  },

  // 开始一个 5 秒的撤销窗口；超时后真正执行删除
  startUndo({ removed, label, proc }) {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    this._undo = { removed, proc };
    this.setData({ undoLabel: label });
    this._undoTimer = setTimeout(() => this.fireUndoAction(), 5000);
  },

  // 点「撤销」：恢复被移除的条目
  onUndo() {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const u = this._undo;
    this._undo = null;
    this.setData({ undoLabel: '' });
    if (!u || !u.removed.length) return;
    const todos = this.data.todos.concat(u.removed);
    this.renderTodos(todos);
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  // 撤销窗口结束：真正删除并刷新
  async fireUndoAction() {
    const u = this._undo;
    this._undo = null;
    this._undoTimer = null;
    this.setData({ undoLabel: '' });
    if (!u) return;
    this.suppressAll(u.removed);
    try {
      if (u.proc) await u.proc();
    } catch (e) { console.error('[undo] 执行失败', e); }
    this.fetchTodos();
  },

  // 为即将真正删除的条目做同步静默，避免撤销条被播报成"对方删除"
  suppressAll(removed) {
    if (!this._suppressed) this._suppressed = {};
    removed.forEach((t) => { this._suppressed[t._id] = Date.now() + 2500; });
  },

  // 里程碑庆祝：达到 10/50/100… 一起完成时首次弹窗
  showMilestone(n) {
    const key = 'celebratedMiles';
    const done = wx.getStorageSync(key) || [];
    if (done.includes(n)) return;
    done.push(n);
    wx.setStorageSync(key, done);
    wx.showModal({
      title: `🎉 一起完成了 ${n} 件小事`,
      content: '每天一点点，都是我们共同的记忆。继续加油呀！',
      showCancel: false,
      confirmText: '太棒了',
      confirmColor: '#FF7A59',
    });
  },

  // 记录：下面这个 id 的动作是我自己发起的，短时间内的同步提示不再播报
  suppressChange(id) {
    if (!this._suppressed) this._suppressed = {};
    this._suppressed[id] = Date.now() + 2500;
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

  // 删除（5 秒内可撤销）
  onDeleteTodo(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    wx.showModal({
      title: '删除待办',
      content: `确定删除「${todo.content}」吗？5 秒内可撤销。`,
      confirmText: '删除',
      confirmColor: '#FF4D3D',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return;
        const removed = this.removeLocally((t) => t._id === todo._id);
        if (!removed.length) return;
        wx.vibrateShort({ type: 'light' });
        this.startUndo({
          removed,
          label: `已删除「${todo.content}」`,
          proc: () => removeTodo(todo._id),
        });
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
      this.suppressChange(this.data.editingId);
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

  // —— 家庭名改名 ——
  onEditFamName() {
    this.setData({ famNameInput: this.data.family ? this.data.family.name : '', editingFamName: true });
  },
  onCancelFamName() {
    this.setData({ editingFamName: false, famNameInput: '' });
  },
  onFamNameInput(e) {
    this.setData({ famNameInput: e.detail.value });
  },
  async onSaveFamName() {
    const name = (this.data.famNameInput || '').trim().slice(0, 20);
    if (!name) {
      wx.showToast({ title: '名称不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    try {
      await renameFamily(name);
      const fresh = await getMyFamily();
      app.globalData.family = fresh.family;
      this.setData({ family: fresh.family, editingFamName: false, famNameInput: '' });
      wx.hideLoading();
      wx.showToast({ title: '已改名', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  goJoin() {
    wx.navigateTo({ url: '/pages/join/join' });
  },

  goMe() {
    wx.navigateTo({ url: '/pages/me/me' });
  },

  // —— 撒花庆祝动画 ——
  showCelebrate() {
    const emojis = ['🌸', '🎉', '✨', '💐', '🌷', '🌟', '💫'];
    const N = 30;
    const petals = [];
    for (let i = 0; i < N; i++) {
      petals.push({
        left: Math.random() * 100,               // 水平位置 %
        size: 24 + Math.random() * 30,           // 花瓣大小 rpx
        dur: 1.1 + Math.random() * 0.9,          // 上升时长 s
        delay: Math.random() * 0.3,              // 延迟 s
        drift: Math.random() * 40 - 20,          // 水平漂移 rpx
        rotStart: Math.random() * 360,           // 初始旋转角 deg
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
      });
    }
    this.setData({ celebrate: true, petals });
    // 动画结束后隐藏
    if (this._celebrateTimer) clearTimeout(this._celebrateTimer);
    this._celebrateTimer = setTimeout(() => this.setData({ celebrate: false }), 1800);
  },

  // 阻止庆祝层滚动穿透
  noop() {},
});

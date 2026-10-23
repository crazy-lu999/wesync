// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, editTodo, toggleTodo, removeTodo, setImportant, assignTodo, clearDoneTodos, subscribeTodos } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');
const { buildShare } = require('../../utils/share.js');
const config = require('../../utils/config.js');
const app = getApp();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 版本号字符串 "1.2.3" → [1,2,3]；非数字片段按 0 处理
function parseVersion(v) {
  return String(v == null || v === '' ? '0' : v)
    .split('.')
    .map((s) => parseInt(s, 10) || 0);
}
// 方向化比较：仅当「远端(server) 严格比本地(local) 新」时返回 true。
// 相等或本地更新都视为无需提醒，避免升级到最新后横幅残留。
function isNewerVersion(server, local) {
  const a = parseVersion(server);
  const b = parseVersion(local);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false; // 版本号相等
}

// 冷/热启动回首页重新做一次「远端版本校验」的最小间隔（毫秒）。
// 只在较短时间内连续 onShow 时防抖，避免打爆云函数；
// 但保证每次真正意义上的热启动(间隔超过该值)都会重新判定，能感知挂后台期间的新发版。
const UPDATE_CHECK_GAP = 30 * 1000;

// 今天（本地日期，YYYY-MM-DD），用于日期选择的 start 下限，禁止选过去的日子
const todayStr = (() => {
  const n = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
})();

// —— 每天一句窝心话：按一年中的第几天取一条，整天稳定、两人看到一致 ——
const WARM = config.WARM_PHRASES || [];
function dailyWarm() {
  if (!WARM.length) return '';
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const idx = Math.floor((now - start) / 86400000) % WARM.length;
  return WARM[idx];
}

// —— 纪念日（可多个，各含标题+日期）——
// 归一化家庭里的纪念日为列表（兼容老单值 anniversary）
function normAnnivs(family) {
  if (!family) return [];
  if (Array.isArray(family.anniversaries) && family.anniversaries.length) {
    return family.anniversaries.map((a) => ({
      id: a.id,
      title: ((a.title || '').trim()) || '纪念日',
      date: String(a.date || ''),
    }));
  }
  if (family.anniversary) return [{ id: 'legacy-1', title: '我们的纪念日', date: String(family.anniversary) }];
  return [];
}
// 距最近一个周年的天数
function nextAnnivDays(date) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date || ''));
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), mo - 1, d);
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}
// 聚合：找出最近一场纪念日，拼成「距离 X 还有 N 天」/「今天就是 X 🎉」
function buildAnnivInfo(family) {
  const list = normAnnivs(family).filter((a) => a.date);
  if (!list.length) return { nextLabel: '' };
  let best = null; // { title, days }
  list.forEach((a) => {
    const days = nextAnnivDays(a.date);
    if (days == null) return;
    if (!best || days < best.days) best = { title: a.title, days };
  });
  if (!best) return { nextLabel: '' };
  const label = best.days === 0
    ? `今天就是「${best.title}」🎉`
    : `距离「${best.title}」还有 ${best.days} 天`;
  return { nextLabel: label };
}

// —— 这周（含今天往前 6 天）一起完成的件数，用于“周小结” ——
function countWeeklyDone(todos) {
  const now = new Date();
  const start7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  let n = 0;
  (todos || []).forEach((t) => {
    if (!t.done || !t.doneTime) return;
    const d = new Date(t.doneTime);
    if (isNaN(d.getTime())) return;
    if (d >= start7 && d <= now) n++;
  });
  return n;
}

// 一次性截止日期 → 剩余天数可视化信息。返回 null 表示未标记日期。
function calcDeadline(deadline) {
  if (!deadline) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(deadline);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(y, mo - 1, d);
  const days = Math.round((target - today) / 86400000);
  const label = `${mo}月${d}日`;
  let text, state;
  if (days < 0) { state = 'past'; text = `已过 ${-days} 天`; }
  else if (days === 0) { state = 'today'; text = '就是今天 🎉'; }
  else if (days === 1) { state = 'soon'; text = '明天就到啦'; }
  else if (days <= 7) { state = 'soon'; text = `还有 ${days} 天 · 快到了`; }
  else { state = 'normal'; text = `还有 ${days} 天`; }
  return { days, label, text, state };
}

// 摘要成一行文案（用于输入栏 chip：如「8月5日 · 还有 3 天」）
function deadlineChipText(deadline) {
  const info = calcDeadline(deadline);
  return info ? `${info.label} · ${info.text}` : (deadline || '');
}

Page({
  data: {
    loading: true,
    offline: false, // 断网/云端异常时回退本地缓存，并提示可重试
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
    weeklyDone: 0, // 这周一起完成的件数（周小结）
    dailyPhrase: '', // 今天的一句窝心话
    annivInfo: { nextLabel: '' }, // 最近一场纪念日倒计时
    assignFor: '', // 新建待办指派给谁（openid，空=两人一起）
    assignForText: '👥 一起', // 底部指派 chip 文案
    syncTip: '', // 语义化同步提示（TA 刚完成了…）
    showUpdateBanner: false, // 有新版本时显示顶部横幅
    templates: config.TODO_TEMPLATES,
    inputDeadline: '', // 新建/编辑时标记的一次性截止日期 YYYY-MM-DD
    inputDeadlineText: '', // 同上的倒计时文案（如 8月5日 · 还有 3 天）
    today: todayStr,    // 日期选择的下限（今天），禁止选过去的日子
    undoLabel: '', // 删除/清空的撤销提示条文案
    // 编辑态
    editing: false,
    editingId: '',
    inputFocus: false,
    // 撒花庆祝
    celebrate: false,
    petals: [],
  },

  onShow() {
    // 每次回到首页都检查一次（冷启动 & 热启动都能感知新版），发现新版本即显示顶部横幅
    this.checkLatestVersion();
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

  // 转发给朋友/朋友圈：统一品牌卡，引导新用户建自己的小家
  onShareAppMessage() {
    return buildShare();
  },

  onShareTimeline() {
    return buildShare();
  },

  // 判断是否有新版本。冷启动 & 热启动都会走这里，双保险：
  //  ① wx.getUpdateManager 自动判断（app.js 只注册一次，结果写 globalData.hasUpdate）——主治常规；
  //  ② 兜底：查 app_config 最新版本号，用「远端确实比本地新」做方向化比较——覆盖“从旧版一直挂后台、
  //     期间发版、从不重新冷启动”这类 hasUpdate 可能没点亮的热启动极端场景。
  checkLatestVersion() {
    // 若冷启动已弹过升级弹窗（onUpdateReady），首页横幅让位，避免重复提醒
    if (app.globalData.updateDialogShown) {
      this.setData({ showUpdateBanner: false });
      return;
    }
    // 铁桶兜底：按 UPDATE_CHECK_GAP 防抖地查一次云配置。
    // 不用一次性 _versionChecked，保证每次热启动(超过间隔)都能重新判定新发版。
    const now = Date.now();
    if (!this._cfCheckAt || now - this._cfCheckAt >= UPDATE_CHECK_GAP) {
      this._cfCheckAt = now;
      this.checkLatestVersionRemote();
    }
    // 即时同步 getUpdateManager 的判定结果（冷/热启动都反映）
    this.setData({ showUpdateBanner: !!app.globalData.hasUpdate });
  },

  // 云函数兜底校验：只把「远端比本地新」视为有新版；
  // 本地已升级到最新时主动收起横幅，避免“版本升级完横幅还在”的残留。
  checkLatestVersionRemote() {
    wx.cloud
      .callFunction({ name: 'getLatestVersion' })
      .then((r) => {
        const latest = (r && r.result && r.result.data && r.result.data.version) || '';
        const newer = isNewerVersion(latest, config.APP_VERSION);
        // 任一来源判定有新版即视为有新版；都不满足则收起横幅
        app.globalData.hasUpdate = !!app.globalData.hasUpdate || newer;
        this.setData({ showUpdateBanner: !!app.globalData.hasUpdate });
      })
      .catch((e) => console.warn('[update] 版本兜底检查失败', e));
  },

  // 点横幅：二级菜单引导更新。
  // 微信没有“当场重启”，更新只在「下次冷启动」生效；
  // 所以点横幅先给用户选择，选了更新后再按“新版是否已下载完成”拆分两种反馈。
  onRestart2Update() {
    wx.showActionSheet({
      itemList: ['🎁 去更新（退出后生效）', '稍后再说'],
      success: (res) => {
        if (res.tapIndex !== 0) return; // 0 = 去更新
        this.doUpdateNow();
      },
      fail: () => { /* 用户取消，不处理 */ },
    });
  },

  // 真正执行更新：按“新版是否已下载完成”给两种诚实反馈。
  doUpdateNow() {
    const ready = !!app.globalData.updateReady; // app.js 在 onUpdateReady 时置 true
    const um = wx.getUpdateManager ? wx.getUpdateManager() : null;

    // 无论下载好没，先 applyUpdate 让微信记下“下次冷启动用新版”（若下载中它稍后也会生效）
    if (um) {
      try { um.applyUpdate(); } catch (e) { /* ignore */ }
    }

    if (ready) {
      // 新版已下载完成：自动帮用户退出小程序 → 用户重进即冷启动 → 新版生效
      wx.showModal({
        title: '新版就绪 🎁',
        content: '新版已经下载好啦，\n点“确定”我会帮你退出小程序，\n重新打开就是最新版啦 ❤️',
        showCancel: false,
        confirmText: '好，帮我退出',
        success: () => {
          // 真正退出（不是返回键），重进即冷启动应用新版
          if (wx.exitMiniProgram) {
            try { wx.exitMiniProgram({}); } catch (e) { /* ignore */ }
          }
        },
      });
    } else {
      // 新版还在下载：这时硬退出去也看不到新版，如实引导
      wx.showModal({
        title: '新版还在路上 🚚',
        content: '等下载好后，先退出小程序，\n去微信「最近使用」列表把它划掉，\n下次进入就会自动用上新版啦～',
        showCancel: false,
        confirmText: '好嘞',
      });
    }
  },

  // 首次进入：先用本地缓存（全局/存储）立即渲染并关 loading，避免"一直加载再跳出来"的体验；
  // 同时后台静默拉取最新家庭信息 + 开启实时同步，保证成员/昵称/照片/里程碑都是最新的。
  async loadFamily() {
    // ① 首屏秒显：有缓存家庭就直接渲染并置 loading=false，不等云函数
    const cachedFamily = app.globalData.family || wx.getStorageSync('myFamily');
    const cachedOpenid = app.globalData.openid || wx.getStorageSync('myOpenid');
    if (cachedFamily && cachedOpenid) {
      const myNick = (cachedFamily.memberNicks && cachedFamily.memberNicks[cachedOpenid]) || '我';
      const annivInfo = buildAnnivInfo(cachedFamily);
      const cachedTodos = wx.getStorageSync('todos_' + cachedFamily._id) || [];
      app.globalData.openid = cachedOpenid;
      app.globalData.family = cachedFamily;
      wx.setStorageSync('familyId', cachedFamily._id);
      // 先写家庭/mynick 再渲染缓存待办，避免命中 old family 导致昵称/指派徽标闪错
      this.setData({ loading: false, offline: false, hasFamily: true, family: cachedFamily, myOpenid: cachedOpenid, myNick, todosReady: !!cachedTodos.length, totalDone: (cachedFamily && cachedFamily.totalDone) || 0, annivInfo, dailyPhrase: dailyWarm() });
      if (cachedTodos.length) this.renderTodos(cachedTodos);
      // 后台静默刷新：拉最新家庭 + 开启实时同步（失败自动回退本地缓存，不打断浏览）
      this.loadFromCloud();
      return;
    }
    // ② 无缓存：走云端加载
    await this.loadFromCloud();
  },

  // 从云端拉取家庭并开启同步。①缓存首屏场景下后台静默调用；②无缓存场景下 await 阻塞加载。
  async loadFromCloud() {
    try {
      const data = await getMyFamily();
      const openid = data.openid;
      const family = data.family;
      app.globalData.openid = openid;
      app.globalData.family = family;
      // 缓存家庭，下次进入直接秒显
      if (family) {
        wx.setStorageSync('myFamily', family);
        wx.setStorageSync('myOpenid', openid);
      }

      if (family) {
        const myNick = (family.memberNicks && family.memberNicks[openid]) || '我';
        // 亲密区：纪念日天数 + 每日窝心话
        const annivInfo = buildAnnivInfo(family);
        // 先用本地缓存立即可见，避免等云函数返回时空白（首屏秒显）
        const cached = wx.getStorageSync('todos_' + family._id) || [];
        this.setData({ loading: false, offline: false, hasFamily: true, family, myOpenid: openid, myNick, todosReady: !!cached.length, totalDone: (family && family.totalDone) || 0, annivInfo, dailyPhrase: dailyWarm() });
        if (cached.length) this.renderTodos(cached);
        wx.setStorageSync('familyId', family._id);
        this.syncStart();
      } else {
        this.syncStop();
        wx.removeStorageSync('familyId');
        // 确认真实无家庭：清缓存，避免下次误以为有家庭
        wx.removeStorageSync('myFamily');
        wx.removeStorageSync('myOpenid');
        this.setData({ loading: false, offline: false, hasFamily: false, family: null, todos: [], myOpenid: openid, annivInfo: { nextLabel: '' } });
      }
    } catch (e) {
      // 网络/云端异常：若本地有缓存家庭，回退展示缓存，避免把有家庭用户误引到"创建家庭"空状态
      const cachedFamily = app.globalData.family || wx.getStorageSync('myFamily');
      if (cachedFamily) {
        const cachedOpenid = app.globalData.openid || wx.getStorageSync('myOpenid');
        const openid = cachedOpenid || '';
        const myNick = (cachedFamily.memberNicks && cachedFamily.memberNicks[openid]) || '我';
        const annivInfo = buildAnnivInfo(cachedFamily);
        const cachedTodos = wx.getStorageSync('todos_' + cachedFamily._id) || [];
        app.globalData.openid = openid;
        app.globalData.family = cachedFamily;
        wx.setStorageSync('familyId', cachedFamily._id);
        this.setData({ loading: false, offline: true, hasFamily: true, family: cachedFamily, myOpenid: openid, myNick, todosReady: !!cachedTodos.length, totalDone: (cachedFamily && cachedFamily.totalDone) || 0, annivInfo, dailyPhrase: dailyWarm() });
        if (cachedTodos.length) this.renderTodos(cachedTodos);
        this.syncStart(); // watch 失败会自动降级轮询，网络恢复后能拉到最新
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    }
  },

  // 离线提示条：点了重新拉取一次家庭数据
  onRetryLoad() {
    wx.showLoading({ title: '重试中', mask: true });
    this.loadFamily()
      .catch(() => {})
      .finally(() => wx.hideLoading());
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
    const nicks = (this.data.family && this.data.family.memberNicks) || {};
    const my = this.data.myOpenid;
    const mapped = todos.map((t) => ({
      ...t,
      timeText: fmtTime(t.createTime),
      doneTimeText: fmtTime(t.doneTime),
      mine: t.creatorOpenid === my,
      dayInfo: calcDeadline(t.deadline),
      // 指派徽标：assignedToMe → 我用我的配色；否则显示对方昵称
      assignNick: t.assignee ? (nicks[t.assignee] || 'TA') : '',
      assignToMe: !!t.assignee && t.assignee === my,
    }));
    // 未完成在前（重要>临近7天>普通），已完成沉底；同类按创建时间倒序
    mapped.sort((a, b) => this.cmpTodos(a, b));
    const doneCount = mapped.filter((t) => t.done).length;
    const weeklyDone = countWeeklyDone(mapped); // 周小结
    this.setData({ todos: mapped, doneCount, activeCount: mapped.length - doneCount, weeklyDone });
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

  // 选/清截止日期
  onPickDeadline(e) {
    const v = e.detail.value || '';
    this.setData({ inputDeadline: v, inputDeadlineText: deadlineChipText(v) });
  },
  onClearDeadline() {
    this.setData({ inputDeadline: '', inputDeadlineText: '' });
  },

  async onAdd() {
    const content = (this.data.inputVal || '').trim();
    if (!content) return;
    if (this.data.editing) {
      await this.saveEdit(content);
      return;
    }
    const deadline = this.data.inputDeadline; // 先取日期，再清空状态
    const assignee = this.data.assignFor;      // 指派成员（openid）
    this.setData({ inputVal: '', inputDeadline: '', inputDeadlineText: '', assignFor: '', assignForText: '👥 一起' });
    wx.showLoading({ title: '添加中' });
    try {
      await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick, deadline, assignee);
      this.fetchTodos(); // 立刻刷新，自己的新任务零延迟出现
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '添加失败', icon: 'none' });
    }
  },

  // 底部「指派给谁」chip：在成员里选一个指定执行人
  onPickAssign() {
    const mems = (this.data.family && this.data.family.memberNicks) || {};
    const me = this.data.myOpenid;
    const opts = [{ label: '👥 一起做（不指派）', val: '' }];
    opts.push({ label: `给我（${this.data.myNick}）`, val: me });
    Object.keys(mems).forEach((o) => {
      if (o !== me) opts.push({ label: `给 ${mems[o]}`, val: o });
    });
    wx.showActionSheet({
      itemList: opts.map((o) => o.label),
      success: (res) => {
        if (res.tapIndex < 0) return;
        const c = opts[res.tapIndex];
        this.setData({ assignFor: c.val, assignForText: c.label });
      },
      fail: () => { /* 取消 */ },
    });
  },

  // 空态一键填入示例模板
  async useTemplate(e) {
    const content = (e.currentTarget.dataset.content || '').trim();
    if (!content) return;
    wx.showLoading({ title: '添加中' });
    try {
      await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick, '', this.data.assignFor);
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

  // 排序规则：未完成在前（重要优先，其次临近7天的日子），已完成沉底，同类按创建时间倒序
  sortTodos(arr) {
    return arr.slice().sort((a, b) => this.cmpTodos(a, b));
  },

  cmpTodos(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) {
      const pa = this.todoPriority(a);
      const pb = this.todoPriority(b);
      if (pa !== pb) return pa - pb;
    }
    const ta = a.createTime ? +new Date(a.createTime) : 0;
    const tb = b.createTime ? +new Date(b.createTime) : 0;
    return tb - ta;
  },

  // 未完成待办的优先级：重要 > 临近7天 > 普通
  todoPriority(t) {
    if (t.important) return 0;
    const d = t.dayInfo && t.dayInfo.days;
    if (d != null && d >= 0 && d <= 7) return 1;
    return 2;
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
      itemList: [markLabel, '👤 指派给谁', '✏️ 编辑', '🗑️ 删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.onToggleImportant(e);
        else if (res.tapIndex === 1) this.onAssignTodo(e);
        else if (res.tapIndex === 2) this.onEnterEdit(e);
        else if (res.tapIndex === 3) this.onDeleteTodo(e);
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

  // 长按菜单：指派给谁（openid，空=两人一起）——乐观更新 + 云端落库
  async onAssignTodo(e) {
    const { index } = e.currentTarget.dataset;
    const todo = this.data.todos[index];
    if (!todo) return;
    const mems = (this.data.family && this.data.family.memberNicks) || {};
    const me = this.data.myOpenid;
    const opts = [{ label: '👥 一起做（取消指派）', val: '' }];
    opts.push({ label: `给我（${this.data.myNick}）`, val: me });
    Object.keys(mems).forEach((o) => {
      if (o !== me) opts.push({ label: `给 ${mems[o]}`, val: o });
    });
    wx.showActionSheet({
      itemList: opts.map((o) => o.label),
      success: async (res) => {
        if (res.tapIndex < 0) return;
        const assignee = opts[res.tapIndex].val;
        const prev = this.data.todos.slice();
        // 乐观更新旧先本地反映
        this.renderTodos(prev.map((t) => (t._id === todo._id ? { ...t, assignee } : t)));
        try {
          await assignTodo(todo._id, assignee);
          this.suppressChange(todo._id);
          this.fetchTodos();
          wx.showToast({ title: assignee ? '已指派' : '已取消指派', icon: 'none' });
        } catch (err) {
          this.renderTodos(prev);
          wx.showToast({ title: '操作失败，请重试', icon: 'none' });
        }
      },
    });
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
        this.startUndo({ removed, proc: clearDoneTodos });
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

  // 开始一个 5 秒的撤销窗口；窗口内再次删除/清空会**并入同一队列**，
  // 一次撤销即可全部恢复，超时后统一真正删除（避免前一条"丢失"导致待办复活）
  startUndo({ removed, proc }) {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const pending = (this._undo && this._undo.pending) || [];
    removed.forEach((t) => pending.push({ todo: t, proc }));
    this._undo = { pending };
    const n = pending.length;
    this.setData({ undoLabel: `已移除 ${n} 条，5 秒内可撤销` });
    this._undoTimer = setTimeout(() => this.fireUndoAction(), 5000);
  },

  // 点「撤销」：恢复所有待撤销的条目
  onUndo() {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    const u = this._undo;
    this._undo = null;
    this._undoTimer = null;
    this.setData({ undoLabel: '' });
    if (!u || !u.pending || !u.pending.length) return;
    const restored = u.pending.map((p) => p.todo);
    const todos = this.data.todos.concat(restored);
    this.renderTodos(todos);
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  // 撤销窗口结束：真正删除并刷新
  async fireUndoAction() {
    const u = this._undo;
    this._undo = null;
    this._undoTimer = null;
    this.setData({ undoLabel: '' });
    if (!u || !u.pending || !u.pending.length) return;
    // 待真正删除的条目做同步静默，避免被播报成"对方删除"
    this.suppressAll(u.pending.map((p) => p.todo));
    // 去重执行各 proc：clearDoneTodos 是同一个函数引用只执行一次；
    // removeTodo 每个是独立闭包，天然一条一个，无需去重
    const procSet = new Set();
    u.pending.forEach((p) => { if (p.proc) procSet.add(p.proc); });
    try {
      for (const proc of procSet) await proc();
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
      inputDeadline: todo.deadline || '',
      inputDeadlineText: deadlineChipText(todo.deadline || ''),
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
        this.startUndo({ removed, proc: () => removeTodo(todo._id) });
      },
    });
  },


  // 取消编辑
  cancelEdit() {
    this.setData({ editing: false, editingId: '', inputVal: '', inputDeadline: '', inputDeadlineText: '', inputFocus: false });
  },

  async saveEdit(content) {
    wx.showLoading({ title: '保存中' });
    try {
      await editTodo(this.data.editingId, content, this.data.inputDeadline);
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

// pages/index/index.js
const { getMyFamily, getMyTodos, addTodo, editTodo, toggleTodo, removeTodo, setImportant, clearDoneTodos, convertTodo, subscribeTodos, requestTodoReminder } = require('../../utils/db.js');
const { fmtTime } = require('../../utils/format.js');
const { buildShare } = require('../../utils/share.js');
const { getLocalRelease } = require('../../utils/release-notes.js');
const config = require('../../utils/config.js');
const app = getApp();

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

// —— 同步兜底参数 ——
// watch 不可用时的轮询节奏。以前是写死的 3 秒一次 getMyTodos 云函数：既卡（每次都 setData
// 全量列表）又费额度，网络差时请求还会叠在一起。
const POLL_INTERVAL = 10 * 1000;
const POLL_MAX_INTERVAL = 60 * 1000;
// watch 失败后隔多久再试一次实时推送（次数用完就一直轮询，不再刷日志）。
// 这是「有限重试时刻表」，不是无限重连：权限问题重连多少次都没用。
const WATCH_RETRY_DELAYS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
// 本地刚勾选/取消后，本地状态在快照里被确认前的最长保护时间（毫秒）。
// 云函数往返通常 <1s，留 5s 足够；超时则回归服务端值，不至于永远说谎。
const OPTIMISTIC_TTL = 5000;

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

// 把提醒时刻（epoch 毫秒）格式化成「M月D日 HH:MM」；空返回空串
function fmtRemind(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    subscribing: false,
    syncMode: 'poll', // 'realtime' 实时推送 | 'poll' 轮询兜底
    todosReady: false, // 首次从服务端拉到待办后才置 true（用于区分真假空态）
    activeCount: 0,
    doneCount: 0,
    totalDone: 0, // 你们一起累计完成的件数（里程碑）
    weeklyDone: 0, // 这周一起完成的件数（周小结）
    noteCount: 0, // 已存笔记条数（首页「我们的记录」入口展示）
    dailyPhrase: '', // 今天的一句窝心话
    annivInfo: { nextLabel: '' }, // 最近一场纪念日倒计时
    syncTip: '', // 语义化同步提示（TA 刚完成了…）
    showUpdateBanner: false, // 有新版本时显示顶部横幅
    templates: config.TODO_TEMPLATES,
    inputRemindDate: '', // 新建/编辑时选的提醒日期 YYYY-MM-DD
    inputRemindTime: '', // 提醒时间 HH:MM（提醒日期 + 该时刻 = 到点推送）
    today: todayStr,    // 日期选择的下限（今天），禁止选过去的日子
    undoLabel: '', // 删除/清空的撤销提示条文案
    kbHeight: 0, // 键盘高度（px）：编辑面板/输入栏往上顶，保证「保存」按钮不被键盘遮住
    // 提醒授权引导
    showRemindGuide: false, // 首页顶部引导条：开启微信提醒
    remindNeedAuth: true, // 是否还没授权过提醒（用于输入区提示）
    // 编辑态
    editing: false,
    editingId: '',
    inputFocus: false,
    // 版本更新弹窗（自定义，保证更新点左对齐）
    releaseModal: {
      visible: false,
      mode: 'notes',
      title: '',
      version: '',
      notes: [],
      tip: '',
    },
    // 撒花庆祝
    celebrate: false,
    petals: [],
  },

  onShow() {
    // 每次回到首页都检查一次（冷启动 & 热启动都能感知新版），发现新版本即显示顶部横幅
    this.checkLatestVersion();
    // 刷新提醒授权引导（用户可能刚在「我的」页授权过）
    this.refreshRemindGuide();
    // 从 create/join 返回时刷新家庭
    if (app.globalData.family !== this.data.family) {
      this.loadFamily();
    }
    // 有家庭则开启同步（syncStart 内部幂等，重复调用不会重复订阅）
    if (this.data.hasFamily) this.syncStart();
  },

  onHide() {
    this.syncStop();
    if (this.data.kbHeight) this.setData({ kbHeight: 0 });
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
    // 更新后的「本次更新」说明：每个版本只弹一次
    this.maybeShowReleaseNotes();
  },

  // 云函数兜底校验：只把「远端比本地新」视为有新版；
  // 本地已升级到最新时主动收起横幅，避免“版本升级完横幅还在”的残留。
  checkLatestVersionRemote() {
    wx.cloud
      .callFunction({ name: 'getLatestVersion' })
      .then((r) => {
        const d = (r && r.result && r.result.data) || {};
        const latest = d.version || '';
        // 缓存云端更新说明，供「旧版横幅」点开时预览
        if (latest) {
          const release = {
            version: latest,
            title: d.title || '',
            notes: Array.isArray(d.notes) ? d.notes : [],
            releasedAt: d.releasedAt || '',
          };
          this._remoteRelease = release;
          app.globalData.latestRelease = release;
        }
        const newer = isNewerVersion(latest, config.APP_VERSION);
        // 任一来源判定有新版即视为有新版；都不满足则收起横幅
        app.globalData.hasUpdate = !!app.globalData.hasUpdate || newer;
        this.setData({ showUpdateBanner: !!app.globalData.hasUpdate });
        // 若本地兜底没有说明，这里还能用云端 notes 补一次
        this.maybeShowReleaseNotes();
      })
      .catch((e) => console.warn('[update] 版本兜底检查失败', e));
  },

  // 新版本启动后弹一次「本次更新」说明：
  // 首次安装只记录版本不打扰；同一版本只弹一次；没有配置说明就安静跳过。
  maybeShowReleaseNotes() {
    const current = config.APP_VERSION;
    const last = wx.getStorageSync('lastVersion');
    if (!last) {
      // 首次安装：只记录版本，不打扰；老用户升级上来则继续走更新说明
      const existingUser = !!wx.getStorageSync('myOpenid');
      if (!existingUser) {
        wx.setStorageSync('lastVersion', current);
        return;
      }
    } else if (last === current) {
      return;
    }
    // 优先用云端同版本说明；没有则用本地兜底
    const remote = this._remoteRelease || app.globalData.latestRelease || null;
    const release = (remote && remote.version === current && remote.notes && remote.notes.length)
      ? remote
      : getLocalRelease(current);
    // 没有说明时先不记版本，等云端说明补齐后下次还能弹
    if (!release || !release.notes || !release.notes.length) return;
    // 写入版本，避免同一个版本重复弹
    wx.setStorageSync('lastVersion', current);
    this.openReleaseModal('notes', release);
  },

  // 打开自定义版本更新弹窗（mode: notes=已更新说明，update=旧版横幅引导更新）
  openReleaseModal(mode, release) {
    const notes = ((release && release.notes) || [])
      .filter((x) => typeof x === 'string' && x.trim())
      .slice(0, 8);
    if (!notes.length) return false;
    this.setData({
      releaseModal: {
        visible: true,
        mode,
        title: (release && release.title) || (mode === 'update' ? '有新版本啦' : '这次更新'),
        version: (release && release.version) || '',
        notes,
        tip: mode === 'update' ? '重启后生效，要现在更新吗？' : '',
      },
    });
    return true;
  },

  onCloseReleaseModal() {
    this.setData({ 'releaseModal.visible': false });
  },

  onConfirmUpdate() {
    this.setData({ 'releaseModal.visible': false });
    this.doUpdateNow();
  },

  // 点横幅：二级菜单引导更新。
  // 微信没有“当场重启”，更新只在「下次冷启动」生效；
  // 所以点横幅先给用户选择，选了更新后再按“新版是否已下载完成”拆分两种反馈。
  onRestart2Update() {
    const release = this._remoteRelease || app.globalData.latestRelease || null;
    const hasNotes = !!(release && release.notes && release.notes.length
      && isNewerVersion(release.version, config.APP_VERSION));
    if (hasNotes) {
      this.openReleaseModal('update', release);
      return;
    }
    // 没拿到新版说明时，保持原来的简单确认
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

  // 同步策略：实时推送为主，失败自动降级轮询（永不中断），并有限次尝试重回实时。
  // force=true 时忽略「同一家庭已在同步」的幂等判断（供失败重试用）。
  syncStart(force) {
    const familyId = this.data.family && this.data.family._id;
    if (!familyId) return;
    // 幂等：同一家庭已经在同步就直接返回。以前 onShow 与 loadFromCloud 各调一次，
    // 冷启动会订阅两遍（一遍必然失败的 watch + 一次多余的 close），日志刷屏还多耗一轮云函数。
    if (!force && this._syncFamilyId === familyId) return;
    this.syncStop();
    this._syncFamilyId = familyId;
    this.setData({ subscribing: true, syncMode: 'realtime' });
    this.fetchTodos(); // 立即拉一次，保证首屏
    this._watchClose = subscribeTodos(
      familyId,
      (todos) => {
        // 能收到推送说明实时通道是通的：清失败计数、停轮询、回实时模式
        this._watchFails = 0;
        this.stopPoll();
        const list = todos || [];
        this.announceChanges(list);
        this.renderTodos(list);
        this.setData({ noteCount: list.filter((t) => t.isNote).length });
        if (this.data.syncMode !== 'realtime') this.setData({ syncMode: 'realtime' });
      },
      (err) => this.onWatchUnavailable(err)
    );
  },

  // watch 建立失败（实时推送未开通 / 读规则拦了某些文档 / 断网）→ 降级轮询 + 稍后重试
  onWatchUnavailable(err) {
    // 页面已停止同步（切后台 / 退出家庭）后，watch 的迟到错误不应把轮询又拉起来
    if (!this._syncFamilyId) return;
    console.warn('[sync] watch 不可用，降级为轮询', (err && err.errCode) || '', (err && err.errMsg) || '');
    this.setData({ syncMode: 'poll' });
    this.startPoll();
    this.scheduleWatchRetry();
  },

  // 有限次重试：轮询照常跑着，到点再试一次实时推送
  scheduleWatchRetry() {
    this.clearWatchRetry();
    const fails = this._watchFails || 0;
    const delay = WATCH_RETRY_DELAYS[fails];
    if (!delay) return; // 次数用完：稳定用轮询，别再刷日志
    this._watchFails = fails + 1;
    this._watchRetryTimer = setTimeout(() => {
      this._watchRetryTimer = null;
      if (this.data.syncMode === 'poll') this.syncStart(true);
    }, delay);
  },

  clearWatchRetry() {
    if (this._watchRetryTimer) {
      clearTimeout(this._watchRetryTimer);
      this._watchRetryTimer = null;
    }
  },

  syncStop() {
    this._syncFamilyId = null;
    this.clearWatchRetry();
    if (this._watchClose) {
      const close = this._watchClose;
      this._watchClose = null;
      // 连接已断时 close() 会抛 "websocket not connected"，属预期情况，忽略
      try { close(); } catch (e) { /* ignore */ }
    }
    this.stopPoll();
    if (this.data.subscribing) this.setData({ subscribing: false });
  },

  // 轮询兜底：setTimeout 链（上一次拉完再排下一次），网络慢也不会堆积请求
  startPoll() {
    this.stopPoll();
    this._pollDelay = POLL_INTERVAL;
    this._armPoll(POLL_INTERVAL);
  },

  _armPoll(delay) {
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null;
      const ok = await this.fetchTodos();
      if (this.data.syncMode !== 'poll') return; // 已重回实时，停止轮询
      const next = ok ? POLL_INTERVAL : Math.min((this._pollDelay || POLL_INTERVAL) * 2, POLL_MAX_INTERVAL);
      this._pollDelay = next;
      this._armPoll(next);
    }, delay);
  },

  stopPoll() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // 返回 true=成功（轮询据此决定是否退避）；并发调用直接跳过，避免写入后刷新与轮询叠一起
  async fetchTodos() {
    if (this._fetching) return true;
    this._fetching = true;
    try {
      const data = await getMyTodos();
      const list = data.todos || [];
      if (this._inited) this.announceChanges(list);
      this.renderTodos(list); // 内部会把快照写进缓存，下次进入秒显
      this._inited = true;
      this.setData({ todosReady: true, noteCount: list.filter((t) => t.isNote).length });
      return true;
    } catch (e) {
      this.setData({ subscribing: false });
      return false;
    } finally {
      this._fetching = false;
    }
  },

  // 语义化同步提示：对比上一份快照，把对方(非我本人)的动作转化为一句话提示
  announceChanges(todos) {
    if (!this._inited) return;
    const myOpenid = this.data.myOpenid;
    const prev = this._prevTodos || {};
    const emoji = { add: '➕', done: '🎉', undo: '↩️', edit: '✏️', important: '⭐' };
    const byMe = (openid) => !!openid && openid === myOpenid;
    for (const t of todos) {
      if (t.isNote) continue; // 笔记不进待办的语义化播报
      const id = t._id;
      if (this._suppressed && this._suppressed[id] && Date.now() < this._suppressed[id]) continue;
      const old = prev[id];
      // 新增：按创建人判断是不是我
      if (!old) {
        if (!byMe(t.creatorOpenid)) this.showSyncTip(`${emoji.add} ${t.creatorNick || 'TA'} 添加了「${t.content}」`);
        continue;
      }
      // 完成/恢复：按**完成人(doneBy)**判断是不是我
      // （否则“我勾掉对方创建的待办”会被误播成“TA 完成了…”）
      if (old.done !== t.done) {
        if (!byMe(t.doneBy)) {
          const nick = t.doneNick || t.creatorNick || 'TA';
          this.showSyncTip(t.done ? `${emoji.done} ${nick} 完成了「${t.content}」`
                                 : `${emoji.undo} 恢复了「${t.content}」`);
        }
      } else if (!old.important && t.important) {
        if (!byMe(t.creatorOpenid)) this.showSyncTip(`${emoji.important} ${t.creatorNick || 'TA'} 把「${t.content}」标为重要`);
      } else if (old.content !== t.content) {
        if (!byMe(t.creatorOpenid)) this.showSyncTip(`${emoji.edit} ${t.creatorNick || 'TA'} 编辑了「${t.content}」`);
      }
    }
  },

  renderTodos(todos) {
    // ① 已本地移除、等服务端确认删除的条目一律不渲染 —— 撤销窗口 5s 内、以及窗口结束后
    //    的“真实删除”期间（云函数还没返回）都要生效。否则 watch/轮询推来的一版旧快照
    //    会把已删除的条目又画回来一次，然后才消失，看起来非常诡异。
    todos = this._filterHidden(todos);
    const my = this.data.myOpenid;
    // ② 先把笔记(随笔)拆出去：它是待办的姊妹数据，共享同一条 todos 集合与实时同步，
    //    但不进首页待办列表——首页只渲染 isNote 非真的。
    //    noteCount 由 fetchTodos / watch 全量来源单独维护（本函数常收到待办子集，不宜在此计数）。
    const todoList = todos.filter((t) => !t.isNote);
    const mapped = todoList.map((t) => ({
      ...t,
      timeText: fmtTime(t.createTime),
      doneTimeText: fmtTime(t.doneTime),
      mine: t.creatorOpenid === my,
      remindText: fmtRemind(t.remindAt), // 卡片提醒徽标文案
    }));
    // ③ 刚勾选/取消的条目：短窗口内以本地状态为准，避免“完成后跳回未完成、再跳回去”的闪动
    this._applyOptimistic(mapped);
    // 未完成在前（重要在前），已完成沉底；同优先级按创建时间倒序
    mapped.sort((a, b) => this.cmpTodos(a, b));
    const doneCount = mapped.filter((t) => t.done).length;
    const weeklyDone = countWeeklyDone(mapped); // 周小结
    this.setData({ todos: mapped, doneCount, activeCount: mapped.length - doneCount, weeklyDone });
    // 快照落缓存：下次冷启动首屏秒显（本地增删改后也保持一致）
    this._cacheTodos(mapped);
    // 记录本次快照（仅待办），供 announceChanges 做同源对比
    this._prevTodos = {};
    mapped.forEach((t) => { this._prevTodos[t._id] = { done: !!t.done, content: t.content, important: !!t.important }; });
  },

  _cacheTodos(list) {
    const familyId = this.data.family && this.data.family._id;
    if (!familyId) return;
    try { wx.setStorageSync('todos_' + familyId, list || []); } catch (e) { /* 存储异常忽略 */ }
  },

  // —— 本地即时改动的两把「保护伞」 ——
  // ① _hidden：已从列表移除、等服务端确认删除的 id
  // ② _optimistic：刚勾选/取消的 id → 本地补丁（快照跟上后就解除）

  _hideTodoIds(ids) {
    if (!this._hidden) this._hidden = {};
    const now = Date.now();
    (ids || []).forEach((id) => { if (id) this._hidden[id] = now; });
  },

  _unhideTodoIds(ids) {
    if (!this._hidden) return;
    (ids || []).forEach((id) => { delete this._hidden[id]; });
  },

  // 30s 兜底：万一删除请求一直失败，条目也不会永远消失（超时后放行，由服务端说了算）
  _filterHidden(todos) {
    const hidden = this._hidden;
    if (!hidden) return todos;
    const now = Date.now();
    return todos.filter((t) => {
      const at = hidden[t._id];
      if (!at) return true;
      if (now - at > 30 * 1000) { delete hidden[t._id]; return true; }
      return false;
    });
  },

  _markOptimistic(id, patch) {
    if (!this._optimistic) this._optimistic = {};
    this._optimistic[id] = { patch, at: Date.now() };
  },

  // 快照还没跟上时，用本地乐观值兜住；快照一旦与本地一致，立即解除保护
  _applyOptimistic(mapped) {
    const opt = this._optimistic;
    if (!opt) return;
    const now = Date.now();
    Object.keys(opt).forEach((id) => {
      const o = opt[id];
      const t = mapped.find((x) => x._id === id);
      if (!t || now - o.at > OPTIMISTIC_TTL) { delete opt[id]; return; }
      if (t.done === o.patch.done) { delete opt[id]; return; } // 服务端已跟上
      Object.assign(t, o.patch);
    });
  },

  // 自己新增成功后就地插入（用服务端返回的 id），不再拉一次全量
  insertLocalTodo({ _id, content, remindAt }) {
    if (!_id) { this.fetchTodos(); return; } // 没拿到 id 才退回全量刷新
    const family = this.data.family || {};
    const todo = {
      _id,
      familyId: family._id,
      content,
      done: false,
      members: family.members || [],
      creatorOpenid: this.data.myOpenid,
      creatorNick: this.data.myNick || '我',
      remindAt: remindAt || null,
      createTime: new Date(),
      doneTime: null,
      reminded: false,
      mine: true,
    };
    this.suppressChange(_id); // 自己新增的，不播报成「TA 添加了」
    this.renderTodos(this.data.todos.concat([todo]));
    this.setData({ todosReady: true });
  },

  // 就地补字段：不重排、不整表重拉，避免「点一下等半秒」
  patchLocalTodo(id, patch) {
    const todos = this.data.todos.slice();
    const t = todos.find((x) => x._id === id);
    if (!t) { this.fetchTodos(); return; }
    Object.assign(t, patch);
    const doneCount = todos.filter((x) => x.done).length;
    this.setData({
      todos,
      doneCount,
      activeCount: todos.length - doneCount,
      weeklyDone: countWeeklyDone(todos),
    });
  },

  // 顶部的短暂同步事件提示条
  showSyncTip(text) {
    this.setData({ syncTip: text });
    if (this._syncTipTimer) clearTimeout(this._syncTipTimer);
    this._syncTipTimer = setTimeout(() => this.setData({ syncTip: '' }), 2600);
  },

  // 用 _id 定位条目：长按菜单打开的 1~2 秒内，对方改动会经 watch 推送并重排列表，
  // 这时按下标取数会拿错条目；_id 不受重排影响，从旧事件对象里读也始终指向同一条。
  findTodo(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return null;
    return this.data.todos.find((t) => t._id === id) || null;
  },

  onInput(e) {
    this.setData({ inputVal: e.detail.value });
  },

  // 选/清提醒日期
  onPickRemindDate(e) {
    const v = e.detail.value || '';
    this.setData({ inputRemindDate: v });
  },
  onClearRemindDate() {
    this.setData({ inputRemindDate: '', inputRemindTime: '' });
  },

  // 选/清提醒时间
  onPickRemindTime(e) {
    const v = e.detail.value || ''; // 'HH:MM'
    this.setData({ inputRemindTime: v });
  },
  onClearRemind() {
    this.setData({ inputRemindTime: '' });
  },
  // 由「提醒日期 + 提醒时间」算出 remindAt（epoch 毫秒）；缺任一返回 0（不提醒）
  // 注意：不能用 new Date(`YYYY-MM-DD HH:MM`) 字符串解析，iOS(JavaScriptCore) 会得 Invalid Date，
  // 必须按年月日时分分量构造，保证双端一致。
  composeRemindAt(date, time) {
    if (!date || !time) return 0;
    const md = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
    const mt = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (!md || !mt) return 0;
    const ts = new Date(+md[1], +md[2] - 1, +md[3], +mt[1], +mt[2]).getTime();
    return Number.isFinite(ts) ? ts : 0;
  },

  // 静默续订阅额度（方案 A）——注意：requestSubscribeMessage 必须在用户点击的同步链路里发起，
  // 所以这里只能放在点击处理函数的开头，且不做任何 await 前的准备工作。
  // 仅在用户已选「总是保持以上选择」时才调，否则会弹窗骚扰用户。每天最多一次。
  maybeRenewRemindQuota() {
    if (!app.globalData.remindTmplAccept) return;
    const KEY = 'remindRenewAt';
    const last = Number(wx.getStorageSync(KEY) || 0);
    if (Date.now() - last < 20 * 3600 * 1000) return;
    wx.setStorageSync(KEY, Date.now());
    requestTodoReminder(); // 已选「总是」→ 不弹窗，静默 +1 条
  },

  async onAdd() {
    const content = (this.data.inputVal || '').trim();
    if (!content) return;
    if (this.data.editing) {
      await this.saveEdit(content);
      return;
    }
    const remindDate = this.data.inputRemindDate; // 先取日期，再清空状态
    const remindAt = this.composeRemindAt(remindDate, this.data.inputRemindTime);
    // 没选提醒时才静默续额度；选了提醒下面会主动弹授权，两者不能同时发
    if (!remindAt) this.maybeRenewRemindQuota();
    // 设了提醒但时刻已过（如今天已过去的钟点）：拦截，避免建出无效提醒
    if (remindAt && remindAt <= Date.now()) {
      wx.showToast({ title: '提醒时刻已过，请选未来的时间', icon: 'none' });
      return;
    }
    // 订阅消息授权：必须在本点击回调里先发起（不能等 addTodo 回来再弹），
    // 否则手势上下文丢失，微信直接 fail → 总是“未开启提醒”。
    const authOk = remindAt ? await requestTodoReminder() : null;
    // 备份草稿：云端失败时原样还回输入框，避免打一半的字被吞
    const draft = {
      inputVal: this.data.inputVal,
      inputRemindDate: this.data.inputRemindDate,
      inputRemindTime: this.data.inputRemindTime,
    };
    this.setData({ inputVal: '', inputRemindDate: '', inputRemindTime: '' });
    wx.showLoading({ title: '添加中' });
    try {
      const r = (await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick, remindAt)) || {};
      // 用服务端返回的 id 本地插入，省掉「写完再拉一次全量」的往返
      this.insertLocalTodo({ _id: r.id, content, remindAt });
      wx.hideLoading();
      if (remindAt) this.toastRemindAuth(authOk);
    } catch (e) {
      wx.hideLoading();
      this.setData(draft); // 失败：把草稿还给输入框，用户可重试而非重打
      wx.showToast({ title: e.message || '添加失败', icon: 'none' });
    }
  },



  // 空态一键填入示例模板
  async useTemplate(e) {
    this.maybeRenewRemindQuota();
    const content = (e.currentTarget.dataset.content || '').trim();
    if (!content) return;
    wx.showLoading({ title: '添加中' });
    try {
      const r = (await addTodo(this.data.family._id, content, this.data.myOpenid, this.data.myNick)) || {};
      this.insertLocalTodo({ _id: r.id, content });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '添加失败', icon: 'none' });
    }
  },

  // 点击圆形勾选：切换完成状态（完成=标记，保留在列表并计入"已完成"，不删除）+ 撒花庆祝
  async onToggle(e) {
    this.maybeRenewRemindQuota();
    const todo = this.findTodo(e);
    if (!todo) return;
    const becomingDone = !todo.done;
    // 深拷贝一层条目：setLocallyDone 是原位改 done 的，直接 slice() 会共享同一批对象，
    // 导致失败时的“回滚”其实回滚不了（旧代码就有这个隱患）
    const prev = this.data.todos.map((t) => ({ ...t }));
    const doneTime = becomingDone ? new Date() : null;
    const donePatch = {
      done: becomingDone,
      doneTime,
      doneTimeText: fmtTime(doneTime),
      doneBy: becomingDone ? this.data.myOpenid : null,
      doneNick: becomingDone ? (this.data.myNick || '我') : '',
    };
    // 乐观更新：先"原位"标记完成，让勾选/划线动画在这张卡原位播一下
    this.setLocallyDone(todo._id, becomingDone);
    // 登记本地状态：这期间 watch/轮询推来的、还没落库的旧快照不会把勾选改回去
    this._markOptimistic(todo._id, donePatch);
    // 立刻本地重排（完成→沉到底部 / 恢复→回到待办区）。用本地短定时器触发，
    // 完全不等云端往返——以前是 await toggleTodo 云函数成功后才做，叠加出的 1~2s 卡顿就来自这里。
    if (this._sinkTimer) clearTimeout(this._sinkTimer);
    this._sinkTimer = setTimeout(() => {
      this._sinkTimer = null;
      this.sinkDone();
    }, becomingDone ? 240 : 0); // 完成给勾选/划线动画留一点观感；恢复立即弹回
    // 触感+撒花放乐观路径：点击即反馈，不拖到云端返回（网络慢也能立刻“咯噔”一下）
    if (becomingDone) {
      try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 个别机型关闭震动会同步抛错，忽略 */ }
      this.showCelebrate();
    }
    try {
      const r = (await toggleTodo(todo._id, becomingDone)) || {};
      this.suppressChange(todo._id);
      // 状态已经乐观更新过，这里只补服务端才有的字段（完成时间/完成人），
      // 不再整表重拉：以前每次勾选都多一次 getMyTodos 往返，那一下就是卡顿感来源
      this.patchLocalTodo(todo._id, donePatch);
      // 里程碑：一起完成累计件数到 10/50/100… 时弹一次庆祝
      if (becomingDone) {
        const total = r.totalDone || 0;
        if (total) {
          this.setData({ totalDone: total });
          if (config.DONE_MILESTONES.includes(total)) this.showMilestone(total);
        }
      }
    } catch (err) {
      // 云端失败：取消待执行的重排，整体回滚到点之前的状态
      if (this._sinkTimer) { clearTimeout(this._sinkTimer); this._sinkTimer = null; }
      if (this._optimistic) delete this._optimistic[todo._id]; // 失败时把乐观保护一并撑销
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

  // 未完成待办的优先级：重要 > 普通
  todoPriority(t) {
    if (t.important) return 0;
    return 1;
  },

  // 完成动画结束后，把已完成的统一沉到列表底部
  sinkDone() {
    const todos = this.sortTodos(this.data.todos);
    const doneCount = todos.filter((x) => x.done).length;
    this.setData({ todos, doneCount, activeCount: todos.length - doneCount });
  },

  // 长按弹出二级菜单：重要 / 编辑 / 删除
  // 注意：菜单回调转发的 e 是长按那一刻的旧事件，但 findTodo 只依赖 dataset.id（不会变），
  // 列表被对方改动重排后仍能定位到当初长按的那一条，不会误操作到别的待办。
  onTodoLongPress(e) {
    const todo = this.findTodo(e);
    if (!todo) return;
    const markLabel = todo.important ? '⭐ 取消重要' : '⭐ 设为重要';
    wx.showActionSheet({
      itemList: [markLabel, '📒 转为记录', '✏️ 编辑', '🗑️ 删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.onToggleImportant(e);
        else if (res.tapIndex === 1) this.onConvertToNote(e);
        else if (res.tapIndex === 2) this.onEnterEdit(e);
        else if (res.tapIndex === 3) this.onDeleteTodo(e);
      },
    });
  },

  // 把一条待办转成笔记（随笔）：从首页待办列表移除，进「我们的记录」区。
  async onConvertToNote(e) {
    const todo = this.findTodo(e);
    if (!todo) return;
    const prev = this.data.todos.map((t) => ({ ...t }));
    // 乐观：先从本地待办列表拿掉，转好后由 watch/刷新在笔记页呈现
    this._hideTodoIds([todo._id]);
    this.renderTodos(this.data.todos.filter((t) => t._id !== todo._id));
    wx.showToast({ title: '已转为记录', icon: 'none' });
    try {
      await convertTodo(todo._id, true);
      this.suppressChange(todo._id);
      this._unhideTodoIds([todo._id]);
      this.setData({ noteCount: (this.data.noteCount || 0) + 1 });
    } catch (err) {
      this._unhideTodoIds([todo._id]);
      this.renderTodos(prev);
      wx.showToast({ title: '转换失败，请重试', icon: 'none' });
    }
  },

  // 标记/取消重要
  async onToggleImportant(e) {
    const todo = this.findTodo(e);
    if (!todo) return;
    const imp = !todo.important;
    const prev = this.data.todos.map((t) => ({ ...t }));
    this.setImportantLocal(todo._id, imp);
    try {
      await setImportant(todo._id, imp);
      this.suppressChange(todo._id);
      // 列表已经本地重排过（setImportantLocal），无需再拉云端
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
    // 这些条目从此刻起进入隐藏名单：撤销窗口内、以及之后真正删库的整个过程中都不再渲染
    this._hideTodoIds(removed.map((t) => t._id));
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
    this._unhideTodoIds(restored.map((t) => t._id)); // 撤销后不再隐藏，正常参与渲染
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
    const items = u.pending;
    const ids = items.map((p) => p.todo && p.todo._id).filter(Boolean);
    // 关键：删除期间继续隐藏这些条目（一直到拿到确认已删的快照），
    // 否则会出现「撤销条消失 → 云函数还在路上 → 旧快照把条目画回来 → 再消失」。
    this._hideTodoIds(ids);
    // 待真正删除的条目做同步静默，避免被播报成"对方删除"
    this.suppressAll(items.map((p) => p.todo));
    // 去重执行各 proc：clearDoneTodos 是同一个函数引用只执行一次；
    // removeTodo 每个是独立闭包，天然一条一个，无需去重
    const procSet = new Set();
    items.forEach((p) => { if (p.proc) procSet.add(p.proc); });
    try {
      for (const proc of procSet) await proc();
      await this.fetchTodos(); // 删除已落库，拿一版干净的快照
      this._unhideTodoIds(ids);
    } catch (e) {
      console.error('[undo] 执行失败', e);
      // 删除失败：如数还回列表，别让用户以为已经删掉了
      this._unhideTodoIds(ids);
      this.renderTodos(this.data.todos.concat(items.map((p) => p.todo)));
      wx.showToast({ title: '删除失败，已恢复', icon: 'none' });
    }
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
    const todo = this.findTodo(e);
    if (!todo) return;
    // 先把 value 写进 input，再 nextTick 聚焦，避免微信 input 的 value 与
    // focus 同帧 setData 时 value 被吞，导致看不到已有内容/像是在“追加”。
    const remind = todo.remindAt ? new Date(todo.remindAt) : null;
    const p2 = (x) => String(x).padStart(2, '0');
    const remindDate = remind ? `${remind.getFullYear()}-${p2(remind.getMonth() + 1)}-${p2(remind.getDate())}` : '';
    const remindTime = remind ? `${p2(remind.getHours())}:${p2(remind.getMinutes())}` : '';
    this.setData({
      editing: true,
      editingId: todo._id,
      inputVal: todo.content || '',
      inputRemindDate: remindDate,
      inputRemindTime: remindTime,
      inputFocus: false,
    });
    const that = this;
    wx.nextTick(() => that.setData({ inputFocus: true }));
  },

  // 删除（5 秒内可撤销）
  onDeleteTodo(e) {
    const todo = this.findTodo(e);
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
    this.setData({ editing: false, editingId: '', inputVal: '', inputRemindDate: '', inputRemindTime: '', inputFocus: false, kbHeight: 0 });
  },

  async saveEdit(content) {
    const remindAt = this.composeRemindAt(this.data.inputRemindDate, this.data.inputRemindTime); // 先缓存，cancelEdit 会清空
    // 设了提醒但时刻已过：拦截，避免改成无效提醒
    if (remindAt && remindAt <= Date.now()) {
      wx.showToast({ title: '提醒时刻已过，请选未来的时间', icon: 'none' });
      return;
    }
    // 同上：订阅授权先于任何 await 发起，保住用户手势上下文
    const authOk = remindAt ? await requestTodoReminder() : null;
    if (!remindAt) this.maybeRenewRemindQuota();
    wx.showLoading({ title: '保存中' });
    try {
      await editTodo(this.data.editingId, content, remindAt);
      const editingId = this.data.editingId;
      this.suppressChange(editingId);
      this.cancelEdit();
      // 就地更新即可，不必再整表重拉
      this.patchLocalTodo(editingId, { content, remindAt: remindAt || null, remindText: fmtRemind(remindAt) });
      wx.hideLoading();
      if (remindAt) this.toastRemindAuth(authOk);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  // —— 提醒授权引导 ——
  // 为什么要引导：订阅消息必须用户本人点授权才能收到，而家庭另一半很少主动去「我的」页，
  // 没有引导就会出现「A 设了提醒，B 永远收不到」。
  refreshRemindGuide() {
    const authorized = !!wx.getStorageSync('remindAuthorized');
    const dismissed = !!wx.getStorageSync('remindGuideDismissed');
    // 不依赖 hasFamily（首屏时 hasFamily 可能还没准备好），模板里再与 hasFamily 一起判断
    this.setData({
      remindNeedAuth: !authorized,
      showRemindGuide: !authorized && !dismissed,
    });
  },

  markRemindAuthorized() {
    wx.setStorageSync('remindAuthorized', 1);
    this.setData({ showRemindGuide: false, remindNeedAuth: false });
    if (app.checkRemindSetting) app.checkRemindSetting();
  },

  // 点引导条：直接发起授权（必须在本点击回调里调用）
  async onEnableRemindGuide() {
    const ok = await requestTodoReminder();
    if (ok) {
      this.markRemindAuthorized();
      wx.showModal({
        title: '已开启 ✅',
        content: '以后待办到点会微信通知你。\n\n小提示：刚才的弹窗里如果勾了「总是保持以上选择」，以后会自动续上额度，不用反复点。',
        showCancel: false,
        confirmText: '知道啦',
      });
    } else {
      wx.showToast({ title: '未开启，到点不会收到微信通知', icon: 'none' });
    }
  },

  onCloseRemindGuide() {
    wx.setStorageSync('remindGuideDismissed', 1);
    this.setData({ showRemindGuide: false });
  },

  // 订阅授权结果提示
  toastRemindAuth(ok) {
    if (ok) {
      this.markRemindAuthorized();
      wx.showToast({ title: '已开启提醒 ✨ 到点通知你', icon: 'none' });
    } else {
      wx.showToast({ title: '通知未授权，到点不会提醒', icon: 'none' });
    }
  },
  // 键盘高度变化：底部输入栏/编辑面板整体上顶，
  // 解决「输入框上方只看到键盘的『完成』按钮、点不到保存」的问题。
  onKbHeight(e) {
    const h = (e && e.detail && e.detail.height) || 0;
    if (h === this.data.kbHeight) return;
    this.setData({ kbHeight: h });
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

  goNotes() {
    wx.navigateTo({ url: '/pages/notes/notes' });
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

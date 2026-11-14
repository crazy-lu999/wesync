// pages/me/me.js
const { getMyFamily, leaveFamily, updateNickname, addFamilyPhotos, removeFamilyPhoto, setWallTitle, addAnniversary, editAnniversary, removeAnniversary, requestTodoReminder } = require('../../utils/db.js');
const { buildShare } = require('../../utils/share.js');
const config = require('../../utils/config.js');
const app = getApp();

// 由 (family, openid) 生成页面视图数据。
// 注意：photos 是云存储 fileID，photoUrls 是云函数下发的临时可访问 URL（跨成员可看）。
// urlByFile：当前页面上「已经在显示」的 fileID → URL 映射，传入后优先复用它。
function fmtAnnivDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s || '');
  return m ? `${+m[2]}月${+m[3]}日` : '';
}
// 距最近一个周年还有多少天（倒计时）
function countdownDays(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s || '');
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), mo - 1, d);
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}
function buildView(family, openid, urlByFile, forceFresh) {
  const memberNicks = (family && family.memberNicks) || {};
  const myNick = memberNicks[openid] || '我';
  const members = ((family && family.members) || []).map((o) => ({
    openid: o,
    nick: memberNicks[o] || '成员',
    me: o === openid,
  }));
  const photos = (family && family.photos) || [];
  // 展示用 URL 的优先级：
  //   ① 页面上已经显示过的 URL（urlByFile）—— src 不变 → 命中微信图片缓存，不重新下载、不闪
  //   ② 云函数本次返回的临时 URL（family.photoUrls）
  //   ③ 老数据/老缓存没有 URL 时回退 fileID
  // 为什么不能直接无脑用 ②：getTempFileURL 每次调用返回的签名 URL 都不一样，把新 URL
  // 塞给 <image> 会被当成「换了张图」重新拉取 + 解码，表现就是每次进相片墙照片闪一下。
  const serverUrls = (family && Array.isArray(family.photoUrls)) ? family.photoUrls : [];
  // 正常情况优先复用已显示过的 URL（src 不变 → 命中微信图片缓存，不重下、不闪）。
  // 但对已被标记为「旧 URL 失效、需强制换新」的相片，直接用云端本次下发的临时 URL，
  // 避免冷启动首次进相片墙时因为竞态一直卡在过期 URL 上刷不出来。
  const photoUrls = photos.map((f, i) => {
    const pinned = urlByFile && urlByFile[f];
    if (pinned && !(forceFresh && forceFresh[f])) return pinned;
    return serverUrls[i] || f;
  });
  // 网格展示清单：每项保留它在 photos 里的原始下标 index，供预览/菜单正确定位 photoUrls / photos。
  const gridPhotos = photos.map((f, i) => ({ fileID: f, url: photoUrls[i], index: i }));
  return {
    family: family || null,
    myOpenid: openid || '',
    myNick,
    // 仅开发者本人可见的「反馈管理」入口；真正权限在云函数 adminFeedback 校验
    isAdmin: !!openid && openid === config.ADMIN_OPENID,
    members,
    photos,
    photoUrls,
    gridPhotos,
    photoWallTitle: ((family && family.wallTitle) || '').trim() || config.PHOTO_WALL_TITLE,
    photoMax: 9,
    // 纪念日列表（可多个，每个含标题+日期）；含天数
    annivs: ((family && (Array.isArray(family.anniversaries) ? family.anniversaries : (family.anniversary ? [{ id: 'legacy-1', title: '我们的纪念日', date: String(family.anniversary) }] : []))) || []).map((a) => ({
      id: a.id,
      title: (a.title || '').trim() || '纪念日',
      date: fmtAnnivDate(a.date),
      dateRaw: a.date,
      countdown: (() => { const cd = countdownDays(a.date); return cd == null ? -1 : cd; })(),
    })),
  };
}

Page({
  data: {
    family: null,
    myOpenid: '',
    myNick: '我',
    isAdmin: false,
    members: [],
    photos: [], // 云存储 fileID 列表
    photoUrls: [], // 与 photos 一一对应的临时可访问 URL（对方也能看图）
    gridPhotos: [], // 网格展示用：全部照片（含原始下标）
    // 相片墙设置
    photoMax: 9,
    photoWallTitle: config.PHOTO_WALL_TITLE,
    editingWallTitle: false,
    wallTitleInput: '',
    // 纪念日
    annivs: [],
    editingAnniv: false,
    editingAnnivId: '',
    titleInput: '',
    dateInput: '',
    today: (() => {
      const n = new Date();
      const p = (x) => String(x).padStart(2, '0');
      return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
    })(),
    loading: true,
    editingNick: false,
    nickInput: '',
    version: config.APP_VERSION,
  },

  onShow() {
    // 首屏秒显：先用当前全局数据/本地缓存立即渲染，不等云函数返回（避免空白）
    const cachedFamily = app.globalData.family || wx.getStorageSync('myFamily');
    const cachedOpenid = app.globalData.openid || wx.getStorageSync('myOpenid');
    if (cachedFamily && cachedOpenid) {
      // 复用上一轮已显示的图片 URL（没有就用缓存里的），保证 <image> 的 src 不变
      const view = buildView(cachedFamily, cachedOpenid, this._urlByFile || {}, this._photoRetry || {});
      this._rememberUrls(view);
      this.setData({ ...view, loading: false });
    }
    // 后台静默拉一次最新家庭数据覆盖，保证成员/昵称/照片是最新的
    this.load();
  },

  // 记录「页面上正在显示的 fileID → URL」，后续渲染沿用，避免 src 变化导致图片重新下载
  _rememberUrls(view) {
    const map = {};
    ((view && view.gridPhotos) || []).forEach((p) => { if (p.fileID && p.url) map[p.fileID] = p.url; });
    this._urlByFile = map;
  },

  // 用云函数返回的最新家庭数据渲染视图（照片临时 URL 已由云端解析好）
  // ⭐ 关键：不直接采用新的临时 URL，而是沿用页面上已显示的 URL —— 否则 <image> 的
  // src 变了，微信会重新下载 + 解码，表现就是「每次进相片墙都闪一下」。
  applyFamily(family, openid, extra) {
    // 记下云端本次返回的新 URL，留给「URL 过期、图片加载失败」时兜底替换
    const server = {};
    const photos = (family && family.photos) || [];
    ((family && family.photoUrls) || []).forEach((u, i) => {
      if (photos[i] && u) server[photos[i]] = u;
    });
    if (Object.keys(server).length) this._serverUrls = server;

    const view = buildView(family, openid, this._urlByFile || {}, this._photoRetry || {});
    // 经历过「旧 URL 失效需换新」的格子，这一轮已经吃上最新 URL 池，复位重试标记；
    // 若仍有相片加载失败，会再次走进 onPhotoError 补齐。
    this._photoRetry = {};
    // 新照片（本次新出现的 fileID）用的是云端新 URL，一并记下来
    this._rememberUrls(view);
    // 缓存里存「实际显示的 URL」，下次冷启动/新开页面复用同一批 URL，继续命中图片缓存
    view.family = this._cacheFamily(family, view);
    this.setData({ ...view, ...(extra || {}) });
  },

  _cacheFamily(family, view) {
    const cached = { ...(family || {}), photoUrls: (view && view.photoUrls) || [] };
    app.globalData.family = cached;
    try { wx.setStorageSync('myFamily', cached); } catch (e) { /* 存储异常忽略 */ }
    return cached;
  },

  // 临时 URL 过期（getTempFileURL 默认 2 小时）时图片会加载失败：用云端本次给的新 URL
  // 就地换掉这一张。只在真加载失败时才换 URL，所以平时进页面完全不会闪。
  onPhotoError(e) {
    const fid = e.currentTarget.dataset.fileid;
    if (!fid) return;
    const fresh = (this._serverUrls || {})[fid];
    const current = (this._urlByFile || {})[fid];
    if (!fresh || fresh === current) {
      // 云端新鲜 URL 还没就位（冷启动首次进相片墙的典型竞态）：先把这格登记为
      // 「需强制换新」，等 applyFamily 拿到云端新鲜 URL 时再换，而不是一直沿用过期旧 URL。
      this._photoRetry = { ...(this._photoRetry || {}), [fid]: true };
      return; // 没有新 URL，或换了也一样，重试没意义
    }
    this._urlByFile = { ...(this._urlByFile || {}), [fid]: fresh };
    // 已就地换上新鲜 URL，不再需要强制换
    if (this._photoRetry) { this._photoRetry[fid] = undefined; delete this._photoRetry[fid]; }
    const view = buildView(this.data.family, this.data.myOpenid, this._urlByFile, this._photoRetry || {});
    this._rememberUrls(view);
    // 同步缓存，避免下次又从过期 URL 起跳
    this._cacheFamily(this.data.family, view);
    this.setData({ photoUrls: view.photoUrls, gridPhotos: view.gridPhotos });
  },

  async load() {
    try {
      const data = await getMyFamily();
      const { family, openid } = data;
      if (!family) {
        // 确认真实无家庭：清缓存回引导页
        this.clearCache(app.globalData.family && app.globalData.family._id);
        wx.reLaunch({ url: '/pages/index/index' });
        return true;
      }
      app.globalData.openid = openid;
      app.globalData.family = family;
      // 缓存，下次进入无需等云函数
      wx.setStorageSync('myFamily', family);
      wx.setStorageSync('myOpenid', openid);
      await this.applyFamily(family, openid, { loading: false });
      return true;
    } catch (e) {
      // 网络失败但已有缓存时保留缓存内容，不打断浏览
      if (!this.data.family) this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      return false;
    }
  },

  // 手动刷新：成员可点悬浮按钮拉取最新家庭数据（含相片墙/昵称/纪念日）
  onRefresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    wx.showLoading({ title: '刷新中', mask: true });
    this.load().then((ok) => {
      // 只有真刷新成功才提示；失败时 load 内部已弹「加载失败」，不覆盖误导
      if (ok) wx.showToast({ title: '已刷新', icon: 'success' });
    }).finally(() => {
      this._refreshing = false;
      wx.hideLoading();
    });
  },

  clearCache(fid) {
    wx.removeStorageSync('myFamily');
    wx.removeStorageSync('myOpenid');
    if (fid) wx.removeStorageSync('todos_' + fid);
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.family.inviteCode,
      success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
    });
  },

  onMemberTap(e) {
    if (e.currentTarget.dataset.me) this.onEditNick();
  },

  onEditNick() {
    this.setData({ nickInput: this.data.myNick || '', editingNick: true });
  },

  onCancelNick() {
    this.setData({ editingNick: false, nickInput: '' });
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value });
  },

  async onSaveNick() {
    const nick = (this.data.nickInput || '').trim();
    if (!nick) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    try {
      await updateNickname(nick);
      // 刷新拿到最新成员昵称（含其它成员的更新）
      await this.load();
      wx.hideLoading();
      this.setData({ editingNick: false, nickInput: '' });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  onLeave() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后不再看到共享清单；\n若两人都退出，家庭及全部数据（待办、相片墙、纪念日）将被永久清空，无法恢复。确定吗？',
      confirmText: '退出',
      confirmColor: '#F0413B',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.doLeave();
      },
    });
  },

  goGuide() {
    wx.navigateTo({ url: '/pages/guide/guide' });
  },

  goReleaseNotes() {
    wx.navigateTo({ url: '/pages/releaseNotes/releaseNotes' });
  },

  // 开启微信提醒（订阅消息）授权：
  // 订阅消息是「一次性」的，且必须用户本人点击才能弹授权框，
  // 所以家庭另一半必须自己在这里点一下，才能收到另一方建待办的到点提醒。
  // ⭐ 关键：授权弹窗里要勾选「总是保持以上选择」——勾选后首页每次添加/勾选待办
  // 会自动静默续一条额度，日常用就不容易断了。
  async onEnableRemind() {
    const ok = await requestTodoReminder();
    if (ok) {
      wx.setStorageSync('remindAuthorized', 1);
      // 刷新「是否已选总是允许」，供首页静默续额度使用
      if (app.checkRemindSetting) app.checkRemindSetting();
      wx.showModal({
        title: '已开启 ✅',
        content: '以后有到点提醒会微信通知你。\n\n小提示：如果刚才的弹窗里勾选了「总是保持以上选择」，之后会默认续上额度，不用反复点。',
        showCancel: false,
        confirmText: '知道啦',
      });
    } else {
      wx.showToast({ title: '未开启，到点不会收到微信通知', icon: 'none' });
    }
  },

  // 意见反馈入口：私密提交给开发者，不公开、无社交互动
  goFeedback() {
    wx.navigateTo({ url: '/pages/wall/wall' });
  },

  // 反馈管理入口（仅开发者本人可见）
  goAdminFeedback() {
    wx.navigateTo({ url: '/pages/adminFeedback/adminFeedback' });
  },

  // —— 相片墙 ——

  // 点击标题直接改为可编辑态
  onEditWallTitle() {
    this.setData({ wallTitleInput: this.data.photoWallTitle, editingWallTitle: true });
  },
  onCancelWallTitle() {
    this.setData({ editingWallTitle: false, wallTitleInput: '' });
  },
  onWallTitleInput(e) {
    this.setData({ wallTitleInput: e.detail.value });
  },
  async onSaveWallTitle() {
    const t = (this.data.wallTitleInput || '').trim().slice(0, 12);
    if (!t) {
      wx.showToast({ title: '标题不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    try {
      await setWallTitle(t);
      const fresh = await getMyFamily();
      app.globalData.family = fresh.family;
      wx.setStorageSync('myFamily', fresh.family);
      await this.applyFamily(fresh.family, fresh.openid, { editingWallTitle: false, wallTitleInput: '' });
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  // —— 纪念日（可多个，各含标题+日期）——
  onAddAnniv() {
    this.setData({ editingAnnivId: '', titleInput: '', dateInput: this.data.today, editingAnniv: true });
  },
  onEditAnniv(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const it = this.data.annivs.find((x) => x.id === id);
    this.setData({
      editingAnnivId: id,
      titleInput: (it && it.title) || '',
      dateInput: (it && it.dateRaw) || this.data.today,
      editingAnniv: true,
    });
  },
  onTitleInput(e) {
    this.setData({ titleInput: e.detail.value });
  },
  onDatePick(e) {
    this.setData({ dateInput: e.detail.value });
  },
  onCancelAnniv() {
    this.setData({ editingAnniv: false, editingAnnivId: '', titleInput: '', dateInput: '' });
  },
  async onSaveAnniv() {
    const date = (this.data.dateInput || '').trim();
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
      wx.showToast({ title: '选个日期吧', icon: 'none' });
      return;
    }
    let title = (this.data.titleInput || '').trim().slice(0, 12);
    if (!title) title = '纪念日';
    wx.showLoading({ title: '保存中' });
    try {
      const id = this.data.editingAnnivId;
      if (id) {
        await editAnniversary(id, title, date);
      } else {
        await addAnniversary(Date.now().toString(36), title, date);
      }
      const fresh = await getMyFamily();
      app.globalData.family = fresh.family;
      wx.setStorageSync('myFamily', fresh.family);
      await this.applyFamily(fresh.family, fresh.openid, { editingAnniv: false, editingAnnivId: '', titleInput: '', dateInput: '' });
      wx.hideLoading();
      wx.showToast({ title: id ? '已更新 💕' : '已记住这个日子 💕', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },
  // 编辑态里的删除按钮
  onDelAnniv() {
    const id = this.data.editingAnnivId;
    if (!id) return;
    wx.showModal({
      title: '删除这个纪念日？',
      content: '从列表里移除这个纪念日。',
      confirmColor: '#F0413B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await removeAnniversary(id);
          const fresh = await getMyFamily();
          app.globalData.family = fresh.family;
          wx.setStorageSync('myFamily', fresh.family);
          await this.applyFamily(fresh.family, fresh.openid, { editingAnniv: false, editingAnnivId: '', titleInput: '', dateInput: '' });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  onPickPhotos() {
    if (this._picking) return; // 防重：避免连点重复上传
    const remain = this.data.photoMax - this.data.photos.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张啦', icon: 'none' });
      return;
    }
    this._picking = true;
    wx.chooseMedia({
      count: Math.min(remain, 9), // 一次性多选，剩余还能传几张就传几张
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        if (!res.tempFiles.length) { this._picking = false; return; }
        wx.showLoading({ title: '上传中', mask: true });
        try {
          const fileIDs = [];
          for (let i = 0; i < res.tempFiles.length; i++) {
            const f = res.tempFiles[i];
            const filePath = f.tempFilePath;
            const ext = (filePath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
            const cloudPath = `photos/${this.data.myOpenid}/${Date.now()}_${i}${ext}`;
            const up = await wx.cloud.uploadFile({ cloudPath, filePath });
            fileIDs.push(up.fileID);
          }
          await addFamilyPhotos(fileIDs);
          // 刷新照片墙（家庭对象含最新 photos）
          const fresh = await getMyFamily();
          app.globalData.family = fresh.family;
          wx.setStorageSync('myFamily', fresh.family);
          await this.applyFamily(fresh.family, fresh.openid);
          wx.hideLoading();
          this._picking = false;
          wx.showToast({ title: `已上传 ${fileIDs.length} 张`, icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          this._picking = false;
          wx.showToast({ title: e.message || '上传失败', icon: 'none' });
        }
      },
      fail: () => { this._picking = false; },
    });
  },

  // 点按预览大图：用临时可访问 URL，保证对方也能打开
  onPreviewPhoto(e) {
    const urls = this.data.photoUrls || [];
    if (!urls.length) return;
    const idx = e.currentTarget.dataset.index;
    wx.previewImage({
      current: urls[idx] || urls[0],
      urls,
    });
  },

  // 长按照片：直接删除（已去掉封面功能）
  onPhotoMenu(e) {
    const idx = e.currentTarget.dataset.index;
    const url = this.data.photos[idx];
    if (!url) return;
    this.confirmDeletePhoto(idx);
  },

  confirmDeletePhoto(idx) {
    const fileID = this.data.photos[idx];
    if (!fileID) return;
    const url = fileID;
    wx.showModal({
      title: '删除这张照片？',
      content: '相片墙和对方那边都会移除。',
      confirmColor: '#F0413B',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await removeFamilyPhoto(url);
          const fresh = await getMyFamily();
          app.globalData.family = fresh.family;
          wx.setStorageSync('myFamily', fresh.family);
          await this.applyFamily(fresh.family, fresh.openid);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'none' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  async doLeave() {
    wx.showLoading({ title: '处理中' });
    try {
      await leaveFamily();
      wx.hideLoading();
      app.globalData.family = null;
      wx.removeStorageSync('familyId');
      // 清掉本家庭待办缓存与本页家庭缓存，避免退出后仍显示旧数据
      const fid = this.data.family && this.data.family._id;
      this.clearCache(fid);
      wx.showToast({ title: '已退出', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },

  // 转发给朋友：本页是“我的小家”语境。家庭还有空位时，分享卡片直接带邀请码
  // 跳加入页并预填（无需对方找码），真正实现“点开即可加入”；家庭已满或无码时
  // 回落通用品牌卡（引导新用户建新家），避免“满员却还让你来加”的误导。
  onShareAppMessage() {
    const family = this.data.family;
    const hasRoom = (this.data.members || []).length < 2;
    const code = (family && family.inviteCode && hasRoom) ? family.inviteCode : '';
    return buildShare({ inviteCode: code });
  },

  onShareTimeline() {
    return buildShare();
  },
});
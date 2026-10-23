// pages/me/me.js
const { getMyFamily, leaveFamily, updateNickname, submitFeedback, addFamilyPhotos, removeFamilyPhoto, setWallTitle, addAnniversary, editAnniversary, removeAnniversary, listFeedbacks, markFeedbackRead } = require('../../utils/db.js');
const { buildShare } = require('../../utils/share.js');
const config = require('../../utils/config.js');
const app = getApp();

// 由 (family, openid) 生成页面视图数据。
// 注意：photos 是云存储 fileID，photoUrls 是云函数下发的临时可访问 URL（跨成员可看）。
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
function buildView(family, openid) {
  const memberNicks = (family && family.memberNicks) || {};
  const myNick = memberNicks[openid] || '我';
  const members = ((family && family.members) || []).map((o) => ({
    openid: o,
    nick: memberNicks[o] || '成员',
    me: o === openid,
  }));
  const photos = (family && family.photos) || [];
  // 优先用云函数返回的临时 URL；老缓存没有时回退为 fileID
  const photoUrls = family && Array.isArray(family.photoUrls) ? family.photoUrls : photos.slice();
  // 网格展示清单：每项保留它在 photos 里的原始下标 index，供预览/菜单正确定位 photoUrls / photos。
  const gridPhotos = photos.map((f, i) => ({ fileID: f, url: photoUrls[i], index: i }));
  return {
    family: family || null,
    myOpenid: openid || '',
    myNick,
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

// 时间格式化：Date/aO 对象 → 'YYYY-MM-DD HH:mm'
function fmtTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

Page({
  data: {
    family: null,
    myOpenid: '',
    myNick: '我',
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
    // 意见反馈
    showFeedback: false,
    feedbackInput: '',
    feedbackMax: config.FEEDBACK_MAX_LEN,
    // 反馈管理
    showFeedbackList: false,
    feedbackLoading: false,
    feedbacks: [],
    feedbackUnread: 0,
    adminOpenid: config.ADMIN_OPENID,
    version: config.APP_VERSION,
  },

  onShow() {
    // 首屏秒显：先用当前全局数据/本地缓存立即渲染，不等云函数返回（避免空白）
    const cachedFamily = app.globalData.family || wx.getStorageSync('myFamily');
    const cachedOpenid = app.globalData.openid || wx.getStorageSync('myOpenid');
    if (cachedFamily && cachedOpenid) {
      this.setData({ ...buildView(cachedFamily, cachedOpenid), loading: false });
    }
    // 后台静默拉一次最新家庭数据覆盖，保证成员/昵称/照片是最新的
    this.load();
  },

  // 用云函数返回的最新家庭数据渲染视图（照片临时 URL 已由云端解析好）
  applyFamily(family, openid, extra) {
    this.setData({ ...buildView(family, openid), ...(extra || {}) });
  },

  async load() {
    try {
      const data = await getMyFamily();
      const { family, openid } = data;
      if (!family) {
        // 确认真实无家庭：清缓存回引导页
        this.clearCache(app.globalData.family && app.globalData.family._id);
        wx.reLaunch({ url: '/pages/index/index' });
        return;
      }
      app.globalData.openid = openid;
      app.globalData.family = family;
      // 缓存，下次进入无需等云函数
      wx.setStorageSync('myFamily', family);
      wx.setStorageSync('myOpenid', openid);
      await this.applyFamily(family, openid, { loading: false });
    } catch (e) {
      // 网络失败但已有缓存时保留缓存内容，不打断浏览
      if (!this.data.family) this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // 手动刷新：成员可点悬浮按钮拉取最新家庭数据（含相片墙/昵称/纪念日）
  onRefresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    wx.showLoading({ title: '刷新中', mask: true });
    this.load().finally(() => {
      this._refreshing = false;
      wx.hideLoading();
      wx.showToast({ title: '已刷新', icon: 'success' });
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

  onFeedbackToggle() {
    this.setData({ showFeedback: !this.data.showFeedback });
  },

  onFeedbackInput(e) {
    this.setData({ feedbackInput: e.detail.value });
  },

  onFeedbackCancel() {
    this.setData({ showFeedback: false, feedbackInput: '' });
  },

  async onFeedbackSubmit() {
    const content = (this.data.feedbackInput || '').trim();
    if (!content) {
      wx.showToast({ title: '先写点反馈吧', icon: 'none' });
      return;
    }
    if (content.length > this.data.feedbackMax) {
      wx.showToast({ title: `反馈最多 ${this.data.feedbackMax} 字`, icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交中' });
    try {
      await submitFeedback(content, this.data.myNick);
      wx.hideLoading();
      this.setData({ showFeedback: false, feedbackInput: '' });
      wx.showToast({ title: '感谢反馈 💛', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },

  // —— 反馈管理 ——

  async onFeedbackManage() {
    const willShow = !this.data.showFeedbackList;
    // 先置加载态：数据没回来前不要显示“空态”，避免误报“没有反馈”
    this.setData({ showFeedbackList: willShow, feedbackLoading: willShow, feedbacks: [] });
    if (willShow) await this.loadFeedbacks();
  },

  async loadFeedbacks() {
    try {
      const d = await listFeedbacks();
      const feedbacks = (d.list || []).map((it) => ({ ...it, timeText: fmtTime(it.createdAt) }));
      this.setData({ feedbacks, feedbackUnread: d.unread || 0, feedbackLoading: false });
    } catch (e) {
      this.setData({ feedbackLoading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  async onFeedbackItemRead(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.feedbacks.find((x) => x.id === id);
    if (!it || it.read) return;
    try {
      await markFeedbackRead(id);
      this.setData({
        feedbacks: this.data.feedbacks.map((x) => (x.id === id ? { ...x, read: true } : x)),
        feedbackUnread: Math.max(0, this.data.feedbackUnread - 1),
      });
    } catch (err) { /* 静默 */ }
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

  // 转发给朋友：统一品牌卡，引导新用户建自己的小家（分享诉求只有拉新家庭）
  onShareAppMessage() {
    return buildShare();
  },

  onShareTimeline() {
    return buildShare();
  },
});
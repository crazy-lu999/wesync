// pages/me/me.js
const { getMyFamily, leaveFamily, updateNickname, submitFeedback, addFamilyPhotos, removeFamilyPhoto, setWallTitle, setCover, setNote, listFeedbacks, markFeedbackRead } = require('../../utils/db.js');
const config = require('../../utils/config.js');
const app = getApp();

// 由 (family, openid) 生成页面视图数据。
// 注意：photos/cover 是 fileID，photoUrls/coverUrl 是云函数下发的临时可访问 URL（跨成员可看）。
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
  const cover = (family && family.cover) || '';
  const coverUrl = cover ? ((family && family.coverUrl) || cover) : '';
  const coverSource = (family && family.coverSource) || ''; // 裁剪封面的来源原图（重新裁剪用）
  // 网格展示清单：排除封面（封面在顶部大图展示，小格子不重复显示同一张）。
  // 每项保留它在 photos 里的原始下标 index，供预览/菜单正确定位 photoUrls / photos。
  const gridPhotos = [];
  photos.forEach((f, i) => {
    if (f !== cover) gridPhotos.push({ fileID: f, url: photoUrls[i], index: i });
  });
  const note = (family && family.note) || null;
  return {
    family: family || null,
    myOpenid: openid || '',
    myNick,
    members,
    photos,
    photoUrls,
    gridPhotos,
    cover,
    coverUrl,
    coverSource,
    coverIndex: cover ? photos.indexOf(cover) : -1,
    photoWallTitle: ((family && family.wallTitle) || '').trim() || config.PHOTO_WALL_TITLE,
    photoMax: 9,
    note,
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
    gridPhotos: [], // 网格展示用：排除封面后的照片（含原始下标）
    cover: '', // 封面 fileID
    coverUrl: '', // 封面临时可访问 URL
    coverSource: '', // 裁剪封面的来源原图 fileID
    coverIndex: -1,
    photoMax: 9,
    photoWallTitle: config.PHOTO_WALL_TITLE,
    editingWallTitle: false,
    wallTitleInput: '',
    // 悄悄话留言墙
    note: null,
    editingNote: false,
    noteInput: '',
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
      // [debug] 反馈管理入口显隐调试：确认运行时 openid 是否等于 adminOpenid
      console.log('[debug-feedback] myOpenid =', ',', openid, '| adminOpenid =', config.ADMIN_OPENID, '| isAdmin =', openid === config.ADMIN_OPENID);
    } catch (e) {
      // 网络失败但已有缓存时保留缓存内容，不打断浏览
      if (!this.data.family) this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // 手动刷新：成员可点悬浮按钮拉取最新家庭数据（含相片墙/悄悄话/昵称）
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
      content: '退出后你将不再看到共享清单。确定吗？',
      confirmColor: '#FF7A59',
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
    this.setData({ showFeedbackList: willShow });
    if (willShow) await this.loadFeedbacks();
  },

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

  // —— 悄悄话留言墙 ——
  onEditNote() {
    const cur = (this.data.note && this.data.note.text) || '';
    this.setData({ noteInput: cur, editingNote: true });
  },
  onCancelNote() {
    this.setData({ editingNote: false, noteInput: '' });
  },
  onNoteInput(e) {
    this.setData({ noteInput: e.detail.value });
  },
  async onSaveNote() {
    const text = (this.data.noteInput || '').trim().slice(0, 100);
    if (!text) {
      wx.showToast({ title: '写点内容吧', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '发送中' });
    try {
      await setNote(text);
      const fresh = await getMyFamily();
      app.globalData.family = fresh.family;
      wx.setStorageSync('myFamily', fresh.family);
      await this.applyFamily(fresh.family, fresh.openid, { editingNote: false, noteInput: '' });
      wx.hideLoading();
      wx.showToast({ title: '已留言', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '发送失败', icon: 'none' });
    }
  },

  onPickPhotos() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        if (!res.tempFiles.length) return;
        const f = res.tempFiles[0];
        const filePath = f.tempFilePath;
        const ext = (filePath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
        const cloudPath = `photos/${this.data.myOpenid}/${Date.now()}${ext}`;
        wx.showLoading({ title: '上传中' });
        try {
          const up = await wx.cloud.uploadFile({ cloudPath, filePath });
          await addFamilyPhotos([up.fileID]);
          // 刷新照片墙（家庭对象含最新 photos）
          const fresh = await getMyFamily();
          app.globalData.family = fresh.family;
          wx.setStorageSync('myFamily', fresh.family);
          await this.applyFamily(fresh.family, fresh.openid);
          wx.hideLoading();
          wx.showToast({ title: '已上传', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message || '上传失败', icon: 'none' });
        }
      },
    });
  },

  // 点按封面大图预览（封面可能是独立裁剪出的小图，单独用 coverUrl 预览）
  onPreviewCover() {
    const u = this.data.coverUrl;
    if (!u) return;
    wx.previewImage({ current: u, urls: [u] });
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

  // 长按照片弹二级菜单：设为封面(可裁剪) / 删除
  onPhotoMenu(e) {
    const idx = e.currentTarget.dataset.index;
    const url = this.data.photos[idx];
    if (!url) return;
    const items = ['🌠 设为封面（可裁剪）', '🗑️ 删除照片'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) this.startCropCover(url); // 设为封面时进入裁剪
        else if (res.tapIndex === 1) this.confirmDeletePhoto(idx);
      },
    });
  },

  // 长按封面大图：取消封面 / 重新裁剪
  onCoverMenu() {
    if (!this.data.cover) return;
    wx.showActionSheet({
      itemList: ['🎨 重新裁剪封面', '🌙 取消封面'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 优先用来源原图重剪（质量最优、可重选原图任意区域）；老数据无来源时回退用旧封面
          const src = this.data.coverSource || this.data.cover;
          this.startCropCover(src, true);
        } else if (res.tapIndex === 1) this.setCoverPhoto('', false);
      },
    });
  },

  // 设为封面：下载原图 → 弹系统裁剪框让用户框选显示区域 → 上传裁剪图 → 设为封面
  // sourceFileID: 来源原图（填入 coverSource 供重新裁剪回原图）；isReCrop: 是否为重新裁剪
  async startCropCover(sourceFileID, isReCrop = false) {
    // 兜底：老基础库不支持裁剪时，直接整张设为封面
    if (!wx.canIUse('cropImage') || !wx.cropImage) {
      this.setCoverPhoto(sourceFileID, true);
      return;
    }
    wx.showLoading({ title: '加载原图…', mask: true });
    try {
      const dl = await wx.cloud.downloadFile({ fileID: sourceFileID });
      const src = dl.tempFilePath;
      wx.hideLoading();
      wx.cropImage({
        src, // 本地图片路径
        cropWidth: 1600,   // 输出宽度（封面用途，够清晰即可）
        cropHeight: 1200,  // 输出高度
        success: async (res) => {
          const cropPath = res.tempFilePath;
          if (!cropPath) { this.setCoverPhoto(sourceFileID, true); return; }
          const ext = (cropPath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
          const cloudPath = `covers/${this.data.myOpenid}/${Date.now()}${ext}`;
          wx.showLoading({ title: '上传封面…', mask: true });
          try {
            const up = await wx.cloud.uploadFile({ cloudPath, filePath: cropPath });
            // 传 source=来源原图，云函数记录 coverSource，供下次重新裁剪回原图
            const fresh = await setCover(up.fileID, sourceFileID).then(() => getMyFamily());
            app.globalData.family = fresh.family;
            wx.setStorageSync('myFamily', fresh.family);
            await this.applyFamily(fresh.family, fresh.openid);
            wx.hideLoading();
            wx.showToast({ title: '封面已设置', icon: 'success' });
          } catch (e) {
            wx.hideLoading();
            // 上传/保存失败时回退：直接用原图当封面，不丢功能
            this.setCoverPhoto(sourceFileID, true);
            wx.showToast({ title: '裁剪保存失败，已改用原图', icon: 'none' });
          }
        },
        fail: (err) => {
          // 用户取消裁剪：不处理
          if (err && err.errMsg && /cancel/i.test(err.errMsg)) return;
          wx.showToast({ title: '裁剪已取消', icon: 'none' });
        },
      });
    } catch (e) {
      wx.hideLoading();
      this.setCoverPhoto(fileID, true); // 下载失败也回退为原图封面
      wx.showToast({ title: '加载原图失败，已改用原图', icon: 'none' });
    }
  },

  async setCoverPhoto(fileID, becomingCover) {
    wx.showLoading({ title: '设置中' });
    try {
      await setCover(fileID);
      const fresh = await getMyFamily();
      app.globalData.family = fresh.family;
      wx.setStorageSync('myFamily', fresh.family);
      await this.applyFamily(fresh.family, fresh.openid);
      wx.hideLoading();
      wx.showToast({ title: becomingCover ? '已设为封面' : '已取消封面', icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
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
});
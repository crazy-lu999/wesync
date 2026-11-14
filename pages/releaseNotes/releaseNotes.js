// pages/releaseNotes/releaseNotes.js — 更新日志
// 本地 RELEASE_NOTES 兜底 + 云端 app_config 最新说明合并展示。
const { getHistory } = require('../../utils/release-notes.js');
const { getLatestRelease } = require('../../utils/db.js');
const config = require('../../utils/config.js');

function parseVersion(v) {
  return String(v || '0').split('.').map((s) => parseInt(s, 10) || 0);
}

function cmpVersionDesc(a, b) {
  const pa = parseVersion(a.version);
  const pb = parseVersion(b.version);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return y - x;
  }
  return 0;
}

Page({
  data: {
    version: config.APP_VERSION,
    history: [],
    loading: true,
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    const local = getHistory();
    this.setData({ history: local, loading: false });

    // 云端最新说明：同版本用云端内容覆盖，新版本则前插；失败就只用本地兜底
    try {
      const d = await getLatestRelease();
      const version = (d && d.version) || '';
      const notes = (d && d.notes) || [];
      if (!version || !notes.length) return;
      const remote = {
        version,
        title: d.title || '这次更新',
        notes,
        date: d.releasedAt || '',
      };
      const list = local.slice();
      const idx = list.findIndex((x) => x.version === version);
      if (idx >= 0) list[idx] = { ...list[idx], ...remote };
      else list.unshift(remote);
      list.sort(cmpVersionDesc);
      this.setData({ history: list });
    } catch (e) {
      // 本地兜底，不打断查看
      console.warn('[releaseNotes] 云端说明加载失败', e);
    }
  },
});

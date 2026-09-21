// cloudfunctions/getMyFamily/index.js
// 入参: 无  返回: { code, message, data:{ openid, family } }
// 注：family.photos/cover 存的是云存储 fileID（仅上传者可读，对方直接读会失败）。
// 这里用云端 getTempFileURL 把照片解析成临时可访问 URL（绕过客户端 per-user 读权限，
// 且不依赖/不要求改云存储全局权限，也不额外收费），随 family 一并返回供双方展示。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 云存储 fileID 列表 → { fileID: tempURL } 映射。解析失败项回退原 fileID。
async function resolvePhotoUrls(fileIDs) {
  const list = Array.isArray(fileIDs) ? fileIDs.filter((f) => f && typeof f === 'string') : [];
  if (!list.length) return {};
  try {
    const r = await cloud.getTempFileURL({ fileList: list });
    const m = {};
    (r.fileList || []).forEach((f) => { if (f.tempFileURL) m[f.fileID] = f.tempFileURL; });
    return m;
  } catch (e) {
    console.error('[getMyFamily] resolve urls failed', e);
    return {};
  }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  const family = res.data.length ? res.data[0] : null;
  if (family) {
    const photos = family.photos || [];
    const cover = family.cover || '';
    const urlMap = await resolvePhotoUrls(photos);
    // 附加可访问 URL（不写库，仅随本次返回值下发）
    family.photoUrls = photos.map((f) => urlMap[f] || f);
    family.coverUrl = cover ? (urlMap[cover] || cover) : '';
  }
  return { code: 0, message: 'ok', data: { openid: OPENID, family } };
};

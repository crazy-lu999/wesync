// cloudfunctions/toggleWallLike/index.js — 点赞 / 取消点赞一条建议（toggle）
// 入参: { id }   返回: { code, data:{ liked, count } }
// 所有登录用户均可点赞/取消；likes 存 openid 数组（addToSet 去重 / pull 移除）。
// 隐私：不下发完整 likes，只返回最新 liked 与 count 供前端即时刷新。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: -1, message: '未授权' };

  const id = String(event && event.id || '').trim();
  if (!id) return { code: -1, message: '参数不完整' };

  try {
    const res = await db.collection('feedbacks').doc(id).field({ likes: true }).get();
    const likes = (res.data && res.data.likes) || [];
    const has = likes.includes(OPENID);

    const liked = !has;                       // toggle
    await db.collection('feedbacks').doc(id).update({
      data: { likes: liked ? _.addToSet(OPENID) : _.pull(OPENID) },
    });

    return { code: 0, data: { liked, count: likes.length + (liked ? 1 : -1) } };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg && e.errMsg.includes('not exist')) ? '该建议已不存在' : ((e && e.errMsg) || String(e)) };
  }
};
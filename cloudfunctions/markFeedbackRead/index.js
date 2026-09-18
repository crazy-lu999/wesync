// cloudfunctions/markFeedbackRead/index.js
// 入参: { id }   返回: { code, data:{ ok:true } }
// 把某条反馈标记为已读。仅 ADMIN_OPENID（开发账户）可操作。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 开发账户 openid（唯一有权限标记已读的人）
const ADMIN_OPENID = 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (OPENID !== ADMIN_OPENID) return { code: -1, message: '无权操作' };

  const { id } = event || {};
  if (!id) return { code: -1, message: '缺参' };
  await db.collection('feedbacks').doc(id).update({ data: { read: true } });
  return { code: 0, data: { ok: true } };
};
// cloudfunctions/listFeedbacks/index.js
// 返回: { code, data:{ list, unread } }
// 拉取全平台所有用户的使用反馈（含昵称/内容/时间/已读），供「我的」页反馈管理查看。
// 仅 ADMIN_OPENID（开发账户）可见；其它任何人（含家庭成员）一律拒绝。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 开发账户 openid（唯一有权限查看反馈的人）
const ADMIN_OPENID = 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg';

const LIMIT = 50;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: -1, message: '未授权' };

  // 仅开发账户可查看
  if (OPENID !== ADMIN_OPENID) return { code: -1, message: '无权查看' };

  const res = await db.collection('feedbacks')
    .where({})
    .orderBy('createdAt', 'desc')
    .limit(LIMIT)
    .get();

  const list = (res.data || []).map((r) => ({
    id: r._id,
    nick: r.nick || '匿名',
    content: r.content,
    read: !!r.read,
    createdAt: r.createdAt,
  }));
  const unread = list.filter((x) => !x.read).length;

  return { code: 0, data: { list, unread } };
};
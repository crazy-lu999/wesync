// cloudfunctions/listFeedbacks/index.js — 读取「建议墙」（全平台公开）
// 返回: { code, data:{ list } }
// 所有登录用户可见：开发者发版动态(type=update) + 全部用户建议(suggestion，含状态/回复)。
// 出于隐私，不把他人 openid 下发；每条用 isMine 标记是否本人所发。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const LIMIT = 200;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: -1, message: '未授权' };

  const res = await db.collection('feedbacks')
    .where({})
    .orderBy('createdAt', 'desc')
    .limit(LIMIT)
    .get();

  const list = (res.data || []).map((r) => ({
    id: r._id,
    // 动态由「开发组」发布；建议展示提交者昵称，匿名则显示「一位朋友」
    nick: r.type === 'update' ? '开发组' : (r.nick || '一位朋友'),
    avatar: (r.type === 'update' ? '' : (r.avatar || '')),
    content: r.content,
    type: r.type || 'suggestion',
    status: r.status || 'new',
    reply: r.reply || '',
    createdAt: r.createdAt,
    isMine: r.openid === OPENID,
  }));

  return { code: 0, data: { list } };
};
// cloudfunctions/submitFeedback/index.js — 提交一条意见反馈（私有通道）
// 入参: { content }   返回: { code, message, data:{ ok:true } }
//
// 说明：原「公开建议墙」属于社交/社区能力，已按平台审核要求下线。
// 现在反馈只写入 feedbacks 集合，供开发者自行查看，不提供任何公开读取、
// 公开展示、点赞、回复或用户间互动能力。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_LEN = 300;        // 单条反馈字数上限，需与 utils/config.js 的 FEEDBACK_MAX_LEN 一致
const RATE_MS = 30000;      // 同一用户两次提交的最短间隔（毫秒）

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: -1, message: '未授权' };

  const content = ((event && event.content) || '').toString().trim();
  if (!content) return { code: -1, message: '先写下你的想法吧' };
  if (content.length > MAX_LEN) return { code: -1, message: `反馈最多 ${MAX_LEN} 字` };

  // 简单限频：30 秒内同一用户只能提交一条
  const recent = await db.collection('feedbacks')
    .where({ openid: OPENID, createdAt: _.gte(new Date(Date.now() - RATE_MS)) })
    .count();
  if (recent.total > 0) return { code: -1, message: '提交太频繁啦，稍等一会儿再试' };

  await db.collection('feedbacks').add({
    data: {
      openid: OPENID,
      content,
      type: 'feedback',   // 私有意见反馈
      read: false,        // 供开发者标记是否已读
      createdAt: new Date(),
    },
  });

  return { code: 0, message: '已收到，谢谢你的反馈 💛', data: { ok: true } };
};

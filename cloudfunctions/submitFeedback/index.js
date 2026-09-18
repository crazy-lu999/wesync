// cloudfunctions/submitFeedback/index.js
// 入参: { content, nick }   返回: { code, message, data:{ ok:true } }
// 把用户的使用反馈写入 feedbacks 集合（含提交者昵称），openid 由云端取（不可伪造），并做简单限频防刷。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_LEN = 500;        // 单条反馈字数上限，需与 utils/config.js 的 FEEDBACK_MAX_LEN 一致
const RATE_MS = 30000;      // 同一用户两次反馈的最短间隔（毫秒）

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const content = (event && event.content || '').toString().trim();
  const nick = ((event && event.nick) || '').toString().trim().slice(0, 20) || '';

  if (!content) return { code: -1, message: '反馈内容不能为空' };
  if (content.length > MAX_LEN) return { code: -1, message: `反馈内容最多 ${MAX_LEN} 字` };

  // 简单限频：30 秒内同一用户只能提交一条
  const recent = await db.collection('feedbacks')
    .where({ openid: OPENID, createdAt: _.gte(new Date(Date.now() - RATE_MS)) })
    .count();
  if (recent.total > 0) return { code: -1, message: '提交太频繁啦，稍等一会儿再试' };

  await db.collection('feedbacks').add({
    data: {
      openid: OPENID,
      nick,
      content,
      read: false,
      createdAt: new Date(),
    },
  });

  return { code: 0, message: '已收到', data: { ok: true } };
};
// cloudfunctions/submitFeedback/index.js — 提交一条公开建议（上建议墙）
// 入参: { content, nick }   返回: { code, message, data:{ ok:true } }
// 内容写入 feedbacks 集合（全平台公开），openid 由云端取（不可伪造），并做简单限频防刷。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_LEN = 300;        // 单条建议字数上限，需与 utils/config.js 的 FEEDBACK_MAX_LEN 一致
const RATE_MS = 30000;      // 同一用户两次提交的最短间隔（毫秒）

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const content = (event && event.content || '').toString().trim();
  const nick = ((event && event.nick) || '').toString().trim().slice(0, 20) || '';
  // 头像：微信头像上传后的云存储 fileID（快照，非必填）
  const avatar = ((event && event.avatar) || '').toString().trim();
  const avatarSafe = avatar && avatar.startsWith('cloud://') ? avatar.slice(0, 500) : '';

  if (!content) return { code: -1, message: '先写下你的想法吧' };
  if (content.length > MAX_LEN) return { code: -1, message: `建议最多 ${MAX_LEN} 字` };

  // 简单限频：30 秒内同一用户只能提交一条
  const recent = await db.collection('feedbacks')
    .where({ openid: OPENID, createdAt: _.gte(new Date(Date.now() - RATE_MS)) })
    .count();
  if (recent.total > 0) return { code: -1, message: '提交太频繁啦，稍等一会儿再试' };

  await db.collection('feedbacks').add({
    data: {
      openid: OPENID,
      nick,
      avatar: avatarSafe,
      content,
      type: 'suggestion',   // suggestion=用户建议，update=开发者发版动态
      status: 'new',        // new=已收录, doing=进行中, done=已上线
      reply: '',            // 开发者公开回复
      read: false,
      createdAt: new Date(),
    },
  });

  return { code: 0, message: '已收到，谢谢你的建议 💛', data: { ok: true } };
};
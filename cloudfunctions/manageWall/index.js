// cloudfunctions/manageWall/index.js — 建议墙管理（仅开发账户可用）
// action:
//   setStatus: { id, status }      标记建议状态 new|doing|done
//   reply:     { id, reply }       公开发布开发者回复
//   delete:    { id }              删除不当内容
//   postUpdate: { content }        发布一条开发者发版动态(type=update)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 开发账户 openid（唯一有权限管理建议墙的人）
const ADMIN_OPENID = 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg';

const STATUS = ['new', 'doing', 'done'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: -1, message: '未授权' };
  if (OPENID !== ADMIN_OPENID) return { code: -1, message: '无权操作' };

  const action = event && event.action;

  try {
    if (action === 'setStatus') {
      const id = String(event.id || '');
      const status = String(event.status || '');
      if (!id || !STATUS.includes(status)) return { code: -1, message: '参数不完整' };
      await db.collection('feedbacks').doc(id).update({ data: { status } });
      return { code: 0, data: { ok: true } };
    }

    if (action === 'reply') {
      const id = String(event.id || '');
      const reply = String(event.reply || '').trim();
      if (!id || !reply) return { code: -1, message: '回复不能为空' };
      await db.collection('feedbacks').doc(id).update({ data: { reply, updatedAt: new Date() } });
      return { code: 0, data: { ok: true } };
    }

    if (action === 'delete') {
      const id = String(event.id || '');
      if (!id) return { code: -1, message: '参数不完整' };
      await db.collection('feedbacks').doc(id).remove();
      return { code: 0, data: { ok: true } };
    }

    if (action === 'postUpdate') {
      const content = String(event.content || '').trim();
      if (!content) return { code: -1, message: '内容不能为空' };
      await db.collection('feedbacks').add({
        data: {
          openid: ADMIN_OPENID,
          nick: '开发组',
          content,
          type: 'update',
          status: 'done',
          reply: '',
          read: false,
          createdAt: new Date(),
        },
      });
      return { code: 0, data: { ok: true } };
    }

    return { code: -1, message: '未知 action' };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg) || String(e) };
  }
};
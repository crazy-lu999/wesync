// cloudfunctions/adminFeedback/index.js — 反馈管理（仅开发者本人可用）
// action:
//   whoami:   {}             返回调用者是否为开发者（排查权限用）
//   list:     {}             读取全部私密意见反馈（按时间倒序）
//   markRead: { id }         把一条反馈标记为已读
//   delete:   { id }         删除一条反馈
//
// 权限：服务端按 OPENID 判断，非开发者一律拒绝。
// 说明：这里只做「查看 / 标记已读 / 删除」，不提供公开回复、公开发布动态等社交能力。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 开发者 openid（需与 utils/config.js 的 ADMIN_OPENID 一致；仅用于前端入口显隐）
const ADMIN_OPENID = 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg';
const LIMIT = 100;

function isAdmin(openid) {
  return !!openid && openid === ADMIN_OPENID;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event.action || 'list');

  if (action === 'whoami') {
    return { code: 0, data: { isAdmin: isAdmin(OPENID) } };
  }

  if (!isAdmin(OPENID)) {
    return { code: -1, message: '无权访问：仅开发者本人可查看反馈' };
  }

  try {
    if (action === 'list') {
      const res = await db.collection('feedbacks')
        .where({ type: 'feedback' })
        .orderBy('createdAt', 'desc')
        .limit(LIMIT)
        .get();
      const list = (res.data || []).map((r) => ({
        id: r._id,
        content: r.content,
        read: !!r.read,
        createdAt: r.createdAt,
        // 只给开发者看：openid 后 6 位，便于区分用户，不展示完整 openid
        userSuffix: r.openid ? String(r.openid).slice(-6) : '',
      }));
      return { code: 0, data: { list } };
    }

    if (action === 'markRead') {
      const id = String(event.id || '').trim();
      if (!id) return { code: -1, message: '缺少反馈 id' };
      await db.collection('feedbacks').doc(id).update({
        data: { read: true, readAt: new Date() },
      });
      return { code: 0, data: { ok: true } };
    }

    if (action === 'delete') {
      const id = String(event.id || '').trim();
      if (!id) return { code: -1, message: '缺少反馈 id' };
      await db.collection('feedbacks').doc(id).remove();
      return { code: 0, data: { ok: true } };
    }

    return { code: -1, message: `未知 action：${action}` };
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || String(e);
    return { code: -1, message: msg };
  }
};

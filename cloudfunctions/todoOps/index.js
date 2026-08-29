// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'remove'
// add:    { action:'add', familyId, content, openid, creatorNick }
// toggle: { action:'toggle', id, done }
// remove: { action:'remove', id }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    if (event.action === 'add') {
      const familyId = String(event.familyId || '');
      const content = String(event.content || '').trim();
      if (!familyId || !content) return { code: 1, message: '参数不完整' };
      // 取该家庭成员 openid，写入 todo.members，供 read 规则用 auth.openid in doc.members 判断
      let members = [];
      try {
        const famRes = await db.collection('families').doc(familyId).get();
        members = (famRes.data && famRes.data.members) || [];
      } catch (e) {
        // 兼容：查不到也至少把自己算上
        members = [OPENID];
      }
      const res = await db.collection('todos').add({
        data: {
          familyId,
          content,
          done: false,
          members,
          creatorOpenid: OPENID,
          creatorNick: String(event.creatorNick || '我'),
          createTime: db.serverDate(),
          doneTime: null,
        },
      });
      return { code: 0, message: 'ok', data: { id: res._id } };
    }

    if (event.action === 'toggle') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      const done = !!event.done;
      await db.collection('todos').doc(id).update({
        data: { done, doneTime: done ? db.serverDate() : null },
      });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'remove') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      await db.collection('todos').doc(id).remove();
      return { code: 0, message: 'ok', data: {} };
    }

    return { code: 1, message: '未知 action' };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg) || String(e) };
  }
};
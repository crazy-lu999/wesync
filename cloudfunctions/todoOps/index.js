// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'remove' | 'edit'
// add:    { action:'add', familyId, content, openid, creatorNick }
// toggle: { action:'toggle', id, done }
// remove: { action:'remove', id }
// edit:   { action:'edit', id, content }
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
      // 可选提醒时间（ISO 字符串）。设了提醒 → 额外写 reminders，由定时触发器到点推送订阅消息
      let remindAt = null;
      if (event.remindAt) {
        const t = new Date(event.remindAt);
        if (!isNaN(t.getTime())) remindAt = t;
      }
      const res = await db.collection('todos').add({
        data: {
          familyId,
          content,
          done: false,
          members,
          creatorOpenid: OPENID,
          creatorNick: String(event.creatorNick || '我'),
          remindAt: remindAt ? db.serverDate({ offset: (remindAt.getTime() - Date.now()) / 1000 }) : null,
          createTime: db.serverDate(),
          doneTime: null,
        },
      });
      if (remindAt) {
        try {
          await db.collection('reminders').add({
            data: {
              openid: OPENID,
              familyId,
              todoId: res._id,
              content,
              remindAt: db.serverDate({ offset: (remindAt.getTime() - Date.now()) / 1000 }),
              triggered: false,
              createTime: db.serverDate(),
            },
          });
        } catch (e) {
          // reminders 集合未建时不影响待办本身；控制台建好集合即有完整提醒
          console.warn('[add] write reminder failed', e);
        }
      }
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

    if (event.action === 'edit') {
      const id = String(event.id || '');
      const content = String(event.content || '').trim();
      if (!id || !content) return { code: 1, message: '编辑内容不能为空' };
      await db.collection('todos').doc(id).update({ data: { content } });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'remove') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      await db.collection('todos').doc(id).remove();
      // 同步清理该待办的提醒，避免误发
      try {
        await db.collection('reminders').where({ todoId: id }).remove();
      } catch (e) { console.warn('[remove] clean reminder failed', e); }
      return { code: 0, message: 'ok', data: {} };
    }

    return { code: 1, message: '未知 action' };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg) || String(e) };
  }
};
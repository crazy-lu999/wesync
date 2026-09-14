// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'remove' | 'edit' | 'setRemind'
// add:      { action:'add', familyId, content, openid, creatorNick }
// toggle:   { action:'toggle', id, done }
// remove:   { action:'remove', id }
// edit:     { action:'edit', id, content }
// setRemind { action:'setRemind', id, remindAt }  remindAt 时间戳｜''=取消
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
      // 新增待办：提醒统一走 setRemind 单独设置，这里不写 reminders
      const res = await db.collection('todos').add({
        data: {
          familyId,
          content,
          done: false,
          members,
          creatorOpenid: OPENID,
          creatorNick: String(event.creatorNick || '我'),
          remindAt: null,
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

    if (event.action === 'setRemind') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      let remindAt = null;
      if (event.remindAt) {
        const t = new Date(Number(event.remindAt));
        if (isNaN(t.getTime())) return { code: 1, message: '时间无效' };
        remindAt = t;
      }
      // 读取待办内容（用于 reminders 记录），尽量取，取不到也不影响
      let content = '';
      try {
        const td = await db.collection('todos').doc(id).get();
        content = td.data ? td.data.content || '' : '';
      } catch (e) { /* ignore */ }
      if (remindAt) {
        // 设置：写待办 remindAt，并新增一条提醒（同一待办先清旧的未触发提醒再写，避免重复）
        try {
          await db.collection('reminders').where({ todoId: id, triggered: false }).remove();
        } catch (e) { /* ignore */ }
        await db.collection('todos').doc(id).update({
          // offset 必须为整数秒，浮点会报 INVALID_PARAM(501007)
          data: { remindAt: db.serverDate({ offset: Math.round((remindAt.getTime() - Date.now()) / 1000) }) },
        });
        try {
          await db.collection('reminders').add({
            data: {
              openid: OPENID,
              todoId: id,
              content: content || '你有一条待办',
              remindAt: db.serverDate({ offset: Math.round((remindAt.getTime() - Date.now()) / 1000) }),
              triggered: false,
              createTime: db.serverDate(),
            },
          });
        } catch (e) { console.warn('[setRemind] write reminder failed', e); }
      } else {
        // 取消：清空待办 remindAt，删除未触发提醒
        await db.collection('todos').doc(id).update({ data: { remindAt: null } });
        try {
          await db.collection('reminders').where({ todoId: id, triggered: false }).remove();
        } catch (e) { /* ignore */ }
      }
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
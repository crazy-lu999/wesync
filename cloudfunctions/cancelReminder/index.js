// cloudfunctions/cancelReminder/index.js — 取消一条提醒，并清空对应待办的提醒字段
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const reminderId = String(event.reminderId || '');
  const todoId = String(event.todoId || '');
  if (!reminderId) return { code: 1, message: '参数不完整' };
  try {
    // 只允许取消自己的提醒
    const r = await db.collection('reminders').doc(reminderId).get();
    if (!r.data || r.data.openid !== OPENID) return { code: 1, message: '无权限' };
    await db.collection('reminders').doc(reminderId).remove();
    // 顺带清空待办上的提醒字段，避免仍显示 🔔 标签
    if (todoId) {
      try {
        await db.collection('todos').doc(todoId).update({ data: { remindAt: null } });
      } catch (e) { console.warn('[cancel] clear todo remind failed', e); }
    }
    return { code: 0, message: 'ok', data: {} };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg) || String(e) };
  }
};
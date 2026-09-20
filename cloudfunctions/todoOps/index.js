// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'important' | 'remove' | 'edit' | 'clearDone'
// add:      { action:'add', familyId, content, openid, creatorNick }
// toggle:   { action:'toggle', id, done }（完成时服务端记录完成人 + 累加家庭里程碑
// important: { action:'important', id, important }
// remove:   { action:'remove', id }
// edit:     { action:'edit', id, content }
// clearDone: { action:'clearDone' }（清空本家庭全部已完成）
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
      // 新增待办
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
      // 查这条待办与其家庭，完成时记录完成人昵称并累加家庭里程碑
      let doneNick = '';
      let totalDone = null;
      const t = await db.collection('todos').doc(id).get().catch(() => null);
      const wasDone = !!(t && t.data && t.data.done);
      if (done && !wasDone) {
        // 找完成人在家庭里的昵称
        try {
          const familyId = (t && t.data && t.data.familyId) || '';
          const famRes = familyId
            ? await db.collection('families').doc(familyId).get()
            : null;
          const members = (famRes && famRes.data && famRes.data.members) || [];
          const nicks = (famRes && famRes.data && famRes.data.memberNicks) || {};
          doneNick = nicks[OPENID] || '';
          if (members.includes(OPENID)) {
            // 累加家庭“一起完成”里程碑
            totalDone = (famRes.data.totalDone || 0) + 1;
            await db.collection('families').doc(familyId).update({
              data: { totalDone },
            });
          }
        } catch (e) { /* 里程碑/昵称尽力即可 */ }
      }
      const data = { done, doneTime: done ? db.serverDate() : null };
      if (doneNick) { data.doneBy = OPENID; data.doneNick = doneNick; }
      else if (done) { data.doneBy = OPENID; data.doneNick = '已完成'; }
      else { data.doneBy = ''; data.doneNick = ''; }
      await db.collection('todos').doc(id).update({ data });
      return { code: 0, message: 'ok', data: { totalDone } };
    }

    if (event.action === 'important') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      await db.collection('todos').doc(id).update({
        data: { important: !!event.important },
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
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'clearDone') {
      // 找当前用户所在家庭，删除其下全部已完成
      const famRes = await db.collection('families').where({ members: OPENID }).limit(1).get();
      if (!famRes.data.length) return { code: 1, message: '未找到你的家庭' };
      const familyId = famRes.data[0]._id;
      const del = await db.collection('todos').where({ familyId, done: true }).remove();
      const removed = (del && del.stats && del.stats.removed) || 0;
      return { code: 0, message: 'ok', data: { removed } };
    }

    return { code: 1, message: '未知 action' };
  } catch (e) {
    return { code: -1, message: (e && e.errMsg) || String(e) };
  }
};
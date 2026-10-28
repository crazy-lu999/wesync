// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'important' | 'remove' | 'edit' | 'assign' | 'clearDone'
// add:      { action:'add', familyId, content, openid, creatorNick, deadline, assignee }
// toggle:   { action:'toggle', id, done }（完成时服务端记录完成人 + 累加家庭里程碑
// important: { action:'important', id, important }
// remove:   { action:'remove', id }
// edit:     { action:'edit', id, content, deadline, assignee }
// assign:   { action:'assign', id, assignee }（更新待办指派成员 openid，空串=取消指派）
// clearDone: { action:'clearDone' }（清空本家庭全部已完成）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 校验待办存在且调用者属于其**当前**家庭成员；返回待办数据 + 家庭数据。
// 通过 familyId 反查 families 的实时 members，而不是用创建时快照的 doc.members，
// 避免“家庭新增成员后无法操作旧待办”的回归。
async function assertMemberTodo(id, OPENID) {
  const t = await db.collection('todos').doc(id).get();
  const data = t && t.data;
  if (!data || !data.familyId) throw new Error('待办不存在');
  const fam = await db.collection('families').doc(data.familyId).get();
  const members = (fam.data && fam.data.members) || [];
  if (!members.includes(OPENID)) throw new Error('无权操作该待办');
  return { data, family: fam.data };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    if (event.action === 'add') {
      const familyId = String(event.familyId || '');
      const content = String(event.content || '').trim();
      const deadline = event.deadline ? String(event.deadline) : null;
      const assignee = event.assignee ? String(event.assignee) : '';
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
          deadline,
          assignee, // 指派成员 openid（空串=两人一起）
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
      // 查这条待办与其家庭（含成员归属校验），完成时记录完成人昵称并累加家庭里程碑
      let doneNick = '';
      let totalDone = null;
      let t, family;
      try {
        const res = await assertMemberTodo(id, OPENID);
        t = res.data;
        family = res.family;
      } catch (e) {
        return { code: 1, message: e.message };
      }
      const wasDone = !!t.done;
      if (done && !wasDone) {
        // 找完成人在家庭里的昵称
        try {
          const members = (family && family.members) || [];
          const nicks = (family && family.memberNicks) || {};
          doneNick = nicks[OPENID] || '';
          if (members.includes(OPENID)) {
            // 累加家庭“一起完成”里程碑：用原子 _.inc 避免两人并发时的丢计数
            const familyId = t.familyId;
            await db.collection('families').doc(familyId).update({
              data: { totalDone: _.inc(1) },
            });
            // 读回最新累计值，用于里程碑判断
            const after = await db.collection('families').doc(familyId).get();
            totalDone = (after.data && after.data.totalDone) || (family.totalDone || 0) + 1;
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
      try { await assertMemberTodo(id, OPENID); } catch (e) { return { code: 1, message: e.message }; }
      await db.collection('todos').doc(id).update({
        data: { important: !!event.important },
      });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'edit') {
      const id = String(event.id || '');
      const content = String(event.content || '').trim();
      if (!id || !content) return { code: 1, message: '编辑内容不能为空' };
      try { await assertMemberTodo(id, OPENID); } catch (e) { return { code: 1, message: e.message }; }
      const data = { content };
      // deadline 显式更新（传空串即清除日期）
      if (event.hasOwnProperty('deadline')) {
        data.deadline = event.deadline ? String(event.deadline) : null;
      }
      await db.collection('todos').doc(id).update({ data });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'assign') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      try { await assertMemberTodo(id, OPENID); } catch (e) { return { code: 1, message: e.message }; }
      await db.collection('todos').doc(id).update({
        data: { assignee: event.assignee ? String(event.assignee) : '' },
      });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'remove') {
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      try { await assertMemberTodo(id, OPENID); } catch (e) { return { code: 1, message: e.message }; }
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
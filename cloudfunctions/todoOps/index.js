// cloudfunctions/todoOps/index.js — 待办增删改（服务端写，绕过客户端安全规则）
// action: 'add' | 'toggle' | 'important' | 'remove' | 'edit' | 'clearDone'
// add:      { action:'add', familyId, content, openid, creatorNick, remindAt }
// toggle:   { action:'toggle', id, done }（完成时服务端记录完成人 + 累加家庭里程碑
// important: { action:'important', id, important }
// remove:   { action:'remove', id }
// edit:     { action:'edit', id, content, remindAt }
// clearDone: { action:'clearDone' }（清空本家庭全部已完成）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 内容长度上限：待办 140（与前端 maxlength 一致）；笔记 200（随笔）。
const MAX_TODO_LEN = 140;
const MAX_NOTE_LEN = 200;

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
      const isNote = !!event.isNote;
      const MAX = isNote ? MAX_NOTE_LEN : MAX_TODO_LEN;
      // 自定义提醒时刻（epoch 毫秒）；0/空 = 不提醒（笔记无提醒）
      const remindAt = event.remindAt ? Number(event.remindAt) : null;
      if (!familyId || !content) return { code: 1, message: '参数不完整' };
      if (content.length > MAX) return { code: 1, message: `内容最多 ${MAX} 字` };
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
          isNote, // true=笔记（随笔），false/undefined=待办。由前端过滤决定展示位置
          done: false,
          members,
          creatorOpenid: OPENID,
          creatorNick: String(event.creatorNick || '我'),
          remindAt, // 自定义提醒时刻（epoch 毫秒，null=不提醒），sendReminders 到点发送；笔记不提醒
          createTime: db.serverDate(),
          doneTime: null,
          reminded: false, // 是否已发提醒（sendReminders 触达后置 true，防重复）
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
      // 里程碑只数「不同待办首次完成」：
      // 用 countedDone 标记该待办是否已经计入过 totalDone，取消再勾不会重复累加。
      const alreadyCounted = !!t.countedDone;
      let countMilestone = false;
      if (done && !wasDone) {
        // 找完成人在家庭里的昵称
        try {
          const members = (family && family.members) || [];
          const nicks = (family && family.memberNicks) || {};
          doneNick = nicks[OPENID] || '';
          if (members.includes(OPENID) && !alreadyCounted) {
            // 累加家庭“一起完成”里程碑：用原子 _.inc 避免两人并发时的丢计数
            const familyId = t.familyId;
            await db.collection('families').doc(familyId).update({
              data: { totalDone: _.inc(1) },
            });
            countMilestone = true;
            // 读回最新累计值，用于里程碑判断
            const after = await db.collection('families').doc(familyId).get();
            totalDone = (after.data && after.data.totalDone) || (family.totalDone || 0) + 1;
          }
        } catch (e) { /* 里程碑/昵称尽力即可 */ }
      }
      const data = { done, doneTime: done ? db.serverDate() : null };
      // 标记已计入，保证同一条待办只贡献一次里程碑
      if (countMilestone) data.countedDone = true;
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
      let isNote = false;
      try { isNote = !!(await assertMemberTodo(id, OPENID)).data.isNote; } catch (e) { return { code: 1, message: e.message }; }
      const MAX = isNote ? MAX_NOTE_LEN : MAX_TODO_LEN;
      if (content.length > MAX) return { code: 1, message: `内容最多 ${MAX} 字` };
      const data = { content };
      // remindAt 显式更新（0/空 = 清掉提醒）；若提醒时刻变了，重置 reminded 重新武装
      if (event.hasOwnProperty('remindAt')) {
        const newRemindAt = event.remindAt ? Number(event.remindAt) : null;
        let oldRemindAt = null;
        try {
          const cur = await db.collection('todos').doc(id).get();
          oldRemindAt = (cur.data && cur.data.remindAt) || null;
        } catch (e) { oldRemindAt = null; }
        data.remindAt = newRemindAt;
        if (Number(oldRemindAt || 0) !== Number(newRemindAt || 0)) {
          // 提醒时刻变了才重新武装；只改内容则保留已提醒状态。
          // ⚠️ 发送记账必须一并清零：上轮已发过的成员记在 remindSentTo 里，
          // 不清的话 sendReminders 会把他们直接跳过——改时间后新提醒将静默不再发给任何人。
          data.reminded = false;
          data.remindSentTo = [];
          data.remindTries = 0;
          data.remindError = '';
        }
      }
      await db.collection('todos').doc(id).update({ data });
      return { code: 0, message: 'ok', data: {} };
    }

    if (event.action === 'convert') {
      // 待办 ↔ 笔记 互转：改 isNote 标记即可，数据、成员、实时同步全部沿用。
      const id = String(event.id || '');
      if (!id) return { code: 1, message: '参数不完整' };
      try { await assertMemberTodo(id, OPENID); } catch (e) { return { code: 1, message: e.message }; }
      await db.collection('todos').doc(id).update({
        data: { isNote: !!event.isNote },
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
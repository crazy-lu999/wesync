// cloudfunctions/leaveFamily/index.js
// 入参: 无  返回: { code, message, data:{ ok:true } }
// 从 family 的 members / memberNicks 移除自己；不删 family 文档（另一成员仍在）。
// 若是最后一个成员，则清理该家庭的所有 todos 后删除 family 文档，保持干净。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (!res.data.length) {
    return { code: 0, message: '未在家庭中', data: { ok: true } };
  }
  const family = res.data[0];
  const remain = family.members.filter((m) => m !== OPENID);

  if (remain.length === 0) {
    // 最后一人离开：删该家庭所有 todos，再删 family。
    // 注意：.get() 默认只取 100 条，必须分页循环，否则待办超过 100 条时会留下孤儿数据。
    for (;;) {
      const page = await db.collection('todos').where({ familyId: family._id }).limit(100).get();
      const list = page.data || [];
      if (!list.length) break;
      await Promise.all(list.map((t) => db.collection('todos').doc(t._id).remove()));
      if (list.length < 100) break;
    }
    await db.collection('families').doc(family._id).remove();
  } else {
    const memberNicks = { ...family.memberNicks };
    delete memberNicks[OPENID];
    await db.collection('families').doc(family._id).update({
      data: { members: remain, memberNicks },
    });
    // 同步从已有待办的 members 中移除自己（否则读规则会让已离开者读到）
    await db.collection('todos').where({ familyId: family._id }).update({
      data: { members: _.pull(OPENID) },
    });
  }

  return { code: 0, message: '已退出', data: { ok: true } };
};

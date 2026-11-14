// cloudfunctions/getMyTodos/index.js — 服务端读取当前用户家庭的全部待办（绕过安全规则）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  // 找用户所属家庭
  const famRes = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (!famRes.data.length) {
    return { code: 0, data: { family: null, todos: [] } };
  }
  const family = famRes.data[0];
  // 云函数端默认只返回 100 条，待办积得久了（尤其已完成不清理）会静默丢数据，
  // 显式放大到服务端上限 1000 条。
  const todosRes = await db.collection('todos')
    .where({ familyId: family._id })
    .orderBy('done', 'asc')
    .orderBy('createTime', 'desc')
    .limit(1000)
    .get();
  return {
    code: 0,
    data: {
      family,
      todos: todosRes.data.map((t) => ({
        ...t,
        mine: (t.creatorOpenid || '') === OPENID,
        members: t.members || [],
      })),
    },
  };
};
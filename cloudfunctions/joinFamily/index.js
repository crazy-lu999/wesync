// cloudfunctions/joinFamily/index.js
// 入参: { inviteCode, myNick }  返回: { code, message, data:{ familyId, familyName, openid } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const inviteCode = String(event.inviteCode || '').trim();
  const myNick = (event.myNick || '我').trim() || '我';

  if (!/^\d{6}$/.test(inviteCode)) {
    return { code: 1, message: '请输入 6 位数字邀请码' };
  }

  // 已在某个家庭中
  const mine = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (mine.data.length) {
    const f = mine.data[0];
    return {
      code: 0,
      message: '已在家庭中',
      data: { familyId: f._id, familyName: f.name, openid: OPENID },
    };
  }

  const res = await db.collection('families').where({ inviteCode }).limit(1).get();
  if (!res.data.length) {
    return { code: 2, message: '邀请码不存在，检查一下？' };
  }
  const family = res.data[0];
  if (family.members.length >= 2) {
    return { code: 3, message: '家庭已满员（最多 2 人）' };
  }

  await db.collection('families').doc(family._id).update({
    data: {
      members: _.push([OPENID]),
      memberNicks: { [OPENID]: myNick },
    },
  });

  // 同步已有待办的 members，让新成员也能通过读规则 auth.openid in doc.members 读到旧数据
  await db.collection('todos').where({ familyId: family._id }).update({
    data: { members: _.addToSet(OPENID) },
  });

  return {
    code: 0,
    message: '加入成功',
    data: { familyId: family._id, familyName: family.name, openid: OPENID },
  };
};

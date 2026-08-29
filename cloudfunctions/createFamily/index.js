// cloudfunctions/createFamily/index.js
// 入参: { familyName, myNick }  返回: { code, message, data:{ inviteCode, familyId, openid } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function uniqueCode() {
  for (let i = 0; i < 20; i++) {
    const code = genCode();
    const { total } = await db.collection('families').where({ inviteCode: code }).count();
    if (total === 0) return code;
  }
  // 极端情况下兜底
  return genCode() + String(Date.now()).slice(-3);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const familyName = (event.familyName || '我们的家').trim() || '我们的家';
  const myNick = (event.myNick || '我').trim() || '我';

  // 已在家庭中则直接返回现有家庭（避免重复创建）
  const exist = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (exist.data.length) {
    const f = exist.data[0];
    return {
      code: 0,
      message: '已有家庭',
      data: { inviteCode: f.inviteCode, familyId: f._id, openid: OPENID },
    };
  }

  const inviteCode = await uniqueCode();
  const now = db.serverDate();
  const { _id } = await db.collection('families').add({
    data: {
      name: familyName,
      inviteCode,
      members: [OPENID],
      memberNicks: { [OPENID]: myNick },
      creatorOpenid: OPENID,
      createTime: now,
    },
  });

  return {
    code: 0,
    message: '创建成功',
    data: { inviteCode, familyId: _id, openid: OPENID },
  };
};

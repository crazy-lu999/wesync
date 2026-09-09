// cloudfunctions/updateNickname/index.js
// 入参: { nick }  返回: { code, message, data:{ nick } }
// 只更新当前用户（OPENID）在自己家庭 memberNicks 里的昵称，不动其他成员。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const nick = String(event.nick || '').trim();

  if (!nick) {
    return { code: 1, message: '昵称不能为空' };
  }
  if (nick.length > 20) {
    return { code: 2, message: '昵称最长 20 个字符' };
  }

  // 找到当前用户所在家庭
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (!res.data.length) {
    return { code: 3, message: '你还未加入任何家庭' };
  }
  const family = res.data[0];

  // 用点号路径动态更新该用户对应的昵称字段
  await db.collection('families').doc(family._id).update({
    data: {
      ['memberNicks.' + OPENID]: nick,
    },
  });

  return { code: 0, message: '昵称已更新', data: { nick } };
};
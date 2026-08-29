// cloudfunctions/getMyFamily/index.js
// 入参: 无  返回: { code, message, data:{ openid, family } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  const family = res.data.length ? res.data[0] : null;
  return { code: 0, message: 'ok', data: { openid: OPENID, family } };
};

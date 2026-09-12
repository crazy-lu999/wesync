// cloudfunctions/getMyReminders/index.js — 查询当前用户未触发的提醒
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  try {
    const res = await db.collection('reminders')
      .where({ openid: OPENID, triggered: false })
      .orderBy('remindAt', 'asc')
      .limit(50)
      .get();
    return { code: 0, message: 'ok', data: { reminders: res.data || [] } };
  } catch (e) {
    // 集合未建等异常：返回空，不阻塞页面
    return { code: 0, message: 'ok', data: { reminders: [] } };
  }
};
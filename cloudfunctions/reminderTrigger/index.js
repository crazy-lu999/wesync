// cloudfunctions/reminderTrigger/index.js — 定时扫描 reminders，到点下发订阅消息
// 由 config.json 的 timer 触发器驱动（默认每分钟跑一次）。
// 一次性订阅消息：用户每授权一次，才能发送一条。若授权次数用尽(43101)则标记跳过，避免反复轰炸。
//
// 【重要】迁移到第 3 方环境时，请把 TMPL_ID 与前端 utils/config.js 同步改成你实体的模板 ID。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const TMPL_ID = 'GRh-zhM_vG7yqEgaPXN58yNdc3xoOsTkCxYYkK6Znzk';
// 开发测试阶段可把下面的 miniprogramState 临时设为 'develop'，正式发布用 'formal'
const MINI_PROGRAM_STATE = 'formal';

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDT(input) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

exports.main = async () => {
  const now = new Date();
  let sent = 0, skipped = 0, failed = 0;
  try {
    const res = await db.collection('reminders')
      .where({ triggered: false, remindAt: _.lte(now) })
      .limit(100)
      .get();

    for (const r of res.data) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: r.openid,
          templateId: TMPL_ID,
          page: 'pages/index/index',
          miniprogramState: MINI_PROGRAM_STATE,
          data: {
            keyword1: { value: String(r.content || '你有一条新待办') }, // 温馨提醒
            keyword2: { value: fmtDT(r.remindAt) || '今天' },           // 日期
          },
        });
        await db.collection('reminders').doc(r._id).update({
          data: { triggered: true, sentAt: db.serverDate() },
        });
        sent++;
      } catch (e) {
        const code = e && e.errCode;
        if (code === 43101) {
          // 用户未订阅 / 一次性授权次数用尽 → 标记跳过，别再扫它
          await db.collection('reminders').doc(r._id).update({
            data: { triggered: true, sendState: 'noquota' },
          });
          skipped++;
        } else {
          failed++;
          console.error('[remind] send fail', code, r._id, e && e.errMsg);
        }
      }
    }
  } catch (e) {
    console.error('[remind] scan fail', e);
  }
  return { sent, skipped, failed };
};
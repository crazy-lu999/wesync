// cloudfunctions/getLatestVersion/index.js
// 返回应用的最新版本号和更新说明。前端用它：
//  1) 对比本地 APP_VERSION，作为首页横幅的"极端热启动"兜底；
//  2) 点横幅时先展示"这次更新了什么"。
//
// 使用方式：云数据库集合 `app_config` 插入/更新一条：
//   {
//     _id: 'latest-version',
//     version: '1.0.15',
//     title: '这次更新',
//     notes: ['待办可以设到点提醒了', '首页输入栏不再被键盘挡住'],
//     releasedAt: '2025-01-01'
//   }
// 每次发版时改 version / title / notes / releasedAt（与 utils/config.js 的 APP_VERSION 保持一致）。
//
// 入参: 无   返回: { code, data:{ version, title, notes, releasedAt } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  try {
    const res = await db.collection('app_config').doc('latest-version').get();
    const d = (res && res.data) || {};
    const version = d.version || '';
    const title = d.title || '';
    const notes = Array.isArray(d.notes)
      ? d.notes.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 5)
      : [];
    const releasedAt = d.releasedAt || '';
    return { code: 0, message: 'ok', data: { version, title, notes, releasedAt } };
  } catch (e) {
    // 集合为空或未配置：正常返回空，前端视为"无新版本"，更新说明走本地兜底
    return { code: 0, message: 'ok', data: { version: '', title: '', notes: [], releasedAt: '' } };
  }
};

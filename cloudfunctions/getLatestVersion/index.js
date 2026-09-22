// cloudfunctions/getLatestVersion/index.js
// 返回应用的最新版本号。前端用它对比本地 APP_VERSION，
// 作为首页横幅的"极端热启动"兜底：每次回首页都无条件校验一次，
// 覆盖"从旧版一直挂后台、期间发版、从不重新冷启动"这类微信 hasUpdate 可能没点亮的场景。
//
// 使用方式：云数据库新建集合 `app_config`，插入一条：
//   { _id: 'latest-version', version: '当前发版版本号' }
// 每次发版时，把 `version` 改成最新版号（与 utils/config.js 的 APP_VERSION 保持一致）。
//
// 入参: 无   返回: { code, data:{ version } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  try {
    const res = await db.collection('app_config').doc('latest-version').get();
    const version = (res.data && res.data.version) || '';
    return { code: 0, message: 'ok', data: { version } };
  } catch (e) {
    // 集合为空或未配置：正常返回空串，前端视为"无新版本"
    return { code: 0, message: 'ok', data: { version: '' } };
  }
};
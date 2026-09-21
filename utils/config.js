// utils/config.js — 运行时配置
module.exports = {
  // 应用版本号：发版时请同步更新这里（会展示在「我的」页底部与「使用说明」页）
  APP_VERSION: '1.0.10',
  // 意见反馈：单条字数上限（需与 cloudfunctions/submitFeedback/index.js 的 MAX_LEN 一致）
  FEEDBACK_MAX_LEN: 500,
  // 相片墙卡片标题（可自定义成你们喜欢的名字）
  PHOTO_WALL_TITLE: '美好时光',
  // 开发账户 openid：只有他能在「我的」页看到「查看反馈」入口并查看全量反馈
  //（仅控制前端入口显隐；真正的权限门槛在云函数 listFeedbacks/markFeedbackRead 里）
  ADMIN_OPENID: 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg',
  // 空态引导：首页没有待办时提供的一键填充示例模板
  TODO_TEMPLATES: [
    '去超市买点牛奶和水果',
    '晚上给爸妈打个电话',
    '一起整理下照片墙',
    '周末把车开去洗一下',
  ],
  // 一起完成的里程碑：totalDone 首次达到这些数字时弹庆祝
  DONE_MILESTONES: [10, 50, 100, 200, 365, 500, 999],
};
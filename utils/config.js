// utils/config.js — 运行时配置
module.exports = {
  // 应用版本号：发版时请同步更新这里（会展示在「我的」页底部与「使用说明」页）
  APP_VERSION: '1.0.17',
  // 意见反馈：单条字数上限（需与 cloudfunctions/submitFeedback/index.js 的 MAX_LEN 一致）
  FEEDBACK_MAX_LEN: 300,
  // 笔记（随笔）字数上限（需与 cloudfunctions/todoOps/index.js 的 MAX_NOTE_LEN 一致）
  NOTE_MAX_LEN: 200,
  // 开发者 openid：仅用于「我的」页显示「反馈管理」入口。
  // 真正的权限校验在云函数 adminFeedback 内（服务端按 OPENID 判断），客户端改配置也无法越权。
  ADMIN_OPENID: 'oXz_0xVBfXW5p44Pn4vHs9CVYCVg',
  // 相片墙卡片标题（可自定义成你们喜欢的名字）
  PHOTO_WALL_TITLE: '美好时光',
  // 待办到期提醒（订阅消息）。上线前：
  //  1) 小程序后台申请「待办提醒」订阅模板，审核通过后把 Template ID 填到 REMIND_TMPL_ID；
  //  2) 字段名须与 cloudfunctions/sendReminders/index.js 的 REMIND_FIELDS 对应。
  REMIND_TMPL_ID: 'HmGE2NE95U_iq4pbEMlbq27Zx-oqc9II7vu38vQTUNg', // 「待办提醒」订阅模板 Template ID
  // 空态引导：首页没有待办时提供的一键填充示例模板
  TODO_TEMPLATES: [
    '去超市买点牛奶和水果',
    '晚上给爸妈打个电话',
    '一起整理下照片墙',
    '周末把车开去洗一下',
  ],
  // 一起完成的里程碑：totalDone 首次达到这些数字时弹庆祝
  DONE_MILESTONES: [10, 50, 100, 200, 365, 500, 999],
  // 每天一句窝心话：首页温馨卡轮播（按日期取一条，整天稳定、两人看到一致）
  WARM_PHRASES: [
    '早呀，记得好好吃早饭 🍚',
    '再忙也要抱一下 🤗',
    '今天一起加油呀 💪',
    '想早点见到你 💕',
    '多喝热水，认真的 🍵',
    '别累着，我陪着你 🛋️',
    '给你加个鸡腿吧 🍗',
    '你笑起来真好看 😊',
    '晚安，我等你说明天见 🌙',
    '给今天许个愿 🍬',
    '心有彼此就不孤单 🌷',
    '累了就歇会儿 🍃',
    '出门带件外套 🧥',
    '你是今天的第一抹好心情 ☀️',
  ],
};
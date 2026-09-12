// utils/config.js — 运行时配置
// 订阅消息模板：在公众平台「功能 → 订阅消息 → 我的模板」里申请
// templateId 出现两处，需保持一致：
//   1. 这里（前端 requestSubscribeMessage 用）
//   2. cloudfunctions/reminderTrigger/config.js（后端 send 用）

module.exports = {
  // 一次性订阅消息模板：温馨提醒 / 日期
  REMIND_TMPL_ID: 'GRh-zhM_vG7yqEgaPXN58yNdc3xoOsTkCxYYkK6Znzk',
  // 触发位置：待办列表页（发送后点击通知会跳到此处）
  REMIND_TMPL_PAGE: 'pages/index/index',
};
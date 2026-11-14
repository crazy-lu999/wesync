// utils/share.js — 分享卡片
// 两种语境，文案分开，都控制在 10 字内（微信卡片标题过长会被截断成「…」）：
//  ① 带邀请码（家庭还有空位）：邀请另一半加入 → 落到加入页并预填邀请码
//  ② 不带邀请码（拉新 / 家庭已满）：通用品牌卡 → 首页，引导新用户建自己的小家
//
// 预览图说明：不传 imageUrl，由微信自动截取当前页面作为卡片图。
// 若要换回自定义图，只需 return 里补上 imageUrl（建议 5:4、750×600、文字居中留足边距、不用 emoji）。

// ① 邀请卡：对方点开就能加入
const TITLE_INVITE = '点开加入小家 💕';
// ② 品牌卡：拉新
const TITLE_BRAND = '一起记小日常 💕';

/**
 * 构造分享对象（onShareAppMessage 直接 return）
 * @param {{ inviteCode?: string }} opts
 */
function buildShare(opts) {
  const code = opts && opts.inviteCode ? String(opts.inviteCode).trim() : '';
  const path = code ? `/pages/join/join?inviteCode=${code}` : '/pages/index/index';
  return { title: code ? TITLE_INVITE : TITLE_BRAND, path };
}

module.exports = { buildShare };

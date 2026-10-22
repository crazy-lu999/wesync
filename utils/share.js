// utils/share.js — 品牌分享卡片（统一一张卡，一律引导新用户建新家）
// 本小程序的产品增长方向：靠"晒记录"吸引新的家庭来用。
// 所以无论谁、在哪个页面分享，都用同一张品牌卡，终点都指向首页，
// 让还没用过的用户点开 → 自己创建新家庭 → 再各自邀自己的伴侣（绑定走 app 内输码流程）。

// 分享卡片统一预览图（微信分享时会显示在小卡片上）与统一文案
const SHARE_IMAGE = '/images/share_card.png';
const SHARE_TITLE = '和 TA 一起记小日常，点开建你们的小家 💕';

/**
 * 构造品牌分享对象（onShareAppMessage 直接 return）
 * 参数为空设计：分享诉求只有一种——拉新家庭。伴侣绑定请走 app 内输邀请码流程。
 */
function buildShare() {
  return { title: SHARE_TITLE, path: '/pages/index/index', imageUrl: SHARE_IMAGE };
}

module.exports = { buildShare };
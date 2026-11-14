// utils/release-notes.js — 本地更新说明兜底
//
// 用途：
//   1) 新版本启动后弹「本次更新」说明；
//   2) 「更新日志」页展示最近几个版本；
//   3) 云端 app_config 没配、网络失败、或云端版本号与本地对不上时，仍能正常展示。
//
// 发版时：把新版本放在数组最前面，notes 写 1~3 条用户能看懂的话，
// 不要写技术实现，也不要出现「公开 / 社区 / 社交 / 点赞」等容易引起审核联想的词。
const RELEASE_NOTES = [
  {
    version: '1.0.17',
    title: '这次更新',
    notes: [
      '新增「我们的记录」：随手记点想留的话，长按待办也能转成记录',
      '首页新增记录入口，想写什么点一下就能记',
      '记录可随时转回待办，两人实时同步',
    ],
  },
  {
    version: '1.0.16',
    title: '这次更新',
    notes: [
      '用起来更跟手更稳了：勾选、删除点完立刻生效，不会再闪一下又变回去',
      '相片墙打开更顺，照片不再重新加载一闪',
      '「我的」页小改版：两个人的头像各有一抹颜色，纪念日卡片也变得暖暖的',
    ],
  },
  {
    version: '1.0.15',
    title: '这次更新',
    notes: [
      '待办可以设置到点提醒，到点微信通知你',
      '意见反馈通道优化，有想法可以悄悄告诉我们',
      '修复了一些体验问题，用起来更顺手',
    ],
  },
  {
    version: '1.0.14',
    title: '一起庆祝的小功能',
    notes: [
      '累计完成 10 / 50 / 100… 件时，会一起庆祝',
      '纪念日可以添加多个，带标题和倒计时',
      '相片墙支持自定义标题',
    ],
  },
];

function clone(item) {
  return {
    version: item.version,
    title: item.title || '',
    notes: (item.notes || []).slice(),
    date: item.date || '',
  };
}

// 取指定版本的本地说明；没有返回 null
function getLocalRelease(version) {
  const item = RELEASE_NOTES.find((x) => x.version === version);
  return item ? clone(item) : null;
}

// 完整历史（新版本在前）
function getHistory() {
  return RELEASE_NOTES.map(clone);
}

module.exports = { getLocalRelease, getHistory };

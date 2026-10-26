// cloudfunctions/updateAvatar/index.js
// 入参: { avatar }  返回: { code, message, data:{ avatar } }
// 把当前用户（OPENID）的头像（云存储 fileID）写入自己家族 memberAvatars 字段，不动其他成员。
// avatar 为微信头像经云存储上传后的 fileID（cloud://...）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const avatar = String(event.avatar || '').trim();

  if (!avatar || !avatar.startsWith('cloud://')) {
    return { code: 1, message: '头像地址无效' };
  }

  // 找到当前用户所在家庭
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (!res.data.length) {
    return { code: 3, message: '你还未加入任何家庭' };
  }
  const family = res.data[0];

  // 用点号路径动态更新当前用户对应的头像字段
  await db.collection('families').doc(family._id).update({
    data: {
      ['memberAvatars.' + OPENID]: avatar,
    },
  });

  return { code: 0, message: '头像已更新', data: { avatar } };
};
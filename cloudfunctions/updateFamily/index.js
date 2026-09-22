// cloudfunctions/updateFamily/index.js
// 家庭照片墙的后端写操作（服务端写，openid 由云端取，不可伪造）。
// 入参:
//   action: 'addPhotos'  另传 { fileIDs: ['cloud://...', ...] }
//   action: 'removePhoto' 另传 { fileID: 'cloud://...' }
//   action: 'rename'      另传 { name: '新家庭名' }
//   action: 'setCover'    另传 { fileID: 'cloud://...' }（空串=取消封面）
//   action: 'setWallTitle' 另传 { wallTitle: '...' }
// 返回: { code, message, data:{ photos, name } }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const MAX_PHOTOS = 9; // 相片墙上限

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action } = event || {};

  // 找到当前用户所在家庭
  const res = await db.collection('families').where({ members: OPENID }).limit(1).get();
  if (!res.data.length) return { code: -1, message: '未找到你的家庭' };
  const fam = res.data[0];
  const famRef = db.collection('families').doc(fam._id);

  // —— 新增照片 ——
  if (action === 'addPhotos') {
    const photos = fam.photos || [];
    const merge = [];
    const fileIDs = Array.isArray(event.fileIDs) ? event.fileIDs : [];
    for (const fid of fileIDs) {
      if (typeof fid === 'string' && fid && !photos.includes(fid) && !merge.includes(fid)) {
        merge.push(fid);
      }
    }
    if (!merge.length) return { code: 0, message: '无新增照片', data: { photos } };

    let all = photos.concat(merge);
    const finalList = all.slice(0, MAX_PHOTOS);
    const dropped = all.slice(MAX_PHOTOS);
    if (dropped.length) {
      try { await cloud.deleteFile({ fileList: dropped }); } catch (e) { console.error(e); }
    }
    await famRef.update({ data: { photos: finalList } });
    return { code: 0, message: '已添加', data: { photos: finalList } };
  }

  // —— 删除一张照片 ——
  if (action === 'removePhoto') {
    const fileID = event.fileID;
    // 删除后若删掉的正是封面，顺带清空 cover
    const photos = (fam.photos || []).filter((f) => f !== fileID);
    const data = { photos };
    if ((fam.cover || '') === fileID) data.cover = '';
    await famRef.update({ data });
    // 尽力清理云存储，失败不影响数据一致性
    if (fileID) {
      try { await cloud.deleteFile({ fileList: [fileID] }); } catch (e) { console.error(e); }
    }
    return { code: 0, message: '已删除', data: { photos } };
  }

  // —— 修改家庭名 ——
  if (action === 'rename') {
    const name = (event.name || '').trim().slice(0, 20);
    if (!name) return { code: -1, message: '家庭名不能为空' };
    await famRef.update({ data: { name } });
    return { code: 0, message: '已改名', data: { name } };
  }

  // —— 设/取消封面 ——
  if (action === 'setCover') {
    const fileID = event.fileID || '';
    // coverSource：裁剪封面的来源原图 fileID（供“重新裁剪”时回原图，而非在裁过的图上二次裁剪）
    const source = event.source || (fileID && (fam.photos || []).includes(fileID) ? fileID : '');
    const data = { cover: fileID };
    if (fileID) {
      const photos = fam.photos || [];
      // 封面允许两种：相片墙里已有的照片，或裁剪后的独立封面文件(covers/… 由前端 wx.cropImage 生成上传)
      const isCropCover = typeof fileID === 'string' && fileID.indexOf('covers/') !== -1;
      if (!photos.includes(fileID) && !isCropCover) return { code: -1, message: '仅可设为已有照片' };
      // 整图封面：来源即它自己；裁剪封面：来源为传入的 source（为空则回退为旧 coverSource 或空）
      data.coverSource = !isCropCover ? fileID : (source || (fam.coverSource || ''));
    } else {
      data.coverSource = ''; // 取消封面时一并清来源
    }
    await famRef.update({ data });
    // 主动清理旧封面孤儿文件：只删“裁剪产生的封面(covers/…)”且不再是当前封面/照片墙引用的
    const oldCover = (fam.cover || '');
    const isHiddenCropCover =
      oldCover &&
      oldCover.indexOf('covers/') !== -1 &&
      oldCover !== fileID &&
      !(fam.photos || []).includes(oldCover);
    if (isHiddenCropCover) {
      try { await cloud.deleteFile({ fileList: [oldCover] }); } catch (e) { console.error(e); }
    }
    return { code: 0, message: 'ok', data: { cover: fileID, photos: fam.photos || [] } };
  }

  // —— 修改相片墙标题 ——
  if (action === 'setWallTitle') {
    const wallTitle = (event.wallTitle || '').trim().slice(0, 12);
    if (!wallTitle) return { code: -1, message: '标题不能为空' };
    await famRef.update({ data: { wallTitle } });
    return { code: 0, message: '已保存', data: { wallTitle } };
  }

  // —— 悄悄话留言墙 ——
  if (action === 'setNote') {
    const text = (event.text || '').trim().slice(0, 100);
    if (!text) return { code: -1, message: '留言不能为空' };
    const nicks = fam.memberNicks || {};
    const nick = nicks[OPENID] || '我';
    await famRef.update({ data: { note: { text, nick, time: db.serverDate() } } });
    return { code: 0, message: '已留言', data: { note: { text, nick } } };
  }

  return { code: -1, message: '未知操作' };
};
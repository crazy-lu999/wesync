// utils/db.js — 云数据库与云函数封装
// 待办读取用客户端 watch 实时订阅（即时反映对方改动），失败自动降级为轮询；
// 待办写入走云函数 todoOps（服务端写，openid 不可伪造，且不依赖客户端写规则）；
// 家庭相关走云函数（openid 由云端取，不可伪造）。

const db = wx.cloud.database();
const _ = db.command;
const todos = db.collection('todos');

// —— 云函数调用封装 ——
function call(name, data = {}) {
  return wx.cloud.callFunction({ name, data }).then((res) => {
    if (res.result && res.result.code === 0) return res.result.data;
    const msg = (res.result && res.result.message) || '操作失败';
    return Promise.reject(new Error(msg));
  });
}

// 家庭相关
const createFamily = (myNick) => call('createFamily', { myNick });
const joinFamily = (inviteCode, myNick) => call('joinFamily', { inviteCode, myNick });
const getMyFamily = () => call('getMyFamily', {});
const leaveFamily = () => call('leaveFamily', {});
const updateNickname = (nick) => call('updateNickname', { nick });
// 设置用户在家庭里的头像（微信头像经云存储上传后的 fileID）
const updateAvatar = (fileID) => call('updateAvatar', { avatar: fileID });
// 建议墙（公开）：提交一条公开建议（昵称与头像均存快照，避免随改名/改头像而变化）
const submitFeedback = (content, nick, avatar) => call('submitFeedback', { content, nick, avatar });
// 读取公开建议墙（开发者动态 + 全部建议，含状态/回复/isMine）
const listWall = () => call('listFeedbacks', {});
// 公开建议墙：点赞 / 取消点赞一条建议（返回最新 liked/count）
const toggleWallLike = (id) => call('toggleWallLike', { id });
// 建议墙管理（仅开发账户）：标记状态/回复/删除/发动态
const wallSetStatus = (id, status) => call('manageWall', { action: 'setStatus', id, status });
const wallReply = (id, reply) => call('manageWall', { action: 'reply', id, reply });
const wallDelete = (id) => call('manageWall', { action: 'delete', id });
const wallPostUpdate = (content) => call('manageWall', { action: 'postUpdate', content });
// 家庭照片墙 / 相片墙标题 / 纪念日（服务端写）
const addFamilyPhotos = (fileIDs) => call('updateFamily', { action: 'addPhotos', fileIDs });
const removeFamilyPhoto = (fileID) => call('updateFamily', { action: 'removePhoto', fileID });
const setWallTitle = (wallTitle) => call('updateFamily', { action: 'setWallTitle', wallTitle });
// 纪念日（可多个，各含标题+日期）：新增 / 编辑 / 删除
const addAnniversary = (id, title, date) => call('updateFamily', { action: 'addAnniversary', id, title, date });
const editAnniversary = (id, title, date) => call('updateFamily', { action: 'editAnniversary', id, title, date });
const removeAnniversary = (id) => call('updateFamily', { action: 'removeAnniversary', id });

// —— 待办 CRUD（走云函数 todoOps 服务端写，绕开客户端安全规则的脆弱配置）——
// 读取仍用客户端 watch（安全规则只挡写，读已正常）
async function addTodo(familyId, content, openid, creatorNick, deadline, assignee) {
  await call('todoOps', {
    action: 'add',
    familyId,
    content,
    openid,
    creatorNick: creatorNick || '我',
    deadline: deadline || '',
    assignee: assignee || '',
  });
}

async function toggleTodo(id, done) {
  // 返回 { totalDone }（家庭累计完成件数，用于里程碑）
  return call('todoOps', { action: 'toggle', id, done });
}

// 标记/取消「重要」
async function setImportant(id, important) {
  await call('todoOps', { action: 'important', id, important });
}

// 一键清空该家庭全部已完成
async function clearDoneTodos() {
  await call('todoOps', { action: 'clearDone' });
}

async function removeTodo(id) {
  await call('todoOps', { action: 'remove', id });
}

async function editTodo(id, content, deadline) {
  await call('todoOps', { action: 'edit', id, content, deadline: deadline || '' });
}

// 指派/取消指派待办给某成员（openid，空串=两人一起）
const assignTodo = (id, assignee) => call('todoOps', { action: 'assign', id, assignee: assignee || '' });

// 服务端读当前家庭待办（绕过脆弱的客户端 read 规则，稳定可靠）
const getMyTodos = () => call('getMyTodos', {});

// 实时订阅本家庭 todos（客户端 watch）。返回关闭函数。
// 注意：实时推送不支持 orderBy，排序由前端 renderTodos 完成。
// 需第 3 方源：todos 集合开通「实时数据推送」并配读规则 auth.openid in doc.members。
function subscribeTodos(familyId, onChange, onError) {
  const watcher = todos
    .where({ familyId })
    .watch({
      onChange(snapshot) {
        if (snapshot.type === 'init') {
          onChange(snapshot.docs, { type: 'init' });
        } else {
          onChange(snapshot.docs, { type: 'update', docChanges: snapshot.docChanges });
        }
      },
      onError(err) {
        console.error('[watch] todos error', err);
        onError && onError(err);
      },
    });
  return () => watcher.close();
}

module.exports = {
  _,
  db,
  createFamily,
  joinFamily,
  getMyFamily,
  leaveFamily,
  updateNickname,
  updateAvatar,
  submitFeedback,
  listWall,
  toggleWallLike,
  wallSetStatus,
  wallReply,
  wallDelete,
  wallPostUpdate,
  addFamilyPhotos,
  removeFamilyPhoto,
  setWallTitle,
  addAnniversary,
  editAnniversary,
  removeAnniversary,
  addTodo,
  toggleTodo,
  setImportant,
  assignTodo,
  clearDoneTodos,
  editTodo,
  removeTodo,
  getMyTodos,
  subscribeTodos,
};

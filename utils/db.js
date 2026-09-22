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
const createFamily = (familyName, myNick) => call('createFamily', { familyName, myNick });
const joinFamily = (inviteCode, myNick) => call('joinFamily', { inviteCode, myNick });
const getMyFamily = () => call('getMyFamily', {});
const leaveFamily = () => call('leaveFamily', {});
const updateNickname = (nick) => call('updateNickname', { nick });
const submitFeedback = (content, nick) => call('submitFeedback', { content, nick });
// 反馈管理（家庭成员可见）：拉列表 / 标记已读
const listFeedbacks = () => call('listFeedbacks', {});
const markFeedbackRead = (id) => call('markFeedbackRead', { id });
// 家庭照片墙 / 家庭名修改（服务端写）
const addFamilyPhotos = (fileIDs) => call('updateFamily', { action: 'addPhotos', fileIDs });
const removeFamilyPhoto = (fileID) => call('updateFamily', { action: 'removePhoto', fileID });
const renameFamily = (name) => call('updateFamily', { action: 'rename', name });
const setWallTitle = (wallTitle) => call('updateFamily', { action: 'setWallTitle', wallTitle });
const setCover = (fileID, source) => call('updateFamily', { action: 'setCover', fileID, source });
// 悄悄话留言墙
const setNote = (text) => call('updateFamily', { action: 'setNote', text });

// —— 待办 CRUD（走云函数 todoOps 服务端写，绕开客户端安全规则的脆弱配置）——
// 读取仍用客户端 watch（安全规则只挡写，读已正常）
async function addTodo(familyId, content, openid, creatorNick, deadline) {
  await call('todoOps', {
    action: 'add',
    familyId,
    content,
    openid,
    creatorNick: creatorNick || '我',
    deadline: deadline || '',
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
  submitFeedback,
  listFeedbacks,
  markFeedbackRead,
  addFamilyPhotos,
  removeFamilyPhoto,
  renameFamily,
  setWallTitle,
  setCover,
  setNote,
  addTodo,
  toggleTodo,
  setImportant,
  clearDoneTodos,
  editTodo,
  removeTodo,
  getMyTodos,
  subscribeTodos,
};

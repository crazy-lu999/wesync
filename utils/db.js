// utils/db.js — 云数据库与云函数封装
// 待办读取用客户端 watch 实时订阅（即时反映对方改动），失败自动降级为轮询；
// 待办写入走云函数 todoOps（服务端写，openid 不可伪造，且不依赖客户端写规则）；
// 家庭相关走云函数（openid 由云端取，不可伪造）。

const db = wx.cloud.database();
const config = require('./config');
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
// 最新版本 + 更新说明（app_config 的 latest-version）
const getLatestRelease = () => call('getLatestVersion', {});
const updateNickname = (nick) => call('updateNickname', { nick });
// 意见反馈（私密）：提交一条反馈，仅开发者可查看，不提供任何公开列表/点赞/回复能力
const submitFeedback = (content) => call('submitFeedback', { content });
// 反馈管理（仅开发者本人）：服务端校验 openid，非开发者一律拒绝
const adminListFeedback = () => call('adminFeedback', { action: 'list' });
const adminMarkFeedbackRead = (id) => call('adminFeedback', { action: 'markRead', id });
const adminDeleteFeedback = (id) => call('adminFeedback', { action: 'delete', id });
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
// 返回 { id }：前端拿到 id 后可以本地直接把新条目插进列表，不必再拉一次全量
async function addTodo(familyId, content, openid, creatorNick, remindAt) {
  return call('todoOps', {
    action: 'add',
    familyId,
    content,
    openid,
    creatorNick: creatorNick || '我',
    remindAt: remindAt || '',
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

async function editTodo(id, content, remindAt) {
  await call('todoOps', { action: 'edit', id, content, remindAt: remindAt || '' });
}

// 服务端读当前家庭待办（绕过脆弱的客户端 read 规则，稳定可靠）
const getMyTodos = () => call('getMyTodos', {});

// 待办提醒：请求「订阅消息」授权（一次性，点一次授一条）。
// ⚠️ 必须在用户点击事件的**同步链路**里调用：一旦先 await 云函数（添加/保存），
// 手势上下文丢失，微信会直接 fail（表现为“总是未开启提醒”）。
// 未填模板 ID 时直接返回 false，不弹窗、不报错。
function requestTodoReminder() {
  const tmplId = config.REMIND_TMPL_ID || '';
  if (!tmplId || tmplId.indexOf('请填写') === 0) {
    console.warn('[remind] 未配置 REMIND_TMPL_ID，跳过订阅授权');
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [tmplId],
      success: (res) => {
        // accept=同意接收，reject=拒绝，ban=已拒绝过，filter=模板被过滤
        const state = res[tmplId];
        resolve(state === 'accept');
      },
      fail: (err) => {
        // 常见：20004 用户设置关闭、20001 模板不存在/未审核、
        // 或“can only be invoked by user TAP gesture”（调用时机不对）
        console.error('[remind] requestSubscribeMessage fail', err);
        resolve(false);
      },
    });
  });
}

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
        // 光打印 err 在开发者工具里只会看到个 minified 的 "T"，真正能定位的是 errCode/errMsg：
        //   -501007 / PERMISSION_DENIED 之类 = 读规则拦了（含「有一条文档读不了」的情况）
        //   实时数据推送未开通 = 集合能力没开
        console.error('[watch] todos error', err && err.errCode, (err && err.errMsg) || err);
        onError && onError(err);
      },
    });
  return () => watcher.close();
}

module.exports = {
  createFamily,
  joinFamily,
  getMyFamily,
  leaveFamily,
  getLatestRelease,
  updateNickname,
  submitFeedback,
  adminListFeedback,
  adminMarkFeedbackRead,
  adminDeleteFeedback,
  addFamilyPhotos,
  removeFamilyPhoto,
  setWallTitle,
  addAnniversary,
  editAnniversary,
  removeAnniversary,
  addTodo,
  toggleTodo,
  setImportant,
  clearDoneTodos,
  editTodo,
  removeTodo,
  getMyTodos,
  subscribeTodos,
  requestTodoReminder,
};

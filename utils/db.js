// utils/db.js — 云数据库与云函数封装
// 待办走客户端直连云数据库（支持 watch 实时订阅）；
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

// —— 待办 CRUD（走云函数 todoOps 服务端写，绕开客户端安全规则的脆弱配置）——
// 读取仍用客户端 watch（安全规则只挡写，读已正常）
async function addTodo(familyId, content, openid, creatorNick) {
  await call('todoOps', {
    action: 'add',
    familyId,
    content,
    openid,
    creatorNick: creatorNick || '我',
  });
}

async function toggleTodo(id, done) {
  await call('todoOps', { action: 'toggle', id, done });
}

async function removeTodo(id) {
  await call('todoOps', { action: 'remove', id });
}

// 服务端读当前家庭待办（绕过脆弱的客户端 read 规则，稳定可靠）
const getMyTodos = () => call('getMyTodos', {});

// 实时订阅本家庭 todos。返回关闭函数。
function subscribeTodos(familyId, onChange, onError) {
  const watcher = todos
    .where({ familyId })
    .orderBy('done', 'asc')
    .orderBy('createTime', 'desc')
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
  addTodo,
  toggleTodo,
  removeTodo,
  getMyTodos,
  subscribeTodos,
};

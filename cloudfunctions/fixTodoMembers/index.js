// cloudfunctions/fixTodoMembers/index.js —— 一次性数据修复工具（不是业务函数）
//
// 作用：把 todos 的 members 字段对齐成「所属家庭的当前 members」。
//
// 为什么必须修：
//   前端 watch 依赖安全规则 auth.openid in doc.members，而 watch 的权限校验是
//   **整查询级**的 —— 只要查询结果里有一条文档当前用户读不了，整个 watch 就建立失败
//   （SDK 判定为 onNotRetryableError，不会自动重试），前端只能降级成轮询，又卡又费额度。
//   容易踩雷的文档：
//     · 早期创建、压根没写 members 的老待办；
//     · members 还是旧成员快照、不含后来加入的那一半；
//     · members 被写成字符串/对象等非数组脏数据；
//     · familyId 指向已不存在的家庭（孤儿）。
//
// 用法（开发者工具 → cloudfunctions → fixTodoMembers → 上传并部署：云端安装依赖）：
//   1) 云端测试传 {}                → 试运行，只返回报告，不写库；
//   2) 云端测试传 { "apply": true } → 真正写入；
//   3) 需要顺手删掉找不到家庭的孤儿待办：{ "apply": true, "removeOrphans": true }
// 可选参数：
//   apply         true 才真正写库（默认 false = 试运行）
//   removeOrphans true = 删除孤儿待办（默认保留，只在报告里列出）
//   pageSize      每批读取条数（默认 100，上限 1000）
//
// 说明：本函数是幂等的 —— 只改「不一致」的文档，可以反复跑；待办特别多导致超时的话，
//      把该云函数的超时时间调到 60s，或者直接再跑一次即可接着修。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 写库并发度：太大容易触发限流，20 比较稳
const WRITE_CONCURRENCY = 20;

// 归一化：只保留非空字符串；非数组一律视为空（脏数据）
const normMembers = (m) => (Array.isArray(m) ? m.filter((x) => typeof x === 'string' && x) : []);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// 用 _id 游标翻页（不用 skip：边读边删时 skip 分页会漏数据）
async function fetchAll(name, fields, pageSize) {
  const out = [];
  let lastId = '';
  for (;;) {
    let q = db.collection(name).orderBy('_id', 'asc').limit(pageSize);
    if (fields) q = q.field(fields);
    if (lastId) q = q.where({ _id: _.gt(lastId) });
    const r = await q.get();
    const rows = r.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    lastId = rows[rows.length - 1]._id;
  }
  return out;
}

async function runInChunks(items, fn) {
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(fn));
  }
}

exports.main = async (event = {}) => {
  const apply = !!event.apply;
  const removeOrphans = !!event.removeOrphans;
  const pageSize = Math.min(Math.max(Number(event.pageSize) || 100, 1), 1000);

  // 1) 家庭表（量很小）：建 familyId → 当前 members（排序后便于比较）
  const families = await fetchAll('families', { members: true, memberNicks: true }, pageSize);
  const famMap = {};
  families.forEach((f) => { famMap[f._id] = normMembers(f.members).slice().sort(); });

  // 2) 巡检 todos：只判定、只读，先攒出待修清单
  const todos = await fetchAll('todos', { familyId: true, members: true, content: true }, pageSize);
  const toFix = []; // { id, from, to }
  const orphans = []; // { id, familyId }
  const report = {
    dryRun: !apply,
    families: families.length,
    total: todos.length,
    alreadyOk: 0,
    fixed: 0,
    orphans: 0,
    removed: 0,
    samples: [],
  };

  for (const t of todos) {
    const want = famMap[t.familyId];
    if (!want || !want.length) {
      orphans.push({ id: t._id, familyId: t.familyId || null });
      if (report.samples.length < 10) {
        report.samples.push({ id: t._id, action: 'orphan', familyId: t.familyId || null, content: String(t.content || '').slice(0, 20) });
      }
      continue;
    }
    const have = normMembers(t.members).slice().sort();
    if (sameList(have, want)) { report.alreadyOk += 1; continue; }
    toFix.push({ id: t._id, from: have, to: want });
    if (report.samples.length < 10) report.samples.push({ id: t._id, action: 'fix', from: have, to: want });
  }
  report.fixed = toFix.length;
  report.orphans = orphans.length;

  // 3) 真正写入（幂等：只动不一致的那些）
  if (apply) {
    await runInChunks(toFix, (x) => db.collection('todos').doc(x.id).update({ data: { members: x.to } }));
    if (removeOrphans) {
      await runInChunks(orphans, (x) => db.collection('todos').doc(x.id).remove());
      report.removed = orphans.length;
    }
  }

  console.log('[fixTodoMembers]', JSON.stringify(report));
  return {
    code: 0,
    message: apply ? '已修复（可再跑一次确认 fixed=0），现在可以把 todos 权限改回自定义规则了' : '试运行（未写库）；确认后传 {"apply":true} 执行',
    data: report,
  };
};

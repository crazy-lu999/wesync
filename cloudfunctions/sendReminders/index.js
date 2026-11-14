// cloudfunctions/sendReminders/index.js — 待办「自定义时刻提醒」定时触发器
// 定时配置见 config.json（7 段 cron：秒 分 时 日 月 星期 年，"0 * * * * * *" = 每分钟触发）。
// 到点逻辑：扫「已设 remindAt（精确到分钟） + 未完成 + 还没提醒过」的待办，
// 对家庭两位成员各发一条订阅消息，并把该待办标记 reminded=true，避免同一时刻反复重发。
//
// —— 发送通道（双通道，自动降级）——
//  ① 云调用：cloud.openapi.subscribeMessage.send
//     优点零配置；但部分环境下会报 -501001 INVALID_WX_ACCESS_TOKEN（平台拿不到凭证）。
//  ② HTTP 直连：自己用 AppID + AppSecret 换 access_token，再调
//     api.weixin.qq.com/cgi-bin/message/subscribe/send
//     ① 失败时自动走这条，需要配置云函数环境变量 WX_APPID / WX_SECRET。
//
// —— 配置（云开发控制台 → 云函数 → sendReminders → 配置 → 环境变量）——
//   WX_APPID  = 小程序 AppID（如 wx7457c832732036aa）
//   WX_SECRET = 小程序 AppSecret（后台「开发管理 → 开发设置」生成，切勿写进代码/仓库）
//
// —— 自测 ——
//   { "action": "diagnose" }                                    诊断两条通道是否可用
//   { "action": "test", "openid": "...", "content": "测试提醒" }  立即发一条，返回详细错误
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// —— 订阅模板配置（需与小程序后台审核通过的模板保持一致）——
const REMIND_TMPL_ID = 'HmGE2NE95U_iq4pbEMlbq27Zx-oqc9II7vu38vQTUNg';
const REMIND_FIELDS = {
  thing: 'thing1', // 待办事项（thing 类型限 20 字，自动截断）
  time:  'time3',  // 提醒时间（time 类型，如 2024-10-30 18:30）
};
// 跳转落地页
const PAGE = 'pages/index/index';
// 消息跳转的小程序版本：developer=开发版（预览调试用） / trial=体验版 / formal=正式版
// 优先读环境变量 MINI_STATE，否则默认 developer。
// ⚠️ 上线正式版前，把云函数环境变量 MINI_STATE 设为 formal，无需改代码重发。
const MINIPROGRAM_STATE = ((process.env.MINI_STATE || '').trim()) || 'developer';
// 补发窗口（毫秒）：到点没发成功的，在 30 分钟内仍会继续重试（已发成功的成员不会重发）。
// 同时也兼容了定时器 1~2 分钟的抖动，不会因为抖动而漏发。
const RETRY_WINDOW_MS = 30 * 60 * 1000;
// 最多尝试次数：额度类错误（如 43101）每分钟重试一次很浪费，封顶后放弃。
const MAX_TRIES = 5;
// 单次扫描上限
const SCAN_LIMIT = 100;

const p2 = (x) => String(x).padStart(2, '0');

// 把某个 epoch 毫秒时间格式化成中国时区（UTC+8）的可读「YYYY-MM-DD HH:MM」
function fmtCN(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

// —— 极简 HTTPS JSON 请求（不引入额外依赖）——
function requestJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        timeout: 8000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`响应解析失败：${raw.slice(0, 200)}`)); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// —— 凭证读取 ——
// 支持两种配置方式（云开发控制台有的版本只能加一个环境变量，所以支持合写）：
//  方式 A：WX_APPID + WX_SECRET 两个变量
//  方式 B：单个变量 WX_CRED，值为 "appid,secret" 或 JSON {"appid":"..","secret":".."}
function readCred() {
  let appid = (process.env.WX_APPID || '').trim();
  let secret = (process.env.WX_SECRET || '').trim();
  const cred = (process.env.WX_CRED || '').trim();
  if (cred && (!appid || !secret)) {
    try {
      if (cred.charAt(0) === '{') {
        const j = JSON.parse(cred);
        appid = String(j.appid || j.appId || '').trim();
        secret = String(j.secret || j.appSecret || '').trim();
      } else {
        // 「appid,secret」/「appid:secret」都能识别（AppSecret 是 32 位十六进制，不含分隔符）
        const parts = cred.split(/[,;:\s]+/).filter(Boolean);
        appid = (parts[0] || '').trim();
        secret = (parts[1] || '').trim();
      }
    } catch (e) { /* 解析失败则视为未配置 */ }
  }
  return { appid, secret };
}

const WX_APPID = () => readCred().appid;
const WX_SECRET = () => readCred().secret;

// access_token 内存缓存（有效期 7200s，提前 5 分钟过期）
let TOKEN_CACHE = { value: '', expireAt: 0 };

async function getAccessToken(force) {
  const appid = WX_APPID();
  const secret = WX_SECRET();
  if (!appid || !secret) {
    throw new Error('未配置云函数环境变量 WX_APPID / WX_SECRET（云函数 → 配置 → 环境变量）');
  }
  if (!force && TOKEN_CACHE.value && Date.now() < TOKEN_CACHE.expireAt) return TOKEN_CACHE.value;
  const r = await requestJson(
    'GET',
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
  );
  if (!r.access_token) {
    // 40125 = AppSecret 不对；40164 = 调用来源 IP 不在白名单
    throw new Error(`获取 access_token 失败 ${r.errcode || ''}: ${r.errmsg || JSON.stringify(r)}`);
  }
  TOKEN_CACHE = { value: r.access_token, expireAt: Date.now() + (Number(r.expires_in || 7200) - 300) * 1000 };
  return TOKEN_CACHE.value;
}

// 通道①：云调用
async function sendByCloudCall(openid, content, timeText) {
  const data = {};
  data[REMIND_FIELDS.thing] = { value: String(content || '').slice(0, 20) };
  data[REMIND_FIELDS.time] = { value: timeText };
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      page: PAGE,
      lang: 'zh_CN',
      data,
      miniprogramState: MINIPROGRAM_STATE,
    });
    return { ok: true, via: 'cloudCall' };
  } catch (e) {
    return {
      ok: false,
      via: 'cloudCall',
      errCode: (e && e.errCode) || 0,
      errMsg: (e && (e.errMsg || e.message)) || String(e),
    };
  }
}

// 通道②：HTTP 直连（自换 access_token）
async function sendByHttp(openid, content, timeText) {
  const payload = {
    touser: openid,
    template_id: REMIND_TMPL_ID,
    page: PAGE,
    miniprogram_state: MINIPROGRAM_STATE,
    lang: 'zh_CN',
    data: {},
  };
  payload.data[REMIND_FIELDS.thing] = { value: String(content || '').slice(0, 20) };
  payload.data[REMIND_FIELDS.time] = { value: timeText };
  try {
    let token = await getAccessToken(false);
    let url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`;
    let r = await requestJson('POST', url, payload);
    // token 失效：强制刷新后重试一次
    if (r.errcode === 40001 || r.errcode === 42001) {
      token = await getAccessToken(true);
      url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`;
      r = await requestJson('POST', url, payload);
    }
    if (r.errcode) return { ok: false, via: 'http', errCode: r.errcode, errMsg: r.errmsg };
    return { ok: true, via: 'http' };
  } catch (e) {
    return { ok: false, via: 'http', errCode: 0, errMsg: (e && e.message) || String(e) };
  }
}

// 常见错误码 → 人话（方便直接判断问题）
const ERR_HINT = {
  40003: 'openid 不属于该小程序',
  40037: '模板 ID 无效：模板已被删除/未审核通过，或被重新申请过（ID 会变）',
  40125: 'AppSecret 不正确',
  40164: '调用 IP 不在白名单（建议把 IP 白名单清空）',
  43101: '该用户没有订阅额度（未授权或已用完，需重新授权）',
  47003: '模板参数不符合规则（字段名或格式与模板不一致）',
  41030: 'page 路径不对或小程序版本状态不匹配',
  42001: 'access_token 过期（已自动刷新重试）',
};
const hintOf = (code, fallback) => `${code || ''} ${ERR_HINT[code] || fallback || ''}`.trim();

// 双通道发送：先云调用，失败就走 HTTP（两条通道行为可能不一致，只要有一条成功就算成功）
async function sendOne(openid, content, timeText) {
  const first = await sendByCloudCall(openid, content, timeText);
  if (first.ok) return first;
  const second = await sendByHttp(openid, content, timeText);
  if (second.ok) return second;
  // 两条都失败：优先报 HTTP 的错（更具体），并把云调用的错一并带上
  return {
    ok: false,
    via: 'http',
    errCode: second.errCode || first.errCode,
    errMsg: hintOf(second.errCode || first.errCode, second.errMsg || first.errMsg),
    cloudCallErr: first.errMsg,
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();

  // —— 检查模式：看待办的 remindAt / reminded / done 以及是否落在发送窗口里 ——
  // 用法：云端测试入参 { "action": "inspect" }
  if (event && event.action === 'inspect') {
    const nowMs = Date.now();
    const since = nowMs - RETRY_WINDOW_MS;
    const r = await db.collection('todos')
      .where({ remindAt: _.gt(0) })
      .orderBy('createTime', 'desc')
      .limit(10)
      .get();
    const list = (r.data || []).map((t) => ({
      id: t._id,
      content: t.content,
      done: !!t.done,
      reminded: !!t.reminded,
      remindAt: t.remindAt,
      remindAtText: fmtCN(t.remindAt),
      已发给: t.remindSentTo || [],
      尝试次数: t.remindTries || 0,
      上次错误: t.remindError || '',
      本次触发会扫到: !t.done && !t.reminded && t.remindAt >= since && t.remindAt <= nowMs,
      状态说明: t.done ? '已完成→不发'
        : t.reminded ? 'reminded=true→已全部发送成功'
        : t.remindAt > nowMs ? '还没到点'
        : t.remindAt >= since ? '在补发窗口内→本次触发会（重）试'
        : '已超过 30 分钟补发窗口→放弃',
    }));
    return {
      code: 0,
      data: {
        服务器时间: fmtCN(nowMs),
        服务器毫秒: nowMs,
        补发窗口分钟: RETRY_WINDOW_MS / 60000,
        带提醒的待办: list,
        凭证来源: WX_APPID() && WX_SECRET() ? '已配置' : '缺失',
        miniprogramState: MINIPROGRAM_STATE,
      },
    };
  }

  // —— 诊断模式：分别验证云调用 / HTTP 两条通道 ——
  if (event && event.action === 'diagnose') {
    const out = {
      凭证来源: WX_APPID() && WX_SECRET() ? '已配置' : '缺失',
      云调用: null,
      HTTP通道: null,
      配置的模板ID: REMIND_TMPL_ID,
      配置的字段名: REMIND_FIELDS,
      miniprogramState: MINIPROGRAM_STATE,
    };

    // ① 云调用
    try {
      const r = await cloud.openapi.subscribeMessage.getTemplateList({});
      const list = (r && (r.data || r.templateList)) || [];
      out.云调用 = { ok: true, 模板数: list.length, 模板: list.map((t) => ({ id: t.templateId || t.priTmplId, title: t.title, content: t.content })) };
    } catch (e) {
      out.云调用 = { ok: false, errCode: (e && e.errCode) || 0, errMsg: (e && (e.errMsg || e.message)) || String(e) };
    }

    // ② HTTP：换 token + 拉模板列表
    try {
      const token = await getAccessToken(true);
      const r = await requestJson('GET', `https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${token}`);
      if (r.errcode) {
        out.HTTP通道 = { ok: false, errCode: r.errcode, errMsg: r.errmsg };
      } else {
        out.HTTP通道 = {
          ok: true,
          token前缀: token.slice(0, 8) + '...',
          模板: (r.data || []).map((t) => ({ id: t.templateId || t.priTmplId, title: t.title, content: t.content })),
        };
      }
    } catch (e) {
      out.HTTP通道 = { ok: false, errMsg: (e && e.message) || String(e) };
    }

    return { code: out.HTTP通道 && out.HTTP通道.ok ? 0 : -1, message: '诊断完成，详见 data', data: out };
  }

  // —— 自测模式：立即发一条，返回详细错误，绕开定时器与时间窗口 ——
  if (event && event.action === 'test') {
    const openid = String(event.openid || OPENID || '').trim();
    if (!openid) {
      return {
        code: -1,
        message: '缺少 openid：云端测试请在入参里传 { "action":"test", "openid":"你的openid" }',
      };
    }
    const r = await sendOne(openid, event.content || '测试提醒', fmtCN(Date.now()));
    return {
      code: r.ok ? 0 : -1,
      message: r.ok
        ? `发送成功 ✅（通道：${r.via}）`
        : `发送失败（通道：${r.via}）：${r.errMsg}`,
      data: {
        openid,
        via: r.via,
        errCode: r.errCode,
        cloudCallErr: r.cloudCallErr,
        templateId: REMIND_TMPL_ID,
        fields: REMIND_FIELDS,
        miniprogramState: MINIPROGRAM_STATE,
      },
    };
  }

  // —— 正常定时扫表 ——
  // 扫「已到点但还没发完」的待办：
  //  · 不再只看 2 分钟窗口，而是回看 RETRY_WINDOW_MS，这样定时器抖动/函数重启
  //    导致的错过可以补发，不会神不知鬼不觉地丢提醒。
  //  · 每个成员单独记录已发（remindSentTo），发成功的不会重发，不会重复打扰。
  const nowMs = Date.now();
  const since = nowMs - RETRY_WINDOW_MS;
  const res = await db.collection('todos')
    .where({ done: _.neq(true), reminded: _.neq(true), remindAt: _.and(_.gte(since), _.lte(nowMs)) })
    .limit(SCAN_LIMIT)
    .get();
  const todos = res.data || [];
  const stats = { scanned: todos.length, sent: [], failed: 0, errors: [] };

  for (const t of todos) {
    let fam = null;
    try {
      fam = (await db.collection('families').doc(t.familyId).get()).data;
    } catch (e) { /* 家庭不存在则跳过 */ }
    if (!fam) continue;
    const members = (fam.members || []).filter(Boolean);
    const sentTo = Array.isArray(t.remindSentTo) ? t.remindSentTo.slice() : [];
    const timeText = t.remindAt ? fmtCN(t.remindAt) : '';
    let lastErr = null;

    for (const openid of members) {
      if (sentTo.includes(openid)) continue; // 已经发过了
      const r = await sendOne(openid, t.content, timeText);
      if (r.ok) {
        sentTo.push(openid);
        stats.sent.push({ todoId: t._id, openid, via: r.via });
      } else {
        stats.failed += 1;
        lastErr = { openid, via: r.via, errCode: r.errCode, errMsg: r.errMsg };
        stats.errors.push({ todoId: t._id, ...lastErr });
      }
    }

    // 全部成员都发成功 → 完结；否则保留状态让下分钟重试（错误写进库，inspect 能直接看到）
    const tries = Number(t.remindTries || 0) + 1;
    const allDone = members.length > 0 && members.every((o) => sentTo.includes(o));
    const patch = { remindSentTo: sentTo, remindTries: _.inc(1) };
    if (allDone) {
      patch.reminded = true;
      patch.remindError = '';
      stats.finished = (stats.finished || 0) + 1;
    } else if (tries >= MAX_TRIES) {
      // 重试封顶：大多是对方没额度（43101），再试也只是白抓，标记结束
      patch.reminded = true;
      if (lastErr) patch.remindError = `${hintOf(lastErr.errCode, lastErr.errMsg)}（已尝试 ${tries} 次，放弃）`;
      stats.givenUp = (stats.givenUp || 0) + 1;
    } else if (lastErr) {
      patch.remindError = hintOf(lastErr.errCode, lastErr.errMsg);
    }
    try {
      await db.collection('todos').doc(t._id).update({ data: patch });
    } catch (e) { /* 尽力即可 */ }
  }

  if (stats.errors.length) console.error('[sendReminders] 发送失败明细', JSON.stringify(stats.errors));
  return { code: 0, data: stats };
};

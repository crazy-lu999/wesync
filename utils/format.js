// utils/format.js — 时间格式化
function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 把输入转成 Date，兼容 Date / 时间戳 / 字符串 / serverDate 对象
function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

// 把 Date / 云端时间对象 / 时间戳 格式化为 "MM-DD HH:mm"
// 同一天只显示 "HH:mm"，跨天显示 "MM-DD HH:mm"
function fmtTime(input) {
  const d = toDate(input);
  if (!d) return '';
  const now = new Date();
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay ? hm : `${md} ${hm}`;
}

// 提醒用的完整时间：始终显示 "MM-DD HH:mm"，不省略日期，避免跨天提醒闹误会
function fmtDateTime(input) {
  const d = toDate(input);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { fmtTime, fmtDateTime };
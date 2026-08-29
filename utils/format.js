// utils/format.js — 时间格式化
function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 把 Date / 云端时间对象 / 时间戳 格式化为 "MM-DD HH:mm"
function fmtTime(input) {
  let d;
  if (!input) return '';
  if (input instanceof Date) d = input;
  else if (typeof input === 'number') d = new Date(input);
  else if (typeof input === 'string') d = new Date(input);
  else if (typeof input === 'object' && typeof input.getTime === 'function') d = input;
  else if (typeof input === 'object' && input.$date) d = new Date(input.$date); // serverDate 兼容
  else d = new Date(input);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // 同一天只显示时分
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay ? hm : `${md} ${hm}`;
}

module.exports = { fmtTime };

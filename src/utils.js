import crypto from 'node:crypto';

const DIGITS = ['零','一','二','三','四','五','六','七','八','九'];
const DANMAKU_BLOCKED_WORDS = [
  '傻逼', '煞笔', '妈的', '草泥马', '操你', '日你', '狗日', '滚蛋',
  '去死', '杀人', '自杀', '色情', '约炮', '嫖娼', '毒品', '赌博', '纳粹'
];

export function now() { return new Date().toISOString(); }
export function token(bytes = 18) { return crypto.randomBytes(bytes).toString('base64url'); }
export function safeText(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
export function filterDanmaku(value, max = 80) {
  let content = safeText(value, max).replace(/https?:\/\/\S+|www\.\S+/gi, '[链接已过滤]');
  for (const word of DANMAKU_BLOCKED_WORDS) content = content.replaceAll(word, '*'.repeat([...word].length));
  return content;
}
export function inferAiAction(message, proposed = 'help') {
  const text = safeText(message, 600);
  if (/改名|重命名|改成|改为|修改(?:图片|照片|视频|素材)?名称|(?:名字|名称).{0,6}(?:改成|改为|修改)/.test(text)) return 'rename';
  if (/删除|删掉|移除/.test(text)) return 'delete';
  if (/上传|投稿|提交(?:图片|照片|视频|素材)/.test(text)) return 'upload';
  if (/登录|登入|进入我的账号/.test(text)) return 'login';
  return ['upload', 'delete', 'rename', 'login', 'help'].includes(proposed) ? proposed : 'help';
}
export function inferRenameTitle(message) {
  const text = safeText(message, 600);
  const match = text.match(/(?:改名为|重命名为|改成|改为|名字(?:修改|改)为?|名称(?:修改|改)为?)[“"']?([^”"'，。！？\n]{1,80})/);
  return safeText(match?.[1], 255);
}
export function normalizeDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => DIGITS[Number(d)]);
}
export function normalizeTeam(value) {
  let v = normalizeDigits(safeText(value, 30)).replace(/[\s\-_，,。.!！?？]/g, '');
  v = v.replace(/^第/, '');
  if (!v) return '';
  if (!/[连队组]$/.test(v)) v += '连';
  return v.replace(/队$/, '连').replace(/组$/, '连');
}
export function normalizeClass(value) {
  let v = normalizeDigits(safeText(value, 30)).replace(/[\s\-_，,。.!！?？]/g, '');
  v = v.replace(/^第/, '');
  if (!v) return '';
  if (!/班$/.test(v)) v += '班';
  return v;
}
export function normalizeName(value) { return safeText(value, 40).replace(/\s+/g, ''); }
export function normalizeIdentity(name, team, className) {
  return `${normalizeName(name)}+${normalizeTeam(team)}+${normalizeClass(className)}`;
}
export function mediaType(mime, filename = '') {
  if (String(mime).startsWith('image/')) return 'image';
  if (String(mime).startsWith('video/')) return 'video';
  const ext = filename.toLowerCase().split('.').pop();
  if (['jpg','jpeg','png','gif','webp','heic','heif','bmp','avif','tif','tiff'].includes(ext)) return 'image';
  if (['mp4','mov','m4v','avi','mkv','webm','mpeg','mpg','3gp','wmv','flv'].includes(ext)) return 'video';
  return null;
}
export function sign(value, secret) {
  const payload = Buffer.from(JSON.stringify({ value, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
export function verify(signed, secret) {
  try {
    const [payload, mac] = String(signed).split('.');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!payload || !mac || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.value : null;
  } catch { return null; }
}
export function publicMedia(row, baseUrl = '') {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    createdAt: row.created_at,
    url: `${baseUrl}/media/${encodeURIComponent(row.stored_name)}`
  };
}

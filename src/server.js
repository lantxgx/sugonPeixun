import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import QRCode from 'qrcode';
import { mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, seedDemoTeam } from './db.js';
import { mediaType, normalizeClass, normalizeIdentity, normalizeName, normalizeTeam, now, publicMedia, safeText, sign, token, verify } from './utils.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const MEDIA_DIR = resolve(process.env.MEDIA_DIR || join(DATA_DIR, 'media'));
mkdirSync(MEDIA_DIR, { recursive: true });
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-admin-password';
const AUTH_SECRET = process.env.AUTH_SECRET || 'change-this-auth-secret-in-production';
const ADMIN_AUTH_DISABLED = ['1', 'true', 'yes'].includes(String(process.env.ADMIN_AUTH_DISABLED || '').toLowerCase());
const db = createDatabase(join(DATA_DIR, 'training.sqlite'));
seedDemoTeam(db, token);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const helmetOptions = { crossOriginResourcePolicy: { policy: 'cross-origin' } };
if (!PUBLIC_BASE_URL.startsWith('https://')) {
  helmetOptions.strictTransportSecurity = false;
  helmetOptions.contentSecurityPolicy = { directives: { 'upgrade-insecure-requests': null } };
}
app.use(helmet(helmetOptions));
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', index: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => cb(null, `upload-${token(16)}${extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { files: 20, fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(mediaType(file.mimetype, file.originalname)))
});

function absoluteBase(req) { return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`; }
function jsonError(res, status, message, details) { return res.status(status).json({ ok: false, error: message, details }); }
function adminOnly(req, res, next) {
  if (ADMIN_AUTH_DISABLED) return next();
  const raw = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.query.token;
  if (verify(raw, AUTH_SECRET) !== 'admin') return jsonError(res, 401, '管理员登录已失效');
  next();
}
function getActivity(id) { return db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id)); }
function getTeamByUploadToken(uploadToken) { return db.prepare('SELECT * FROM teams WHERE upload_token = ?').get(uploadToken); }
function getTeamByPublicToken(publicToken) { return db.prepare('SELECT * FROM teams WHERE public_token = ?').get(publicToken); }
function teamSummary(team) { return team && { id: team.id, name: team.name, activityId: team.activity_id, publicToken: team.public_token, uploadToken: team.upload_token }; }
function cleanupFiles(files = []) { for (const file of files) { try { if (existsSync(file.path)) unlinkSync(file.path); } catch {} } }

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'sugon-training-record', time: now() }));

app.get('/api/config', (_req, res) => res.json({ ok: true, adminAuthRequired: !ADMIN_AUTH_DISABLED, limits: { maxFiles: 20, maxImageBytes: 20 * 1024 * 1024, maxVideoBytes: 500 * 1024 * 1024 }, uploadMode: 'published-by-default' }));

app.get('/api/public/home', (req, res) => {
  const activities = db.prepare("SELECT * FROM activities WHERE status='active' ORDER BY id").all().map((activity) => ({
    id: activity.id,
    name: activity.name,
    teams: db.prepare('SELECT * FROM teams WHERE activity_id = ? ORDER BY id').all(activity.id).map((team) => ({
      ...teamSummary(team),
      uploadUrl: `${absoluteBase(req)}/upload?uploadToken=${encodeURIComponent(team.upload_token)}`,
      galleryUrl: `${absoluteBase(req)}/gallery?publicToken=${encodeURIComponent(team.public_token)}`
    }))
  }));
  res.json({ ok: true, activities });
});

app.get('/api/public/teams', (_req, res) => {
  const activities = db.prepare("SELECT * FROM activities WHERE status='active' ORDER BY id").all().map((activity) => ({ id: activity.id, name: activity.name, teams: db.prepare('SELECT * FROM teams WHERE activity_id=? ORDER BY id').all(activity.id).map(teamSummary) }));
  res.json({ ok: true, activities });
});

app.get('/api/public/qr/:type', async (req, res) => {
  const type = req.params.type === 'gallery' ? 'gallery' : 'upload';
  const url = `${absoluteBase(req)}/${type}`;
  res.set('Cache-Control', 'no-store');
  res.type('png').send(await QRCode.toBuffer(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' }));
});

app.post('/api/admin/login', (req, res) => {
  if (ADMIN_AUTH_DISABLED) return res.json({ ok: true, token: sign('admin', AUTH_SECRET), expiresIn: '30d', authDisabled: true });
  if (String(req.body?.password || '') !== ADMIN_PASSWORD) return jsonError(res, 401, '管理员密码错误');
  res.json({ ok: true, token: sign('admin', AUTH_SECRET), expiresIn: '30d' });
});

app.get('/api/admin/dashboard', adminOnly, (_req, res) => {
  const count = (sql) => db.prepare(sql).get()?.count ?? 0;
  res.json({ ok: true, stats: {
    activities: count('SELECT COUNT(*) count FROM activities'),
    teams: count('SELECT COUNT(*) count FROM teams'),
    registrations: count('SELECT COUNT(*) count FROM registrations'),
    media: count('SELECT COUNT(*) count FROM media'),
    published: count("SELECT COUNT(*) count FROM media WHERE status='published'"),
    openReports: count("SELECT COUNT(*) count FROM reports WHERE status='open'"),
    comments: count('SELECT COUNT(*) count FROM comments')
  }});
});

app.get('/api/admin/activities', adminOnly, (_req, res) => {
  const activities = db.prepare('SELECT * FROM activities ORDER BY id DESC').all().map((a) => ({
    ...a, teams: db.prepare('SELECT * FROM teams WHERE activity_id = ? ORDER BY id').all(a.id).map(teamSummary)
  }));
  res.json({ ok: true, activities });
});
app.post('/api/admin/activities', adminOnly, (req, res) => {
  const name = safeText(req.body?.name, 100);
  if (!name) return jsonError(res, 400, '活动名称不能为空');
  const result = db.prepare('INSERT INTO activities (name, description, created_at) VALUES (?, ?, ?)').run(name, safeText(req.body?.description, 500), now());
  res.status(201).json({ ok: true, activity: getActivity(result.lastInsertRowid) });
});
app.post('/api/admin/teams', adminOnly, (req, res) => {
  const activity = getActivity(req.body?.activityId);
  const name = normalizeTeam(req.body?.name);
  if (!activity || !name) return jsonError(res, 400, '活动或连队名称无效');
  try {
    const result = db.prepare('INSERT INTO teams (activity_id, name, public_token, upload_token, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(activity.id, name, token(), token(), now());
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ok: true, team: teamSummary(team), links: linksForTeam(req, team) });
  } catch (error) { return jsonError(res, 409, '该活动下已存在同名连队'); }
});

function linksForTeam(req, team) {
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return { upload: `${base}/upload?uploadToken=${encodeURIComponent(team.upload_token)}`, gallery: `${base}/gallery?publicToken=${encodeURIComponent(team.public_token)}` };
}

app.get('/api/admin/qr/:type/:value', async (req, res) => {
  const type = req.params.type === 'gallery' ? 'gallery' : 'upload';
  const team = type === 'gallery' ? getTeamByPublicToken(req.params.value) : getTeamByUploadToken(req.params.value);
  if (!team) return jsonError(res, 404, '二维码参数不存在');
  const url = type === 'gallery' ? linksForTeam(req, team).gallery : linksForTeam(req, team).upload;
  res.set('Cache-Control', 'no-store');
  res.type('png').send(await QRCode.toBuffer(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' }));
});

app.post('/api/registrations', (req, res) => {
  const team = getTeamByUploadToken(safeText(req.body?.uploadToken, 200));
  const name = normalizeName(req.body?.name);
  const teamInput = normalizeTeam(req.body?.team);
  const className = normalizeClass(req.body?.className ?? req.body?.class);
  if (!team) return jsonError(res, 404, '上传二维码无效或已失效');
  if (!name || !teamInput || !className) return jsonError(res, 400, '请填写姓名、连队和班级');
  if (teamInput !== team.name) return jsonError(res, 400, `该二维码属于${team.name}，不能登记到${teamInput}`);
  const normalizedIdentity = normalizeIdentity(name, teamInput, className);
  const duplicate = db.prepare('SELECT id FROM registrations WHERE activity_id = ? AND normalized_identity = ?').get(team.activity_id, normalizedIdentity);
  if (duplicate) return jsonError(res, 409, '检测到相同姓名、连队和班级的登记，请联系管理员处理重名情况');
  const registrationToken = token(24);
  const result = db.prepare('INSERT INTO registrations (activity_id, team_id, name, class_name, normalized_identity, registration_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(team.activity_id, team.id, name, className, normalizedIdentity, registrationToken, now());
  res.status(201).json({ ok: true, registration: { id: result.lastInsertRowid, name, teamName: teamInput, className, normalizedIdentity, registrationToken, team: teamSummary(team) } });
});

app.post('/api/registrations/login', (req, res) => {
  const team = getTeamByUploadToken(safeText(req.body?.uploadToken, 200));
  const identity = normalizeIdentity(req.body?.name, req.body?.team, req.body?.className);
  if (!team || !normalizeName(req.body?.name) || !normalizeTeam(req.body?.team) || !normalizeClass(req.body?.className)) return jsonError(res, 400, '姓名、连队和班级不能为空');
  const registration = db.prepare('SELECT r.*, t.name team_name FROM registrations r JOIN teams t ON t.id=r.team_id WHERE r.activity_id=? AND r.normalized_identity=?').get(team.activity_id, identity);
  if (!registration) return jsonError(res, 401, '未找到登记记录，请先完成登记');
  res.json({ ok: true, registration: { id: registration.id, name: registration.name, teamName: registration.team_name, className: registration.class_name, normalizedIdentity: registration.normalized_identity, registrationToken: registration.registration_token, team: teamSummary(team) } });
});

app.get('/api/public/gallery', (req, res) => {
  const activities = db.prepare("SELECT * FROM activities WHERE status='active' ORDER BY id").all().map((activity) => ({
    id: activity.id,
    name: activity.name,
    teams: db.prepare('SELECT * FROM teams WHERE activity_id=? ORDER BY id').all(activity.id).map((team) => ({
      ...teamSummary(team),
      media: db.prepare("SELECT * FROM media WHERE team_id=? AND status='published' ORDER BY id DESC").all(team.id).map((m) => {
        const item = publicMedia(m, absoluteBase(req));
        item.likes = db.prepare('SELECT COUNT(*) count FROM likes WHERE media_id=?').get(m.id).count;
        item.reports = db.prepare('SELECT COUNT(*) count FROM reports WHERE media_id=?').get(m.id).count;
        item.comments = db.prepare("SELECT id,nickname,content,created_at FROM comments WHERE media_id=? AND status='published' ORDER BY id DESC").all(m.id);
        return item;
      })
    }))
  }));
  res.json({ ok: true, activities });
});

app.get('/api/public/:publicToken', (req, res) => {
  const team = getTeamByPublicToken(req.params.publicToken);
  if (!team) return jsonError(res, 404, '公开相册不存在');
  const activity = getActivity(team.activity_id);
  const media = db.prepare("SELECT * FROM media WHERE team_id = ? AND status = 'published' ORDER BY id DESC").all(team.id).map((m) => {
    const item = publicMedia(m, absoluteBase(req));
    item.likes = db.prepare('SELECT COUNT(*) count FROM likes WHERE media_id = ?').get(m.id).count;
    item.reports = db.prepare('SELECT COUNT(*) count FROM reports WHERE media_id = ?').get(m.id).count;
    item.comments = db.prepare("SELECT id, nickname, content, created_at FROM comments WHERE media_id = ? AND status = 'published' ORDER BY id DESC").all(m.id);
    return item;
  });
  res.json({ ok: true, activity: { id: activity.id, name: activity.name }, team: teamSummary(team), media });
});

app.get('/api/public/upload/:uploadToken', (req, res) => {
  const team = getTeamByUploadToken(req.params.uploadToken);
  if (!team) return jsonError(res, 404, '上传二维码不存在');
  res.json({ ok: true, activity: getActivity(team.activity_id), team: teamSummary(team) });
});

app.post('/api/media/upload', (req, res) => {
  upload.array('files', 20)(req, res, (error) => {
    if (error) { cleanupFiles(req.files); return jsonError(res, 400, error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过500MB' : '上传文件数量或格式不符合要求'); }
    const registration = db.prepare('SELECT r.*, t.name team_name FROM registrations r JOIN teams t ON t.id=r.team_id WHERE r.registration_token = ?').get(safeText(req.body?.registrationToken, 300));
    if (!registration) { cleanupFiles(req.files); return jsonError(res, 401, '请先完成扫码登记'); }
    const files = req.files || [];
    if (!files.length) return jsonError(res, 400, '请至少选择一个照片或视频');
    const created = [];
    try {
      for (const file of files) {
        const kind = mediaType(file.mimetype, file.originalname);
        if (!kind) throw new Error('仅支持照片和视频格式');
        const max = kind === 'image' ? 20 * 1024 * 1024 : 500 * 1024 * 1024;
        if (file.size > max) throw new Error(kind === 'image' ? '单张照片不能超过20MB' : '单个视频不能超过500MB');
        const result = db.prepare('INSERT INTO media (activity_id, team_id, registration_id, original_name, stored_name, mime_type, media_type, size_bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(registration.activity_id, registration.team_id, registration.id, safeText(file.originalname, 255), file.filename, safeText(file.mimetype, 100) || 'application/octet-stream', kind, file.size, 'published', now());
        created.push(publicMedia({ id: result.lastInsertRowid, original_name: file.originalname, stored_name: file.filename, mime_type: file.mimetype, media_type: kind, size_bytes: file.size, status: 'published', created_at: now() }, absoluteBase(req)));
      }
      res.status(201).json({ ok: true, message: '上传成功，内容已公开展示', media: created });
    } catch (e) { cleanupFiles(files); return jsonError(res, 400, e.message || '上传失败'); }
  });
});

app.get('/api/user/media', (req, res) => {
  const registration = db.prepare('SELECT id FROM registrations WHERE registration_token=?').get(safeText(req.query.registrationToken, 300));
  if (!registration) return jsonError(res, 401, '上传身份已失效，请重新登录');
  const media = db.prepare('SELECT * FROM media WHERE registration_id=? ORDER BY id DESC').all(registration.id).map((m) => publicMedia(m, absoluteBase(req)));
  res.json({ ok: true, media });
});

app.patch('/api/user/media/:id', (req, res) => {
  const registration = db.prepare('SELECT id FROM registrations WHERE registration_token=?').get(safeText(req.body?.registrationToken, 300));
  if (!registration) return jsonError(res, 401, '上传身份已失效，请重新登录');
  const media = db.prepare('SELECT id FROM media WHERE id=? AND registration_id=?').get(Number(req.params.id), registration.id);
  if (!media) return jsonError(res, 404, '素材不存在或不属于当前用户');
  const originalName = safeText(req.body?.originalName, 255);
  if (!originalName) return jsonError(res, 400, '名称不能为空');
  db.prepare('UPDATE media SET original_name=? WHERE id=?').run(originalName, media.id);
  res.json({ ok: true, media: publicMedia(db.prepare('SELECT * FROM media WHERE id=?').get(media.id), absoluteBase(req)) });
});

app.delete('/api/user/media/:id', (req, res) => {
  const registration = db.prepare('SELECT id FROM registrations WHERE registration_token=?').get(safeText(req.body?.registrationToken || req.query.registrationToken, 300));
  if (!registration) return jsonError(res, 401, '上传身份已失效，请重新登录');
  const media = db.prepare('SELECT * FROM media WHERE id=? AND registration_id=?').get(Number(req.params.id), registration.id);
  if (!media) return jsonError(res, 404, '素材不存在或不属于当前用户');
  try { if (existsSync(join(MEDIA_DIR, media.stored_name))) unlinkSync(join(MEDIA_DIR, media.stored_name)); } catch {}
  db.prepare('DELETE FROM media WHERE id=?').run(media.id);
  res.json({ ok: true, deleted: media.id });
});

app.get('/api/media/:id/like', (req, res) => {
  const media = db.prepare("SELECT id FROM media WHERE id = ? AND status = 'published'").get(Number(req.params.id));
  if (!media) return jsonError(res, 404, '素材不存在');
  const deviceKey = safeText(req.query.deviceKey, 120);
  if (!deviceKey) return jsonError(res, 400, '缺少设备标识');
  const liked = Boolean(db.prepare('SELECT id FROM likes WHERE media_id = ? AND device_key = ?').get(media.id, deviceKey));
  const likes = db.prepare('SELECT COUNT(*) count FROM likes WHERE media_id = ?').get(media.id).count;
  res.json({ ok: true, liked, likes });
});

app.post('/api/media/:id/like', (req, res) => {
  const media = db.prepare("SELECT id FROM media WHERE id = ? AND status = 'published'").get(Number(req.params.id));
  if (!media) return jsonError(res, 404, '素材不存在');
  const deviceKey = safeText(req.body?.deviceKey, 120);
  if (!deviceKey) return jsonError(res, 400, '缺少设备标识');
  const existing = db.prepare('SELECT id FROM likes WHERE media_id = ? AND device_key = ?').get(media.id, deviceKey);
  if (existing) db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
  else db.prepare('INSERT INTO likes (media_id, device_key, created_at) VALUES (?, ?, ?)').run(media.id, deviceKey, now());
  res.json({ ok: true, liked: !existing, likes: db.prepare('SELECT COUNT(*) count FROM likes WHERE media_id = ?').get(media.id).count });
});
app.post('/api/media/:id/comments', (req, res) => {
  const media = db.prepare("SELECT id FROM media WHERE id = ? AND status = 'published'").get(Number(req.params.id));
  const nickname = safeText(req.body?.nickname, 30); const content = safeText(req.body?.content, 500);
  if (!media) return jsonError(res, 404, '素材不存在');
  if (!nickname || !content) return jsonError(res, 400, '昵称和留言不能为空');
  const result = db.prepare('INSERT INTO comments (media_id, nickname, content, created_at) VALUES (?, ?, ?, ?)').run(media.id, nickname, content, now());
  res.status(201).json({ ok: true, comment: { id: result.lastInsertRowid, nickname, content, createdAt: now() } });
});
app.post('/api/media/:id/reports', (req, res) => {
  const media = db.prepare('SELECT id FROM media WHERE id = ?').get(Number(req.params.id));
  const reason = safeText(req.body?.reason, 200); const contact = safeText(req.body?.contact, 100);
  if (!media || !reason) return jsonError(res, 400, '素材或举报原因无效');
  db.prepare('INSERT INTO reports (media_id, reason, contact, created_at) VALUES (?, ?, ?, ?)').run(media.id, reason, contact, now());
  res.status(201).json({ ok: true, message: '举报已提交，管理员会尽快处理' });
});
app.get('/api/media/:id/reports/count', (req, res) => {
  const media = db.prepare("SELECT id FROM media WHERE id=? AND status='published'").get(Number(req.params.id));
  if (!media) return jsonError(res, 404, '素材不存在');
  res.json({ ok: true, reports: db.prepare('SELECT COUNT(*) count FROM reports WHERE media_id=?').get(media.id).count });
});

app.get('/api/admin/media', adminOnly, (req, res) => {
  const status = ['published','hidden','pending','rejected'].includes(req.query.status) ? req.query.status : null;
  const rows = status
    ? db.prepare('SELECT m.*, t.name team_name, r.name uploader_name, r.class_name FROM media m JOIN teams t ON t.id=m.team_id JOIN registrations r ON r.id=m.registration_id WHERE m.status=? ORDER BY m.id DESC').all(status)
    : db.prepare('SELECT m.*, t.name team_name, r.name uploader_name, r.class_name FROM media m JOIN teams t ON t.id=m.team_id JOIN registrations r ON r.id=m.registration_id ORDER BY m.id DESC').all();
  res.json({ ok: true, media: rows.map((m) => ({ ...publicMedia(m, absoluteBase(req)), likes: db.prepare('SELECT COUNT(*) count FROM likes WHERE media_id=?').get(m.id).count, team: m.team_name, uploader: m.uploader_name, className: m.class_name })) });
});
app.patch('/api/admin/media/:id', adminOnly, (req, res) => {
  const status = String(req.body?.status || '');
  if (!['published','hidden','pending','rejected'].includes(status)) return jsonError(res, 400, '审核状态无效');
  const result = db.prepare('UPDATE media SET status=? WHERE id=?').run(status, Number(req.params.id));
  if (!result.changes) return jsonError(res, 404, '素材不存在');
  res.json({ ok: true, status });
});
app.delete('/api/admin/media/:id', adminOnly, (req, res) => {
  const media = db.prepare('SELECT id, stored_name FROM media WHERE id=?').get(Number(req.params.id));
  if (!media) return jsonError(res, 404, '素材不存在');
  try { if (existsSync(join(MEDIA_DIR, media.stored_name))) unlinkSync(join(MEDIA_DIR, media.stored_name)); } catch {}
  db.prepare('DELETE FROM media WHERE id=?').run(media.id);
  res.json({ ok: true, deleted: media.id });
});
app.get('/api/admin/comments', adminOnly, (_req, res) => res.json({ ok: true, comments: db.prepare('SELECT c.*, m.original_name FROM comments c JOIN media m ON m.id=c.media_id ORDER BY c.id DESC').all() }));
app.patch('/api/admin/comments/:id', adminOnly, (req, res) => {
  const status = ['published','hidden'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return jsonError(res, 400, '留言状态无效');
  db.prepare('UPDATE comments SET status=? WHERE id=?').run(status, Number(req.params.id)); res.json({ ok: true, status });
});
app.get('/api/admin/reports', adminOnly, (_req, res) => res.json({ ok: true, reports: db.prepare('SELECT r.*, m.original_name, m.stored_name FROM reports r JOIN media m ON m.id=r.media_id ORDER BY r.id DESC').all() }));
app.patch('/api/admin/reports/:id', adminOnly, (req, res) => {
  const status = ['open','resolved','ignored'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return jsonError(res, 400, '举报状态无效');
  db.prepare('UPDATE reports SET status=? WHERE id=?').run(status, Number(req.params.id)); res.json({ ok: true, status });
});

app.use(express.static(join(ROOT, 'public'), { extensions: ['html'] }));
app.get(['/admin', '/register', '/upload', '/gallery'], (_req, res) => res.sendFile(join(ROOT, 'public', 'index.html')));
app.use((err, _req, res, _next) => { console.error(err); if (!res.headersSent) res.status(500).json({ ok: false, error: '服务器内部错误' }); });

app.listen(PORT, HOST, () => console.log(`曙光军训记录 running at http://${HOST}:${PORT}`));

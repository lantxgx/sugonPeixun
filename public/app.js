const app = document.querySelector('#app');
const $ = (s, root = document) => root.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const query = new URLSearchParams(location.search);
const api = async (path, options = {}) => { const r = await fetch(`/api${path}`, { headers: { ...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...(options.headers || {}) }, ...options }); const data = await r.json().catch(() => ({ok:false,error:'服务器返回异常'})); if (!r.ok) { const error = new Error(data.error || '请求失败'); error.status = r.status; error.data = data; throw error; } return data; };
const fmtSize = (n) => { let x = Number(n); const units=['B','KB','MB','GB']; let i=0; while(x>1024&&i<units.length-1){x/=1024;i++;} return `${x.toFixed(i?1:0)} ${units[i]}`; };
const deviceKey = () => { let k = localStorage.getItem('training-device-key'); if (!k) { if (globalThis.crypto?.randomUUID) k = globalThis.crypto.randomUUID(); else if (globalThis.crypto?.getRandomValues) { const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); k = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); } else k = `${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem('training-device-key', k); } return k; };
function message(text, cls='error') { return `<div class="${cls}">${esc(text)}</div>`; }
function mediaPreview(media) {
  const visual = media.mediaType === 'video'
    ? `<video src="${esc(media.url)}" preload="metadata" playsinline></video>`
    : `<img src="${esc(media.url)}" alt="${esc(media.originalName)}" loading="lazy">`;
  return `<button type="button" class="media-preview" aria-label="全屏查看${esc(media.originalName)}">${visual}<span>全屏查看</span></button>`;
}
function danmakuLines(media) {
  return (media.danmaku || []).slice(0, 30).map((item, index) => {
    const color = /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#ffffff';
    return `<span class="danmaku-line" style="--danmaku-index:${index % 5};--danmaku-delay:${(index % 10) * -0.9}s;--danmaku-color:${color}">${esc(item.content)}</span>`;
  }).join('');
}
function viewerIdentity() {
  try {
    const registration = JSON.parse(sessionStorage.getItem('registrationInfo') || 'null');
    const registrationToken = sessionStorage.getItem('registrationToken');
    if (registration?.name && registrationToken) return { nickname:registration.name, registrationToken };
  } catch {}
  return { nickname:localStorage.getItem('danmaku-guest-name') || '', guestToken:localStorage.getItem('danmaku-guest-token') || '' };
}
function bindImageZoom(modal) {
  const stage = modal.querySelector('.lightbox-media'); const image = stage?.querySelector('.viewer-image');
  if (!stage || !image) return null;
  const minScale = 1; const maxScale = 4; let scale = minScale; let x = 0; let y = 0; let drag = null; let pinch = null;
  const pointers = new Map(); const status = modal.querySelector('.image-zoom-status');
  const clamp = () => { const maxX = Math.max(0, stage.clientWidth * (scale - 1) / 2); const maxY = Math.max(0, stage.clientHeight * (scale - 1) / 2); x = Math.max(-maxX, Math.min(maxX, x)); y = Math.max(-maxY, Math.min(maxY, y)); };
  const render = () => { clamp(); image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; const zoomed = scale > minScale + .01; stage.classList.toggle('is-zoomed', zoomed); if (!zoomed) stage.classList.remove('is-dragging'); if (status) status.textContent = `${Math.round(scale * 100)}%`; };
  const setScale = (next) => { scale = Math.max(minScale, Math.min(maxScale, next)); if (scale === minScale) { x = 0; y = 0; } render(); };
  const reset = () => setScale(minScale); const zoomBy = (amount) => setScale(scale * amount);
  const panBy = (deltaX, deltaY) => { if (scale <= minScale + .01) return; x += deltaX; y += deltaY; render(); };
  stage.addEventListener('wheel', (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive:false });
  stage.addEventListener('dblclick', () => { if (scale > minScale + .01) reset(); else setScale(2); });
  stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    stage.setPointerCapture?.(event.pointerId); pointers.set(event.pointerId, { x:event.clientX, y:event.clientY });
    if (pointers.size === 2) { const [first, second] = [...pointers.values()]; pinch = { distance:Math.hypot(first.x - second.x, first.y - second.y), scale }; drag = null; stage.classList.remove('is-dragging'); }
    else if (scale > minScale + .01) { drag = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, x, y }; stage.classList.add('is-dragging'); }
  });
  stage.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x:event.clientX, y:event.clientY });
    if (pointers.size >= 2) { const [first, second] = [...pointers.values()]; const distance = Math.hypot(first.x - second.x, first.y - second.y); if (pinch?.distance) setScale(pinch.scale * distance / pinch.distance); return; }
    if (drag?.pointerId === event.pointerId) { x = drag.x + event.clientX - drag.startX; y = drag.y + event.clientY - drag.startY; render(); }
  });
  const endPointer = (event) => { pointers.delete(event.pointerId); if (drag?.pointerId === event.pointerId) drag = null; if (pointers.size < 2) pinch = null; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', endPointer); stage.addEventListener('pointercancel', endPointer);
  modal.querySelector('.image-zoom-in').onclick = () => zoomBy(1.25);
  modal.querySelector('.image-zoom-out').onclick = () => zoomBy(1 / 1.25);
  modal.querySelector('.image-zoom-reset').onclick = reset;
  render(); return { reset, zoomBy, panBy };
}
function openMediaViewer(media) {
  const identity = viewerIdentity(); const modal = document.createElement('div');
  modal.className = 'lightbox'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', `全屏查看 ${media.originalName}`);
  const isImage = media.mediaType === 'image';
  const visual = media.mediaType === 'video'
    ? `<video src="${esc(media.url)}" controls preload="metadata" playsinline></video>`
    : `<img class="viewer-image" src="${esc(media.url)}" alt="${esc(media.originalName)}" draggable="false">`;
  const zoomControls = isImage ? `<div class="image-zoom-controls" aria-label="图片缩放控制"><button type="button" class="image-zoom-out secondary">缩小</button><button type="button" class="image-zoom-reset secondary">还原 <span class="image-zoom-status" aria-live="polite">100%</span></button><button type="button" class="image-zoom-in secondary">放大</button><span class="image-zoom-tip">滚轮缩放 · 放大后拖动查看</span></div>` : '';
  modal.innerHTML = `<div class="lightbox-viewer"><button type="button" class="lightbox-close" aria-label="关闭全屏查看">×</button><div class="lightbox-media${isImage ? ' image-zoomable' : ''}">${visual}<div class="danmaku-layer" aria-live="polite">${danmakuLines(media)}</div>${zoomControls}</div><div class="lightbox-toolbar"><div class="lightbox-title"><div class="lightbox-title-row"><strong>${esc(media.originalName)}</strong><button type="button" class="danmaku-pause secondary" aria-pressed="false">暂停弹幕</button></div><span class="danmaku-identity">${identity.nickname ? `以“${esc(identity.nickname)}”发送` : '访客首次发送时需要填写名字'}</span></div><form class="danmaku-form"><label class="guest-name-field collapsed" for="danmaku-name-${media.id}"><span class="sr-only">你的名字</span><input id="danmaku-name-${media.id}" name="nickname" maxlength="30" autocomplete="nickname" value="${esc(identity.nickname)}" placeholder="你的名字"></label><label class="sr-only" for="danmaku-content-${media.id}">弹幕内容</label><input id="danmaku-content-${media.id}" name="content" maxlength="80" autocomplete="off" placeholder="发一条友善的弹幕" required><button>发送</button></form><div class="danmaku-feedback" aria-live="polite"></div></div></div>`;
  document.body.appendChild(modal); document.body.classList.add('viewer-open');
  const zoom = isImage ? bindImageZoom(modal) : null;
  const close = () => { modal.remove(); document.body.classList.remove('viewer-open'); document.removeEventListener('keydown', onKeydown); };
  const onKeydown = (event) => { if (event.key === 'Escape') { close(); return; } if (!zoom || event.target.matches('input,textarea,select')) return; if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom.zoomBy(1.25); } else if (event.key === '-') { event.preventDefault(); zoom.zoomBy(1 / 1.25); } else if (event.key === '0') { event.preventDefault(); zoom.reset(); } else if (event.key === 'ArrowLeft') { event.preventDefault(); zoom.panBy(-48, 0); } else if (event.key === 'ArrowRight') { event.preventDefault(); zoom.panBy(48, 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); zoom.panBy(0, -48); } else if (event.key === 'ArrowDown') { event.preventDefault(); zoom.panBy(0, 48); } };
  document.addEventListener('keydown', onKeydown); modal.querySelector('.lightbox-close').onclick = close;
  modal.querySelector('.danmaku-pause').onclick = (event) => { const paused = event.currentTarget.getAttribute('aria-pressed') !== 'true'; event.currentTarget.setAttribute('aria-pressed', String(paused)); event.currentTarget.textContent = paused ? '继续弹幕' : '暂停弹幕'; modal.querySelector('.danmaku-layer').classList.toggle('danmaku-paused', paused); };
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.querySelector('.danmaku-form').onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const input = form.elements.content; const button = form.querySelector('button'); const feedback = modal.querySelector('.danmaku-feedback');
    const current = viewerIdentity(); let nickname = current.nickname; const nameField = form.querySelector('.guest-name-field');
    if (!current.registrationToken && !current.guestToken) {
      if (nameField.classList.contains('collapsed')) { nameField.classList.remove('collapsed'); feedback.textContent = '请填写一次名字，下次发送会自动记住。'; form.elements.nickname.focus(); return; }
      nickname = form.elements.nickname.value.trim().slice(0, 30);
      if (!nickname) { feedback.textContent = '请输入名字后再发送。'; form.elements.nickname.focus(); return; }
    }
    button.disabled = true; feedback.textContent = '正在发送…';
    try {
      const result = await api(`/media/${media.id}/danmaku`, { method:'POST', body:JSON.stringify({ content:input.value, nickname, registrationToken:current.registrationToken, guestToken:current.guestToken }) });
      if (result.guestToken) { localStorage.setItem('danmaku-guest-name', result.danmaku.nickname); localStorage.setItem('danmaku-guest-token', result.guestToken); nameField.classList.add('collapsed'); }
      const index = modal.querySelectorAll('.danmaku-line').length % 5; const line = document.createElement('span'); line.className = 'danmaku-line danmaku-line-new'; line.style.setProperty('--danmaku-index', index); line.style.setProperty('--danmaku-color', result.danmaku.color || '#ffffff'); line.textContent = result.danmaku.content; modal.querySelector('.danmaku-layer').appendChild(line);
      modal.querySelector('.danmaku-identity').textContent = `以“${result.danmaku.nickname}”发送`; feedback.textContent = result.danmaku.content === input.value.trim() ? '已发送' : '已发送，系统已自动过滤不良词汇'; input.value = '';
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; input.focus(); }
  };
  modal.querySelector('.lightbox-close').focus();
}

async function renderHome() {
  let data; try { data = await api('/public/home'); } catch (e) { app.innerHTML = message(e.message); return; }
  const teams = data.activities.flatMap(a => a.teams.map(t => ({ ...t, activityName: a.name })));
  if (!teams.length) { app.innerHTML = message('当前还没有可用的活动'); return; }
  const activityCount = data.activities.length;
  app.innerHTML = `<section class="card hero home-hero"><div class="hero-kicker">2026 · 集训影像志</div><h1>把训练的每一步，<br>都留成值得回看的故事。</h1><p>照片和视频素材统一上传、公开展示，让每一份坚持都有迹可循，让连队风采被看见。</p><div class="hero-meta"><span>${activityCount} 场活动</span><span>${teams.length} 个连队</span></div><div class="actions"><a href="/upload"><button>提交照片 / 视频</button></a><a href="/gallery"><button>浏览公开相册</button></a><a href="/guide"><button>使用说明</button></a></div></section><section class="card"><div class="section-heading"><div><h2>扫码使用</h2><p class="muted">选择入口，即刻开始记录或浏览。</p></div></div><div class="qr-pair"><div class="qr-card"><p class="muted">提交二维码</p><img class="qr" src="/api/public/qr/upload?qrVersion=3" alt="提交照片和视频二维码"></div><div class="qr-card"><p class="muted">查看二维码</p><img class="qr" src="/api/public/qr/gallery?qrVersion=3" alt="查看公开相册二维码"></div></div></section>`;
}

function renderGuide() {
  app.innerHTML = `<section class="card hero guide-hero"><div class="hero-kicker">快速上手</div><h1>使用说明</h1><p>用几句话完成登录、上传、改名、弹幕互动和素材管理。</p></section><section class="card guide-content"><div class="guide-step"><span>01</span><div><h2>AI 登录与投稿</h2><p>只需登录时，可以说“我是五连1班兰天笑，帮我登录”，无需选择文件。上传时再选择图片或视频，并告诉AI展示名称。</p></div></div><div class="guide-step"><span>02</span><div><h2>查看相册</h2><p>进入公开相册，点击对应连队栏展开，再点击图片或视频进入全屏查看。</p></div></div><div class="guide-step"><span>03</span><div><h2>发送弹幕</h2><p>弹幕只在全屏查看时显示和发送。已登录用户自动使用登记姓名；访客首次发送填写一次名字，之后会在当前设备上自动记住。</p></div></div><div class="guide-step"><span>04</span><div><h2>管理自己的素材</h2><p>可以对AI说“把我的中国心改名为歌唱祖国”或“帮我删除我的中国心”。系统只允许修改和删除当前用户自己的素材。</p></div></div><a class="guide-back" href="/">返回首页</a></section>`;
}

async function renderRegister() {
  const uploadToken = query.get('uploadToken') || location.hash.replace('#','');
  if (!uploadToken) { app.innerHTML = message('缺少上传二维码参数，请扫码进入。'); return; }
  let info; try { info = await api(`/public/upload/${encodeURIComponent(uploadToken)}`); } catch(e) { app.innerHTML = message(e.message); return; }
  app.innerHTML = `<section class="card"><h2>用户登记 / 登录</h2><p class="muted">所属连队：${esc(info.team.name)}。首次使用请登记，已登记用户可直接登录继续上传。</p><form id="reg-form"><label>姓名<input name="name" required maxlength="40" placeholder="例如：兰天笑"></label><label>连队<input name="team" required value="${esc(info.team.name)}" maxlength="30" placeholder="例如：5或五连"></label><label>班级<input name="className" required maxlength="30" placeholder="例如：1或一班"></label><div class="actions"><button type="submit">首次登记</button><button type="button" class="secondary" id="user-login">已登记，继续上传</button></div><div id="reg-msg"></div></form></section>`;
  $('#reg-form').addEventListener('submit', async (ev) => { ev.preventDefault(); const form = new FormData(ev.currentTarget); const msg = $('#reg-msg'); try { const data = await api('/registrations',{method:'POST',body:JSON.stringify({uploadToken,name:form.get('name'),team:form.get('team'),className:form.get('className')})}); sessionStorage.setItem('registrationToken',data.registration.registrationToken); sessionStorage.setItem('registrationInfo',JSON.stringify(data.registration)); location.href = '/upload'; } catch(e) { msg.innerHTML = message(e.message); } });
  $('#user-login').onclick = async () => { const form = new FormData($('#reg-form')); const msg = $('#reg-msg'); try { const data = await api('/registrations/login',{method:'POST',body:JSON.stringify({uploadToken,name:form.get('name'),team:form.get('team'),className:form.get('className')})}); sessionStorage.setItem('registrationToken',data.registration.registrationToken); sessionStorage.setItem('registrationInfo',JSON.stringify(data.registration)); location.href = '/upload'; } catch(e) { msg.innerHTML = message(e.message); } };
}
function aiAssistantMarkup(reg) {
  const identity = reg ? `${esc(reg.name)} · ${esc(reg.teamName || reg.team?.name)} · ${esc(reg.className)}` : '还未识别身份';
  const prompt = reg ? '例如：把我选择的照片上传，名字叫“我的中国心”\n或：把“我的中国心”改名为“歌唱祖国”' : '例如：我是五连1班兰天笑，帮我登录';
  return `<section class="card ai-assistant"><div class="ai-heading"><span class="ai-mark" aria-hidden="true">AI</span><div><h2>AI 投稿助手</h2><p class="muted">${identity}</p></div></div><div id="ai-thread" class="ai-thread" aria-live="polite"><div class="ai-message assistant">告诉我你是谁，以及想登录、上传、改名还是删除，我会帮你处理。</div></div><form id="ai-form"><label>对AI说<textarea id="ai-message" maxlength="600" required placeholder="${esc(prompt)}"></textarea></label><label class="upload-zone ai-upload-zone"><span class="upload-zone-title">选择照片或视频</span><span class="upload-zone-hint">只有上传时需要选择文件；登录、改名和删除都不需要</span><input id="ai-files" type="file" accept="image/*,video/*" multiple></label><div id="ai-file-summary" class="file-summary">尚未选择文件</div><button id="ai-send" type="submit">让AI处理</button></form></section>`;
}

function manualUploadMarkup(reg, teams) {
  if (!reg) return `<details class="card manual-upload"><summary>手动选择连队</summary><div class="manual-upload-content"><p class="muted">也可以使用原来的登记方式。</p>${teams.activities.flatMap((a) => a.teams.map((t) => `<a class="team-choice" href="/upload?uploadToken=${encodeURIComponent(t.uploadToken)}"><button class="secondary">${esc(t.name)}</button></a>`)).join('')}</div></details>`;
  return `<details class="card manual-upload"><summary>使用传统方式上传</summary><div class="manual-upload-content"><p class="muted">照片单张不超过20MB，视频单个不超过500MB，一次最多20个。</p><form id="upload-form"><label class="upload-zone"><span class="upload-zone-title">点击选择素材</span><span class="upload-zone-hint">支持 JPG、PNG、MP4 等格式 · 可多选</span><input id="files" type="file" name="files" accept="image/*,video/*" multiple required></label><div id="file-summary" class="file-summary">尚未选择文件</div><div id="upload-msg"></div><button>开始上传</button></form></div></details>`;
}

function addAiMessage(text, role = 'assistant', extra = '') {
  const thread = $('#ai-thread'); if (!thread) return;
  const item = document.createElement('div'); item.className = `ai-message ${role}`; item.innerHTML = `${esc(text)}${extra}`; thread.appendChild(item); item.scrollIntoView({ block:'nearest', behavior:'smooth' });
}

function findTeamRecord(teams, name) { return teams.activities.flatMap((activity) => activity.teams).find((team) => team.name === name); }
function saveRegistration(registration) { sessionStorage.setItem('registrationToken', registration.registrationToken); sessionStorage.setItem('registrationInfo', JSON.stringify(registration)); }

async function establishAiRegistration(intent, teams, allowCreate = true) {
  if (!intent.name || !intent.team || !intent.className) throw new Error('请补充姓名、连队和班级，例如“五连1班兰天笑”。');
  const team = findTeamRecord(teams, intent.team); if (!team) throw new Error(`没有找到“${intent.team}”，请确认连队名称。`);
  const body = { uploadToken:team.uploadToken, name:intent.name, team:intent.team, className:intent.className };
  let data;
  try { data = await api('/registrations/login', { method:'POST', body:JSON.stringify(body) }); }
  catch (error) {
    if (error.status !== 401) throw error;
    if (!allowCreate) throw new Error('没有找到这个身份的登记记录，请确认姓名、连队和班级。');
    try { data = await api('/registrations', { method:'POST', body:JSON.stringify(body) }); }
    catch (createError) { if (createError.status !== 409) throw createError; data = await api('/registrations/login', { method:'POST', body:JSON.stringify(body) }); }
  }
  saveRegistration(data.registration); return data.registration;
}

async function bindAiAssistant(initialReg, initialTeams) {
  let activeReg = initialReg; let activeToken = sessionStorage.getItem('registrationToken'); let teams = initialTeams; let draft = {};
  const form = $('#ai-form'); const filesInput = $('#ai-files'); const summary = $('#ai-file-summary');
  filesInput.addEventListener('change', () => { const files = [...filesInput.files]; summary.textContent = files.length ? `已选择 ${files.length} 个文件 · ${fmtSize(files.reduce((sum, file) => sum + file.size, 0))}` : '尚未选择文件'; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const text = $('#ai-message').value.trim(); const files = [...filesInput.files]; const button = $('#ai-send');
    if (!text) return; addAiMessage(text, 'user'); button.disabled = true; button.textContent = 'AI 正在理解…';
    try {
      let result = await api('/ai/intent', { method:'POST', body:JSON.stringify({ message:text, fileNames:files.map((file) => file.name), registrationToken:activeToken, context:draft }) });
      draft = { ...draft, ...result.intent };
      if (result.intent.action === 'login') {
        if (activeReg) { addAiMessage(`你已经登录：${activeReg.name} · ${activeReg.teamName || activeReg.team?.name} · ${activeReg.className}`); return; }
        teams ||= await api('/public/teams'); activeReg = await establishAiRegistration(result.intent, teams, false); activeToken = activeReg.registrationToken;
        await renderUpload(); addAiMessage(`登录成功：${activeReg.name} · ${activeReg.teamName || activeReg.team?.name} · ${activeReg.className}。现在可以管理自己的素材，无需上传文件。`); return;
      }
      if (result.intent.action === 'upload') {
        if (!files.length) { addAiMessage(result.intent.reply || '请先选择要上传的照片或视频。'); return; }
        if (!result.intent.mediaTitle) { addAiMessage(result.intent.reply || '请告诉我这些素材想显示什么名称。'); return; }
        if (!activeReg) { teams ||= await api('/public/teams'); activeReg = await establishAiRegistration(result.intent, teams); activeToken = activeReg.registrationToken; }
        const fd = new FormData(); fd.append('registrationToken', activeToken); files.forEach((file) => fd.append('files', file));
        button.textContent = '正在上传…'; const uploaded = await api('/media/upload', { method:'POST', body:fd });
        await Promise.all(uploaded.media.map((item, index) => api(`/user/media/${item.id}`, { method:'PATCH', body:JSON.stringify({ registrationToken:activeToken, originalName:uploaded.media.length > 1 ? `${result.intent.mediaTitle} ${index + 1}` : result.intent.mediaTitle }) })));
        const galleryUrl = `/gallery?publicToken=${encodeURIComponent(activeReg.team.publicToken)}`;
        await renderUpload(); addAiMessage(`上传完成，共 ${uploaded.media.length} 个素材，名称已设置为“${result.intent.mediaTitle}”。`, 'assistant', `<a class="ai-result-link" href="${galleryUrl}">查看连队相册</a>`);
        return;
      }
      if (result.intent.action === 'delete') {
        if (!activeReg) { teams ||= await api('/public/teams'); activeReg = await establishAiRegistration(result.intent, teams, false); activeToken = activeReg.registrationToken; result = await api('/ai/intent', { method:'POST', body:JSON.stringify({ message:text, registrationToken:activeToken, context:draft }) }); }
        if (!result.targetMedia) { addAiMessage(result.intent.reply || '没有唯一找到要删除的素材，请说出更完整的名称。'); return; }
        const target = result.targetMedia; addAiMessage(`找到你的素材“${target.name}”。`, 'assistant', `<button type="button" class="danger ai-confirm-delete" data-id="${target.id}">确认永久删除</button>`);
        const confirmButton = $('.ai-confirm-delete', $('#ai-thread').lastElementChild); confirmButton.onclick = async () => { if (!confirm(`确定永久删除“${target.name}”吗？`)) return; confirmButton.disabled = true; try { await api(`/user/media/${target.id}`, { method:'DELETE', body:JSON.stringify({ registrationToken:activeToken }) }); addAiMessage(`“${target.name}”已删除。`); confirmButton.closest('.ai-message').remove(); loadMyMedia(); } catch (error) { addAiMessage(error.message); confirmButton.disabled = false; } };
        return;
      }
      if (result.intent.action === 'rename') {
        if (!activeReg) { teams ||= await api('/public/teams'); activeReg = await establishAiRegistration(result.intent, teams, false); activeToken = activeReg.registrationToken; result = await api('/ai/intent', { method:'POST', body:JSON.stringify({ message:text, registrationToken:activeToken, context:draft }) }); }
        if (!result.targetMedia) { addAiMessage(result.intent.reply || '没有唯一找到要改名的素材，请说出更完整的原名称。'); return; }
        if (!result.intent.newMediaTitle) { addAiMessage(result.intent.reply || '请告诉我想改成什么新名称。'); return; }
        const target = result.targetMedia; button.textContent = '正在修改…';
        await api(`/user/media/${target.id}`, { method:'PATCH', body:JSON.stringify({ registrationToken:activeToken, originalName:result.intent.newMediaTitle }) });
        addAiMessage(`已把“${target.name}”改名为“${result.intent.newMediaTitle}”。`); draft = {}; loadMyMedia(); return;
      }
      addAiMessage(result.intent.reply || '请告诉我是要登录、上传、修改名称，还是删除自己的素材。');
    } catch (error) { addAiMessage(error.message); }
    finally { if (document.contains(button)) { button.disabled = false; button.textContent = '让AI处理'; } }
  });
}

async function renderUpload() {
  const regToken = sessionStorage.getItem('registrationToken'); const reg = JSON.parse(sessionStorage.getItem('registrationInfo') || 'null');
  const uploadToken = query.get('uploadToken') || location.hash.replace('#',''); if (uploadToken) { renderRegister(); return; }
  let teams = null; if (!regToken || !reg) { try { teams = await api('/public/teams'); } catch (e) { app.innerHTML = message(e.message); return; } }
  const hero = reg ? `<section class="card hero"><div class="hero-kicker">我的投稿</div><h1>记录此刻，分享风采。</h1><p>${esc(reg.name)} · ${esc(reg.teamName || reg.team?.name)} · ${esc(reg.className)}</p><div class="actions"><button id="switch-user" class="secondary">切换用户</button><a href="/gallery?publicToken=${encodeURIComponent(reg.team.publicToken)}"><button type="button" class="secondary">查看连队相册</button></a></div></section>` : '';
  const media = reg ? `<section class="card"><div class="section-heading"><div><h2>我的上传</h2><p class="muted">已提交的素材会出现在这里。</p></div></div><div id="my-media" class="grid"><p class="muted">正在加载…</p></div></section>` : '';
  app.innerHTML = `${aiAssistantMarkup(reg)}${hero}${manualUploadMarkup(reg, teams)}${media}`;
  bindAiAssistant(reg, teams);
  if (!reg) return;
  $('#switch-user').onclick = () => { sessionStorage.removeItem('registrationToken'); sessionStorage.removeItem('registrationInfo'); location.href = '/upload'; };
  $('#upload-form').addEventListener('submit', async (event) => { event.preventDefault(); const files = [...$('#files').files]; const msg=$('#upload-msg'); if (!files.length || files.length > 20) { msg.innerHTML=message('一次请选择1至20个文件'); return; } const fd = new FormData(); fd.append('registrationToken',regToken); files.forEach((file) => fd.append('files',file)); const button=event.currentTarget.querySelector('button'); button.disabled=true; button.textContent='上传中…'; try { const data=await api('/media/upload',{method:'POST',body:fd}); msg.innerHTML=message(`成功上传 ${data.media.length} 个素材`,'success'); $('#files').value=''; loadMyMedia(); } catch(e) { msg.innerHTML=message(e.message); } finally { button.disabled=false; button.textContent='开始上传'; } });
  $('#files').addEventListener('change', (event) => { const files = [...event.target.files]; $('#file-summary').textContent = files.length ? `已选择 ${files.length} 个文件 · ${fmtSize(files.reduce((sum, file) => sum + file.size, 0))}` : '尚未选择文件'; });
  loadMyMedia();
}

async function loadMyMedia() {
  const box = $('#my-media'); if (!box) return;
  const regToken = sessionStorage.getItem('registrationToken');
  try { const data = await api(`/user/media?registrationToken=${encodeURIComponent(regToken)}`); if (!data.media.length) { box.innerHTML = '<p class="muted">你还没有上传素材。</p>'; return; } box.innerHTML = data.media.map(m => `<article class="media-card" data-id="${m.id}">${m.mediaType === 'video' ? `<video src="${esc(m.url)}" controls preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="${esc(m.originalName)}" loading="lazy">`}<div class="media-body"><div class="media-name">${esc(m.originalName)} · ${fmtSize(m.sizeBytes)}</div><div class="actions"><button class="secondary rename-own" data-id="${m.id}" data-name="${esc(m.originalName)}">修改名称</button><button class="danger delete-own" data-id="${m.id}">永久删除</button></div></div></article>`).join(''); box.querySelectorAll('.rename-own').forEach((button) => button.onclick = async () => { const name = prompt('请输入新的展示名称', button.dataset.name); if (name === null || !name.trim()) return; try { await api(`/user/media/${button.dataset.id}`, { method:'PATCH', body: JSON.stringify({ registrationToken: regToken, originalName: name.trim() }) }); loadMyMedia(); } catch (e) { alert(e.message); } }); box.querySelectorAll('.delete-own').forEach((button) => button.onclick = async () => { if (!confirm('删除后无法恢复，确定永久删除吗？')) return; try { await api(`/user/media/${button.dataset.id}`, { method:'DELETE', body: JSON.stringify({ registrationToken: regToken }) }); loadMyMedia(); } catch (e) { alert(e.message); } }); } catch (e) { box.innerHTML = message(e.message); }
}

async function renderAllGallery() {
  let data; try { data = await api('/public/gallery'); } catch (e) { app.innerHTML = message(e.message); return; }
  const allMedia = data.activities.flatMap((activity) => activity.teams.flatMap((team) => team.media));
  const teamSections = data.activities.flatMap((activity) => activity.teams.map((team) => {
    const content = team.media.length
      ? `<div class="grid">${team.media.map((m) => `<article class="media-card" data-id="${m.id}">${mediaPreview(m)}<div class="media-body"><div class="media-name">${esc(m.originalName)} · ${fmtSize(m.sizeBytes)}</div><div class="actions"><button class="like secondary">点赞 <span>${m.likes}</span></button><button class="report secondary">举报</button></div><div class="comments">${(m.comments || []).map((c) => `<div class="comment"><strong>${esc(c.nickname)}</strong>${esc(c.content)}</div>`).join('')}</div><form class="comment-form"><input name="nickname" maxlength="30" placeholder="昵称" required><textarea name="content" maxlength="500" placeholder="写一句评论" required></textarea><button>评论</button></form></div></article>`).join('')}</div>`
      : '<p class="muted">暂时还没有公开素材。</p>';
    return `<details class="card team-gallery"><summary><span class="team-summary-copy"><span class="team-summary-label">连队相册</span><strong>${esc(team.name)}</strong></span><span class="team-summary-count">${team.media.length} 个素材</span></summary><div class="team-gallery-content">${content}</div></details>`;
  })).join('');
  app.innerHTML = `<section class="card hero"><h1>公开相册</h1><p>点击连队名称，展开查看照片和视频</p></section>${teamSections}`;
  collapseInteractionUI(); bindSimpleGalleryInteractions(allMedia);
}

function collapseInteractionUI() {
  app.querySelectorAll('.media-card').forEach((card) => { const comments=card.querySelector('.comments'); const form=card.querySelector('.comment-form'); if (comments) comments.classList.add('collapsed'); if (form) form.classList.add('collapsed'); const report=card.querySelector('.report'); if (report) { const toggle=document.createElement('button'); toggle.className='toggle-comments secondary'; toggle.innerHTML=`评论 <span>${comments ? comments.children.length : 0}</span>`; report.parentNode.insertBefore(toggle, report); toggle.onclick=()=>{ comments?.classList.toggle('collapsed'); form?.classList.toggle('collapsed'); }; const id=card.dataset.id; api(`/media/${id}/reports/count`).then((d)=>{report.innerHTML=`举报 <span>${d.reports}</span>`;}).catch(()=>{}); } });
}

function bindSimpleGalleryInteractions(mediaItems) {
  const mediaById = new Map(mediaItems.map((item) => [String(item.id), item]));
  const currentDeviceKey = deviceKey();
  app.querySelectorAll('.like').forEach((button) => { const id = button.closest('.media-card').dataset.id; api(`/media/${id}/like?deviceKey=${encodeURIComponent(currentDeviceKey)}`).then(s => { button.dataset.liked=String(s.liked); button.querySelector('span').textContent=s.likes; button.firstChild.textContent=s.liked?'已点赞 ':'点赞 '; }).catch(() => {}); button.addEventListener('click', async () => { button.disabled=true; try { const d=await api(`/media/${id}/like`,{method:'POST',body:JSON.stringify({deviceKey:currentDeviceKey})}); button.dataset.liked=String(d.liked); button.querySelector('span').textContent=d.likes; button.firstChild.textContent=d.liked?'已点赞 ':'点赞 '; } finally { button.disabled=false; } }); button.addEventListener('mouseenter',()=>{if(button.dataset.liked==='true')button.firstChild.textContent='取消点赞 ';}); button.addEventListener('mouseleave',()=>{if(button.dataset.liked==='true')button.firstChild.textContent='已点赞 ';}); });
  app.querySelectorAll('.media-preview').forEach((button) => button.onclick = () => openMediaViewer(mediaById.get(button.closest('.media-card').dataset.id)));
  app.querySelectorAll('.report').forEach((button) => button.onclick = async () => { const reason = prompt('请输入举报原因'); if (!reason) return; try { await api(`/media/${button.closest('.media-card').dataset.id}/reports`, { method:'POST', body:JSON.stringify({ reason }) }); alert('举报已提交'); } catch (e) { alert(e.message); } });
  app.querySelectorAll('.comment-form').forEach((form) => form.onsubmit = async (event) => { event.preventDefault(); const card = form.closest('.media-card'); const fields = new FormData(form); try { await api(`/media/${card.dataset.id}/comments`, { method:'POST', body:JSON.stringify({ nickname:fields.get('nickname'), content:fields.get('content') }) }); await renderAllGallery(); } catch (e) { alert(e.message); } });
}

async function renderGallery() {
  const publicToken = query.get('publicToken') || query.get('token'); if (!publicToken) { renderAllGallery(); return; }
  let data; try { data=await api(`/public/${encodeURIComponent(publicToken)}`); } catch(e) { app.innerHTML=message(e.message); return; }
  app.innerHTML = `<section class="card hero"><h1>${esc(data.team.name)} · ${esc(data.activity.name)}</h1><p>公开相册 · 共 ${data.media.length} 个素材</p></section><section class="grid" id="media-grid"></section>`;
  const grid=$('#media-grid'); if(!data.media.length){grid.innerHTML='<div class="card"><p class="muted">暂时还没有公开素材。</p></div>';return;}
  grid.innerHTML=data.media.map(m=>`<article class="media-card" data-id="${m.id}">${mediaPreview(m)}<div class="media-body"><div class="media-name" title="${esc(m.originalName)}">${esc(m.originalName)} · ${fmtSize(m.sizeBytes)}</div><div class="actions"><button class="like secondary">点赞 <span>${m.likes}</span></button><button class="report secondary">举报</button></div><div class="comments">${(m.comments||[]).map(c=>`<div class="comment"><strong>${esc(c.nickname)}</strong>${esc(c.content)}</div>`).join('')}</div><form class="comment-form"><input name="nickname" maxlength="30" placeholder="昵称" required><textarea name="content" maxlength="500" placeholder="写一句祝福" required></textarea><button>留言</button></form></div></article>`).join(''); collapseInteractionUI();
  const currentDeviceKey = deviceKey();
  grid.querySelectorAll('.like').forEach(async (button) => { const id = button.closest('.media-card').dataset.id; try { const state = await api(`/media/${id}/like?deviceKey=${encodeURIComponent(currentDeviceKey)}`); button.dataset.liked = String(state.liked); button.querySelector('span').textContent = state.likes; button.firstChild.textContent = state.liked ? '已点赞 ' : '点赞 '; } catch {} button.addEventListener('mouseenter', () => { if (button.dataset.liked === 'true') button.firstChild.textContent = '取消点赞 '; }); button.addEventListener('mouseleave', () => { if (button.dataset.liked === 'true') button.firstChild.textContent = '已点赞 '; }); });
  grid.addEventListener('click', async (ev) => { const card=ev.target.closest('.media-card'); if(!card)return; const id=card.dataset.id; if(ev.target.closest('.like')) { const button = ev.target.closest('.like'); button.disabled = true; try { const d=await api(`/media/${id}/like`,{method:'POST',body:JSON.stringify({deviceKey:currentDeviceKey})}); button.dataset.liked = String(d.liked); button.querySelector('span').textContent=d.likes; button.firstChild.textContent=d.liked ? '已点赞 ' : '点赞 '; } catch(e) { alert(e.message); } finally { button.disabled=false; } return; } if(ev.target.closest('.report')) { const reason=prompt('请输入举报原因'); if(reason) { try { await api(`/media/${id}/reports`,{method:'POST',body:JSON.stringify({reason})}); alert('举报已提交'); } catch(e){alert(e.message);} } return; } if (ev.target.closest('.media-preview')) { openMediaViewer(data.media.find((item) => String(item.id) === String(id))); } });
  grid.addEventListener('submit', async (ev) => { if(!ev.target.matches('.comment-form'))return; ev.preventDefault(); const id=ev.target.closest('.media-card').dataset.id; const fd=new FormData(ev.target); try { await api(`/media/${id}/comments`,{method:'POST',body:JSON.stringify({nickname:fd.get('nickname'),content:fd.get('content')})}); ev.target.reset(); alert('留言成功'); renderGallery(); } catch(e){alert(e.message);} });
}

let adminToken = sessionStorage.getItem('admin-token') || 'testing-disabled-auth';
async function renderAdmin() { if(!adminToken){ app.innerHTML=`<section class="card"><h2>管理后台登录</h2><form id="login"><label>管理员密码<input name="password" type="password" required></label><div id="login-msg"></div><button>登录</button></form></section>`; $('#login').addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/admin/login',{method:'POST',body:JSON.stringify({password:new FormData(e.currentTarget).get('password')})});adminToken=d.token;sessionStorage.setItem('admin-token',adminToken);renderAdmin();}catch(err){$('#login-msg').innerHTML=message(err.message);}});return;} const H={Authorization:`Bearer ${adminToken}`}; try { const [dash,acts,med]=await Promise.all([api('/admin/dashboard',{headers:H}),api('/admin/activities',{headers:H}),api('/admin/media',{headers:H})]); app.innerHTML=`<section class="card"><div class="row admin-header"><h2>管理后台</h2><button id="logout" class="secondary">退出</button></div><div class="stats">${Object.entries(dash.stats).map(([k,v])=>`<div class="stat"><span>${esc({activities:'活动',teams:'连队',registrations:'登记',media:'素材',published:'已上架',openReports:'未处理举报',comments:'留言',danmaku:'弹幕'}[k]||k)}</span><b>${v}</b></div>`).join('')}</div></section><section class="card"><h2>活动和连队二维码</h2><form id="team-form"><label>活动<select name="activityId">${acts.activities.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label><label>新建连队<input name="name" placeholder="例如：五连" required></label><button>创建连队</button></form><div id="teams">${acts.activities.flatMap(a=>a.teams.map(t=>`<div class="card"><h3>${esc(a.name)} · ${esc(t.name)}</h3><div class="linkbox">上传：${esc(location.origin+'/register?uploadToken='+t.uploadToken)}<br>浏览：${esc(location.origin+'/gallery?publicToken='+t.publicToken)}</div><div class="actions"><img class="qr" src="/api/admin/qr/gallery/${encodeURIComponent(t.publicToken)}" alt="浏览二维码"><img class="qr" src="/api/admin/qr/register/${encodeURIComponent(t.uploadToken)}" alt="上传二维码"></div></div>`)).join('')}</div></section><section class="card"><h2>素材审核（上传默认上架）</h2><div class="table-wrap"><table class="admin-table"><thead><tr><th>素材</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>${med.media.map(m=>`<tr><td data-label="素材">${esc(m.originalName)}<br><span class="muted">${fmtSize(m.sizeBytes)}</span></td><td data-label="来源">${esc(m.team)}<br>${esc(m.uploader)} · ${esc(m.className)}</td><td data-label="状态"><span class="pill">${esc(m.status)}</span></td><td data-label="操作">${m.status==='published'?`<button class="hide-media" data-id="${m.id}">下架</button>`:`<button class="publish-media" data-id="${m.id}">上架</button>`}</td></tr>`).join('')}</tbody></table></div></section>`; $('#logout').onclick=()=>{sessionStorage.removeItem('admin-token');adminToken=null;renderAdmin();}; $('#team-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/admin/teams',{method:'POST',headers:H,body:JSON.stringify({activityId:f.get('activityId'),name:f.get('name')})});renderAdmin();}catch(err){alert(err.message);}}; app.querySelectorAll('.hide-media,.publish-media').forEach(b=>b.onclick=async()=>{await api(`/admin/media/${b.dataset.id}`,{method:'PATCH',headers:H,body:JSON.stringify({status:b.classList.contains('hide-media')?'hidden':'published'})});renderAdmin();}); } catch(e) { if (e.message.includes('登录')) { sessionStorage.removeItem('admin-token');adminToken=null;renderAdmin(); } else app.innerHTML=message(e.message); } }

async function enhanceAdminModeration() {
  if (!(location.pathname === '/admin' || location.pathname.startsWith('/admin/')) || document.querySelector('#admin-moderation')) return;
  const auth = adminToken;
  if (!auth) return;
  try {
    const H = { Authorization: `Bearer ${auth}` };
    const [reports, comments, media, danmaku] = await Promise.all([api('/admin/reports', { headers: H }), api('/admin/comments', { headers: H }), api('/admin/media', { headers: H }), api('/admin/danmaku', { headers: H })]);
    const section = document.createElement('section'); section.className = 'card'; section.id = 'admin-moderation';
    const danmakuGroups = media.media.map((item) => ({ media:item, entries:danmaku.danmaku.filter((entry) => Number(entry.media_id) === Number(item.id)) })).filter((group) => group.entries.length);
    section.innerHTML = `<h2>举报、留言、弹幕和点赞</h2><h3>举报</h3><div class="table-wrap admin-card-list"><table class="admin-table moderation-table"><thead><tr><th>素材</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>${reports.reports.map(r => `<tr><td data-label="素材">${esc(r.original_name)}</td><td data-label="原因">${esc(r.reason)}</td><td data-label="状态">${esc(r.status)}</td><td data-label="操作">${r.status === 'open' ? `<div class="admin-actions"><button class="resolve-report danger" data-id="${r.id}">删除内容</button><button class="ignore-report secondary" data-id="${r.id}">忽略</button></div>` : '-'}</td></tr>`).join('')}</tbody></table></div><h3>留言</h3><div class="table-wrap admin-card-list"><table class="admin-table moderation-table"><thead><tr><th>昵称</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>${comments.comments.map(c => `<tr><td data-label="昵称">${esc(c.nickname)}</td><td data-label="内容">${esc(c.content)}</td><td data-label="状态">${esc(c.status)}</td><td data-label="操作"><div class="admin-actions"><button class="toggle-comment ${c.status === 'published' ? 'danger' : ''}" data-id="${c.id}" data-status="${c.status === 'published' ? 'hidden' : 'published'}">${c.status === 'published' ? '隐藏' : '恢复'}</button></div></td></tr>`).join('')}</tbody></table></div><h3>弹幕管理</h3><p class="muted">按图片或视频分组，可永久删除单条弹幕。</p><div class="danmaku-admin-groups">${danmakuGroups.length ? danmakuGroups.map((group) => `<details class="danmaku-admin-group"><summary><span>${esc(group.media.originalName)}</span><b>${group.entries.length} 条</b></summary><div class="table-wrap admin-card-list"><table class="admin-table moderation-table"><thead><tr><th>昵称</th><th>弹幕内容</th><th>状态</th><th>操作</th></tr></thead><tbody>${group.entries.map((entry) => `<tr><td data-label="昵称">${esc(entry.nickname)}</td><td data-label="弹幕内容">${esc(entry.content)}</td><td data-label="状态">${entry.status === 'published' ? '显示中' : '已隐藏'}</td><td data-label="操作"><button class="delete-danmaku danger" data-id="${entry.id}">删除弹幕</button></td></tr>`).join('')}</tbody></table></div></details>`).join('') : '<p class="muted">当前还没有弹幕。</p>'}</div><h3>点赞统计</h3><div class="table-wrap admin-card-list"><table class="admin-table"><thead><tr><th>素材</th><th>上传者</th><th>点赞数</th></tr></thead><tbody>${media.media.map(m => `<tr><td data-label="素材">${esc(m.originalName)}</td><td data-label="上传者">${esc(m.uploader)}</td><td data-label="点赞数">${m.likes || 0}</td></tr>`).join('')}</tbody></table></div>`;
    app.appendChild(section);
    section.querySelectorAll('.resolve-report').forEach((b) => { b.onclick = async () => { const report = reports.reports.find((item) => String(item.id) === String(b.dataset.id)); if (!report || !confirm('确定永久删除这条被举报素材吗？')) return; try { await api(`/admin/media/${report.media_id}`, { method:'DELETE', headers:H }); await api(`/admin/reports/${report.id}`, { method:'PATCH', headers:H, body:JSON.stringify({ status:'resolved' }) }); section.remove(); enhanceAdminModeration(); } catch (e) { alert(e.message); } }; });
    section.querySelectorAll('.ignore-report').forEach((b) => b.onclick = async () => { await api(`/admin/reports/${b.dataset.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'ignored' }) }); section.remove(); enhanceAdminModeration(); });
    section.querySelectorAll('.toggle-comment').forEach((b) => b.onclick = async () => { await api(`/admin/comments/${b.dataset.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: b.dataset.status }) }); section.remove(); enhanceAdminModeration(); });
    section.querySelectorAll('.delete-danmaku').forEach((b) => b.onclick = async () => { if (!confirm('确定永久删除这条弹幕吗？')) return; await api(`/admin/danmaku/${b.dataset.id}`, { method:'DELETE', headers:H }); section.remove(); enhanceAdminModeration(); });
  } catch {}
}

function refreshAdminLinksAndQrs() {
  if (!(location.pathname === '/admin' || location.pathname.startsWith('/admin/'))) return;
  document.querySelectorAll('.admin-table').forEach((table) => table.closest('.table-wrap')?.classList.add('admin-card-list'));
  document.querySelectorAll('#app > section.card').forEach((section) => { if (section.querySelector('h2')?.textContent.includes('活动和连队二维码')) section.remove(); });
  document.querySelectorAll('.hide-media,.publish-media').forEach((oldButton) => { if (oldButton.dataset.deleteBound) return; const button = oldButton.cloneNode(false); button.className = 'danger delete-media'; button.textContent = '永久删除'; button.dataset.deleteBound = '1'; oldButton.replaceWith(button); button.onclick = async () => { if (!confirm('删除后无法恢复，确定永久删除吗？')) return; try { await api(`/admin/media/${button.dataset.id}`, { method:'DELETE', headers:{Authorization:adminToken} }); renderAdmin(); } catch (e) { alert(e.message); } }; });
}

const path = location.pathname;
if (path === '/register' || path.startsWith('/register/')) renderRegister(); else if (path === '/upload' || path.startsWith('/upload/')) renderUpload(); else if (path === '/gallery' || path.startsWith('/gallery/')) renderGallery(); else if (path === '/guide' || path.startsWith('/guide/')) renderGuide(); else if (path === '/admin' || path.startsWith('/admin/')) { renderAdmin(); setTimeout(refreshAdminLinksAndQrs, 0); setInterval(() => { enhanceAdminModeration(); refreshAdminLinksAndQrs(); }, 1200); new MutationObserver(refreshAdminLinksAndQrs).observe(app, { childList: true, subtree: true }); } else renderHome();

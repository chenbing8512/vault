/* ============================================================
   密码库 · 本地离线加密密码管理器
   加密在 Rust 原生层完成（AES-256-GCM + PBKDF2-SHA256 600k）
   浏览器直开时降级为 WebCrypto，参数完全一致
   ============================================================ */

const IS_DESKTOP = !!(window.__TAURI__ && window.__TAURI__.core);
const invoke = IS_DESKTOP ? window.__TAURI__.core.invoke : null;

const AAD_TEXT = 'local-vault::v1';
const ITERATIONS = 600000;
const WEB_KEY = 'vault.envelope.v1';
const PREFS_KEY = 'vault.prefs';
const OLD_DAYS = 180;

/* ---------------- 常量 ---------------- */
const TYPES = [
  { key: 'all', label: '全部' },
  { key: 'fav', label: '收藏' },
  { key: 'web', label: '网站' },
  { key: 'mail', label: '邮箱' },
  { key: 'bank', label: '金融' },
  { key: 'server', label: '服务器' },
  { key: 'other', label: '其他' },
];

const KINDS = {
  login: { label: '登录', hint: '账号 + 密码 + 网址' },
  card: {
    label: '银行卡',
    hint: '卡号、有效期、CVV',
    fields: [
      { label: '卡号', secret: false },
      { label: '持卡人', secret: false },
      { label: '有效期', secret: false },
      { label: 'CVV', secret: true },
      { label: '取款密码', secret: true },
    ],
  },
  identity: {
    label: '身份',
    hint: '证件、护照等身份信息',
    fields: [
      { label: '姓名', secret: false },
      { label: '证件号', secret: true },
      { label: '电话', secret: false },
      { label: '邮箱', secret: false },
      { label: '地址', secret: false },
    ],
  },
  apikey: {
    label: '密钥',
    hint: 'API Key / Token',
    fields: [
      { label: 'Key', secret: true },
      { label: 'Secret', secret: true },
      { label: '环境', secret: false },
    ],
  },
  note: { label: '笔记', hint: '一段纯文本，比如恢复码' },
};

const THEMES = [
  { key: 'aurora', name: '极光', colors: ['#080a0f', '#6f8cff', '#a78bfa', '#e9edf7'] },
  { key: 'mono', name: '石墨', colors: ['#0b0b0d', '#e8e8ea', '#8a8a90', '#ececee'] },
  { key: 'forest', name: '森野', colors: ['#07100c', '#35d39b', '#a3e635', '#e4f0e9'] },
  { key: 'sunset', name: '落日', colors: ['#0f0a09', '#fb923c', '#fb7185', '#f6ece7'] },
  { key: 'daylight', name: '晨光', colors: ['#eef0f5', '#4f6ef7', '#8b5cf6', '#171a22'] },
];

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2.5 2.5 0 0 0-2.5 2.5V13"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4l16 16"/><path d="M9.6 6.1A9.7 9.7 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 4M6.3 8.1A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.8L17.5 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6"><path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5.5V11h-5.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>',
  login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.4 3.1-5.4 7-5.4s7 2 7 5.4"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.8" y="5.5" width="18.4" height="13" rx="2.6"/><path d="M2.8 10h18.4"/></svg>',
  identity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.8" y="4.8" width="18.4" height="14.4" rx="2.4"/><circle cx="8.6" cy="11" r="2"/><path d="M5.4 16.2c.4-1.6 1.6-2.4 3.2-2.4s2.8.8 3.2 2.4M14.6 10h4M14.6 13.4h4"/></svg>',
  apikey: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="3.6"/><path d="m10.6 10.6 8 8M16.4 18.6l-1.8-1.8M19 16l-1.8-1.8"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M15 3.5V7h3.5M9 12h6M9 15.5h4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8.2 10.5V7.4a3.8 3.8 0 0 1 7.6 0"/></svg>',
};

/* ---------------- 全局状态 ---------------- */
const state = {
  items: [],
  selectedId: null,
  filter: 'all',
  query: '',
  view: 'item',
  unlocked: false,
  dirty: false,
  meta: { exists: false, path: '', backupDir: '' },
};

const prefs = { theme: 'aurora', autolock: 5, clipClear: 30 };

/* ---------------- 基础工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const day = Math.floor(diff / 86400000);
  if (day > 365) return Math.floor(day / 365) + ' 年前';
  if (day > 30) return Math.floor(day / 30) + ' 个月前';
  if (day >= 1) return day + ' 天前';
  const h = Math.floor(diff / 3600000);
  if (h >= 1) return h + ' 小时前';
  return '刚刚';
}

const AVATAR_COLORS = [
  ['#6f8cff', '#a78bfa'], ['#f472b6', '#c084fc'], ['#34d399', '#22d3ee'],
  ['#fbbf24', '#f97316'], ['#60a5fa', '#38bdf8'], ['#fb7185', '#f472b6'],
  ['#4ade80', '#2dd4bf'], ['#a78bfa', '#818cf8'],
];

function avatarOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  const [a, b] = AVATAR_COLORS[h % AVATAR_COLORS.length];
  return { ch: (text.trim()[0] || '?').toUpperCase(), bg: `linear-gradient(145deg, ${a}, ${b})` };
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2300);
}

async function copyText(text, label = '已复制') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  toast(label, 'ok');
}

function wipeClipboardLater(original) {
  if (!prefs.clipClear) return;
  setTimeout(async () => {
    try {
      const cur = await navigator.clipboard.readText();
      if (cur === original) await navigator.clipboard.writeText('');
    } catch (_) {}
  }, prefs.clipClear * 1000);
}

function copySecret(val) {
  if (!val) return;
  copyText(val, '已复制，' + (prefs.clipClear ? prefs.clipClear + ' 秒后自动清除剪贴板' : ''));
  wipeClipboardLater(val);
}

/* ---------------- 主题 ---------------- */
function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    Object.assign(prefs, raw);
  } catch (_) {}
  applyTheme(prefs.theme, false);
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) {}
}

function applyTheme(key, persist = true) {
  if (!THEMES.some((t) => t.key === key)) key = 'aurora';
  prefs.theme = key;
  document.documentElement.setAttribute('data-theme', key);
  if (persist) savePrefs();
}

/* ---------------- 弹层（替代原生 confirm/prompt） ---------------- */
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-card').classList.remove('wide');
}

function confirmDialog({ title, desc, okText = '确认', danger = false }) {
  return new Promise((resolve) => {
    const card = $('#modal-card');
    card.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${desc ? `<p class="modal-sub">${desc}</p>` : '<div style="height:10px"></div>'}
      <div class="modal-actions">
        <button class="ghost-btn" id="dlg-cancel">取消</button>
        <button class="${danger ? 'ghost-btn danger' : 'primary'}" id="dlg-ok"
          style="${danger ? '' : 'width:auto;padding:0 18px;height:33px;margin:0'}">${escapeHtml(okText)}</button>
      </div>`;
    $('#modal').classList.remove('hidden');
    const done = (v) => { closeModal(); resolve(v); };
    $('#dlg-cancel').addEventListener('click', () => done(false));
    $('#dlg-ok').addEventListener('click', () => done(true));
    setTimeout(() => $('#dlg-ok').focus(), 50);
  });
}

function promptDialog({ title, desc, fields, okText = '确定' }) {
  return new Promise((resolve) => {
    const card = $('#modal-card');
    card.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${desc ? `<p class="modal-sub">${desc}</p>` : ''}
      ${fields.map((f) => `
        <div class="field" style="margin-bottom:10px">
          <input id="pf-${f.key}" type="${f.type || 'text'}" placeholder="${escapeHtml(f.placeholder || '')}"
            value="${escapeHtml(f.value || '')}" style="height:40px" />
        </div>`).join('')}
      <div class="modal-actions">
        <button class="ghost-btn" id="dlg-cancel">取消</button>
        <button class="primary" id="dlg-ok" style="width:auto;padding:0 18px;height:33px;margin:0">${escapeHtml(okText)}</button>
      </div>`;
    $('#modal').classList.remove('hidden');
    const first = fields[0] ? $('#pf-' + fields[0].key) : null;
    if (first) setTimeout(() => first.focus(), 60);
    const done = (v) => { closeModal(); resolve(v); };
    $('#dlg-cancel').addEventListener('click', () => done(null));
    $('#dlg-ok').addEventListener('click', () => {
      const out = {};
      fields.forEach((f) => { out[f.key] = $('#pf-' + f.key).value; });
      done(out);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('#dlg-ok').click();
    });
  });
}

/* ---------------- 存储层 ---------------- */
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

const webStore = {
  key: null,
  async derive(password, salt, iterations) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },
  async encrypt(key, saltB64, iterations, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(AAD_TEXT) },
      key, new TextEncoder().encode(text)
    );
    return {
      version: 1,
      kdf: { algo: 'PBKDF2-HMAC-SHA256', iterations, salt: saltB64 },
      iv: b64.enc(iv),
      data: b64.enc(ct),
    };
  },
};

const store = {
  async status() {
    if (IS_DESKTOP) return invoke('vault_status');
    const raw = localStorage.getItem(WEB_KEY);
    return { exists: !!raw, path: '浏览器 localStorage', backupDir: '-' };
  },
  async create(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = b64.enc(salt);
    const empty = JSON.stringify({ version: 1, items: [], settings: {} });
    if (IS_DESKTOP) return invoke('create_vault', { password });
    const key = await webStore.derive(password, salt, ITERATIONS);
    const env = await webStore.encrypt(key, saltB64, ITERATIONS, empty);
    localStorage.setItem(WEB_KEY, JSON.stringify(env));
    webStore.key = key;
    return empty;
  },
  async unlock(password) {
    if (IS_DESKTOP) return invoke('unlock', { password });
    const raw = localStorage.getItem(WEB_KEY);
    if (!raw) throw new Error('还没有密码库');
    const env = JSON.parse(raw);
    const key = await webStore.derive(password, b64.dec(env.kdf.salt), env.kdf.iterations);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64.dec(env.iv), additionalData: new TextEncoder().encode(AAD_TEXT) },
        key, b64.dec(env.data)
      );
      webStore.key = key;
      return new TextDecoder().decode(plain);
    } catch (e) {
      throw new Error('主密码不正确，或数据文件已损坏');
    }
  },
  async save(text) {
    if (IS_DESKTOP) return invoke('save_vault', { data: text });
    const prev = JSON.parse(localStorage.getItem(WEB_KEY));
    const env = await webStore.encrypt(webStore.key, prev.kdf.salt, prev.kdf.iterations, text);
    localStorage.setItem(WEB_KEY, JSON.stringify(env));
  },
  async lock() {
    webStore.key = null;
    if (IS_DESKTOP) return invoke('lock');
  },
  async changePassword(pwd) {
    if (IS_DESKTOP) return invoke('change_password', { newPassword: pwd });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = b64.enc(salt);
    const key = await webStore.derive(pwd, salt, ITERATIONS);
    const text = serialize();
    const env = await webStore.encrypt(key, saltB64, ITERATIONS, text);
    localStorage.setItem(WEB_KEY, JSON.stringify(env));
    webStore.key = key;
  },
  async exportBackup() {
    if (IS_DESKTOP) return invoke('export_backup');
    const raw = localStorage.getItem(WEB_KEY);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    downloadBlob(raw, `vault-backup-${stamp}.dat`);
    return '已下载到浏览器下载目录';
  },
  async listBackups() {
    if (IS_DESKTOP) return invoke('list_backups');
    return [];
  },
  async restore(name) {
    if (IS_DESKTOP) return invoke('restore_backup', { name });
    throw new Error('浏览器模式不支持从备份恢复');
  },
  async exportText(content, filename) {
    if (IS_DESKTOP) return invoke('export_text', { content, filename });
    downloadBlob(content, filename);
    return '已下载到浏览器下载目录';
  },
};

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function serialize() {
  return JSON.stringify({ version: 2, items: state.items, settings: {} });
}

/* ---------------- 持久化 ---------------- */
let saveTimer = null;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    try {
      await store.save(serialize());
      state.dirty = false;
    } catch (e) {
      toast('保存失败：' + (e.message || e), 'err');
    }
  };
  if (immediate) return run();
  state.dirty = true;
  saveTimer = setTimeout(run, 650);
}

/* ---------------- 数据迁移 ---------------- */
function defaultFields(kind) {
  const def = KINDS[kind] && KINDS[kind].fields;
  if (!def) return [];
  return def.map((f) => ({ id: uid(), label: f.label, value: '', secret: !!f.secret }));
}

function migrate(items) {
  return (items || []).map((it) => {
    const kind = KINDS[it.kind] ? it.kind : 'login';
    const fields = Array.isArray(it.fields)
      ? it.fields.map((f) => ({ id: f.id || uid(), label: f.label || '字段', value: f.value || '', secret: !!f.secret }))
      : (kind === 'login' ? [] : defaultFields(kind));
    return {
      id: it.id || uid(),
      kind,
      title: it.title || '',
      username: it.username || '',
      password: it.password || '',
      url: it.url || '',
      otp: it.otp || '',
      category: it.category || it.type || 'other',
      fields,
      notes: it.notes || '',
      favorite: !!it.favorite,
      history: Array.isArray(it.history) ? it.history : [],
      createdAt: it.createdAt || Date.now(),
      updatedAt: it.updatedAt || it.createdAt || Date.now(),
      deletedAt: it.deletedAt || null,
    };
  });
}

const activeItems = () => state.items.filter((i) => !i.deletedAt);
const trashedItems = () => state.items.filter((i) => i.deletedAt);

/* ---------------- 门禁 ---------------- */
let gateMode = 'unlock';

function setGateMode(mode) {
  gateMode = mode;
  const isCreate = mode === 'create';
  $('#gate-title').textContent = isCreate ? '创建密码库' : '密码库';
  $('#gate-sub').textContent = isCreate ? '设置一个主密码，只有你能打开' : '输入主密码以解锁';
  $('#pwd2-wrap').classList.toggle('hidden', !isCreate);
  $('#strength').classList.toggle('hidden', !isCreate);
  $('#gate-submit').textContent = isCreate ? '创建并进入' : '解锁';
  $('#gate-error').textContent = '';
  setTimeout(() => $('#pwd').focus(), 60);
}

function pwdStrength(v) {
  if (!v) return 0;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (v.length >= 16) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  return Math.min(4, Math.max(1, Math.floor(score * 0.72)));
}

const STRENGTH_COLORS = ['#ff6b6b', '#f59e0b', '#eab308', '#34d399', '#46d39a'];
const STRENGTH_LABELS = ['太弱', '较弱', '一般', '较强', '很强'];

function pwdMeterHtml(v) {
  const s = pwdStrength(v);
  const bars = [0, 1, 2, 3].map((i) =>
    `<i style="background:${i < s ? STRENGTH_COLORS[s] : 'rgba(var(--tint),.12)'}"></i>`
  ).join('');
  return `<div class="pwd-meter">${bars}<span>${v ? STRENGTH_LABELS[s] : ''}</span></div>`;
}

function renderStrength(v) {
  const bars = $$('#strength .strength-bar i');
  const s = pwdStrength(v);
  bars.forEach((b, i) => { b.style.background = i < s ? STRENGTH_COLORS[s] : 'rgba(var(--tint),.1)'; });
  $('#strength-label').textContent = v ? STRENGTH_LABELS[s] : '强度';
}

$('#pwd').addEventListener('input', (e) => {
  if (gateMode === 'create') renderStrength(e.target.value);
  $('#gate-error').textContent = '';
});
$('#pwd2').addEventListener('input', () => { $('#gate-error').textContent = ''; });

$('#peek').addEventListener('click', () => {
  const p = $('#pwd');
  p.type = p.type === 'password' ? 'text' : 'password';
  p.focus();
});

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = $('#pwd').value;
  const btn = $('#gate-submit');
  if (!pwd) return;
  if (gateMode === 'create') {
    if (pwd.length < 6) return ($('#gate-error').textContent = '主密码至少 6 位');
    if (pwd !== $('#pwd2').value) return ($('#gate-error').textContent = '两次输入的主密码不一致');
    if (pwdStrength(pwd) < 2) {
      const ok = await confirmDialog({
        title: '主密码偏弱',
        desc: '这个主密码容易被猜到。密码库一旦遗失主密码就无法恢复，建议至少 12 位并混合大小写与符号。仍要继续吗？',
        okText: '仍然使用',
        danger: true,
      });
      if (!ok) return;
    }
  }
  btn.disabled = true;
  const origin = btn.textContent;
  btn.textContent = gateMode === 'create' ? '正在创建…' : '正在解锁…';
  try {
    const plain = gateMode === 'create' ? await store.create(pwd) : await store.unlock(pwd);
    const data = JSON.parse(plain || '{}');
    state.items = migrate(data.items);
    state.unlocked = true;
    $('#pwd').value = '';
    $('#pwd2').value = '';
    enterApp();
  } catch (err) {
    $('#gate-error').textContent = String(err && err.message ? err.message : err);
  } finally {
    btn.disabled = false;
    btn.textContent = origin;
  }
});

/* ---------------- 进入 / 退出 ---------------- */
function enterApp() {
  $('#gate').classList.add('hidden');
  $('#main').classList.remove('hidden');
  state.view = 'item';
  renderFilters();
  renderList();
  const first = activeItems()[0];
  if (first) selectItem(first.id);
  else renderDetail();
  resetAutoLock();
}

async function doLock(silent) {
  if (!state.unlocked) return;
  stopOtpTicker();
  clearTimeout(saveTimer);
  try {
    if (state.dirty) await store.save(serialize());
  } catch (_) {}
  await store.lock();
  state.unlocked = false;
  state.items = [];
  state.selectedId = null;
  state.query = '';
  state.filter = 'all';
  state.view = 'item';
  $('#search').value = '';
  $('#list').innerHTML = '';
  $('#detail').innerHTML = '';
  $('#main').classList.add('hidden');
  $('#gate').classList.remove('hidden');
  setGateMode('unlock');
  if (!silent) toast('已锁定');
}

$('#lock-btn').addEventListener('click', () => doLock());

/* ---------------- 自动锁定 ---------------- */
let lockTimer = null;
function resetAutoLock() {
  clearTimeout(lockTimer);
  if (!state.unlocked || !prefs.autolock) return;
  lockTimer = setTimeout(() => doLock(true), prefs.autolock * 60 * 1000);
}
['mousemove', 'keydown', 'click', 'wheel'].forEach((ev) =>
  window.addEventListener(ev, resetAutoLock, { passive: true })
);

/* ---------------- 侧栏 ---------------- */
function renderFilters() {
  $('#filters').innerHTML = TYPES.map(
    (t) => `<button class="chip ${state.filter === t.key ? 'on' : ''}" data-filter="${t.key}">${t.label}</button>`
  ).join('');
  $$('#filters .chip').forEach((c) =>
    c.addEventListener('click', () => {
      state.filter = c.dataset.filter;
      state.view = 'item';
      renderFilters();
      renderList();
      renderDetail();
    })
  );
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  let list = activeItems();
  if (state.filter === 'fav') list = list.filter((i) => i.favorite);
  else if (state.filter !== 'all') list = list.filter((i) => (i.category || 'other') === state.filter);
  if (q) {
    list = list.filter((i) =>
      [i.title, i.username, i.url, i.notes, (i.fields || []).map((f) => f.label + ' ' + f.value).join(' ')]
        .join(' ').toLowerCase().includes(q)
    );
  }
  return list.sort(
    (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

function renderList() {
  const list = visibleItems();
  const box = $('#list');
  $('#count').textContent = `${activeItems().length} 条`;
  $('#audit-btn').classList.toggle('active-view', state.view === 'audit');
  $('#trash-btn').classList.toggle('active-view', state.view === 'trash');
  if (!list.length) {
    box.innerHTML = `<div class="empty-list">${activeItems().length ? '没有匹配的条目' : '还没有任何记录<br>点右下角「新建」开始'}</div>`;
    return;
  }
  box.innerHTML = list.map((i) => {
    const av = avatarOf(i.title || '?');
    const sub = i.kind === 'login' ? (i.username || i.url || '—') : (KINDS[i.kind] ? KINDS[i.kind].label : '');
    return `<div class="item ${i.id === state.selectedId && state.view === 'item' ? 'active' : ''}" data-id="${i.id}">
      <div class="avatar" style="background:${av.bg}">${escapeHtml(av.ch)}</div>
      <div class="item-body">
        <div class="item-title">${escapeHtml(i.title || '未命名')}</div>
        <div class="item-sub">${escapeHtml(sub)}</div>
      </div>
      ${i.otp ? '<span class="badge-otp">2FA</span>' : ''}
      ${i.favorite ? '<span class="star">★</span>' : ''}
    </div>`;
  }).join('');
  $$('#list .item').forEach((el) => el.addEventListener('click', () => selectItem(el.dataset.id)));
}

function selectItem(id) {
  state.view = 'item';
  state.selectedId = id;
  renderList();
  renderDetail();
}

/* ---------------- TOTP ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  const s = String(str).replace(/[\s\-=]/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function totpCode(secret, period = 30, digits = 6) {
  const keyBytes = base32Decode(secret);
  if (!keyBytes.length) throw new Error('密钥格式不正确');
  const counter = BigInt(Math.floor(Date.now() / 1000 / period));
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

let otpTicker = null;
function stopOtpTicker() {
  if (otpTicker) clearInterval(otpTicker);
  otpTicker = null;
}

async function refreshOtpBox() {
  const box = $('#otp-area');
  if (!box || box.dataset.secret === undefined) return;
  const secret = box.dataset.secret;
  if (!secret) return;
  try {
    const code = await totpCode(secret);
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    const el = $('#otp-code');
    if (el) el.textContent = code.slice(0, 3) + ' ' + code.slice(3);
    const ring = $('#otp-ring-fg');
    if (ring) {
      const C = 2 * Math.PI * 9.5;
      ring.setAttribute('stroke-dasharray', String(C));
      ring.setAttribute('stroke-dashoffset', String(C * (1 - left / 30)));
    }
    const hint = $('#otp-left');
    if (hint) hint.textContent = left + 's';
  } catch (e) {
    const el = $('#otp-code');
    if (el) el.textContent = '密钥无效';
  }
}

function startOtpTicker() {
  stopOtpTicker();
  refreshOtpBox();
  otpTicker = setInterval(refreshOtpBox, 1000);
}

/* ---------------- 详情 ---------------- */
function emptyDetail(text) {
  $('#detail').innerHTML = `<div class="detail-empty"><div>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="10.5" width="16" height="10.5" rx="2.6"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/></svg>
    <div>${text}</div></div></div>`;
}

function renderDetail() {
  stopOtpTicker();
  if (state.view === 'audit') return renderAudit();
  if (state.view === 'trash') return renderTrash();
  const item = state.items.find((i) => i.id === state.selectedId && !i.deletedAt);
  if (!item) return emptyDetail('选择左侧条目查看详情<br><span style="opacity:.6">或按 ⌘N 新建一条</span>');

  const av = avatarOf(item.title || '?');
  const kind = KINDS[item.kind] || KINDS.login;
  const metaBits = [`<span>${kind.label}</span>`, item.updatedAt ? `<span>更新于 ${fmtDate(item.updatedAt)}</span>` : ''];
  if (item.history && item.history.length) metaBits.push(`<span>${item.history.length} 条历史密码</span>`);
  if (item.otp) metaBits.push('<span>已启用两步验证</span>');

  const isLogin = item.kind === 'login';

  $('#detail').innerHTML = `
    <div class="detail-inner">
      <div class="detail-head">
        <div class="avatar" style="background:${av.bg}">${escapeHtml(av.ch)}</div>
        <div style="flex:1;min-width:0">
          <input class="detail-title" id="f-title" value="${escapeHtml(item.title)}" placeholder="未命名条目" spellcheck="false" />
          <div class="detail-meta">${metaBits.filter(Boolean).join('<i style="opacity:.4">·</i>')}</div>
        </div>
        <div class="head-tools">
          <button class="ghost-btn icon-only" id="f-fav" title="收藏">${item.favorite ? ICONS.starOn : ICONS.star}</button>
          <button class="ghost-btn danger icon-only" id="f-del" title="移到回收站">${ICONS.trash}</button>
        </div>
      </div>

      ${isLogin ? `
        <div class="section-label">账号信息</div>
        <div class="rows">
          <div class="row">
            <span class="row-label">用户名</span>
            <input class="row-input" id="f-user" value="${escapeHtml(item.username)}" placeholder="邮箱 / 手机号 / 账号" spellcheck="false" />
            <div class="row-actions"><button class="mini-btn" id="cp-user" title="复制">${ICONS.copy}</button></div>
          </div>
          <div class="row">
            <span class="row-label">密码</span>
            <input class="row-input mono" id="f-pwd" type="password" value="${escapeHtml(item.password)}" placeholder="点击输入" spellcheck="false" autocomplete="off" />
            <div class="row-actions">
              <button class="mini-btn" id="f-peek" title="显示/隐藏">${ICONS.eye}</button>
              <button class="mini-btn" id="cp-pwd" title="复制">${ICONS.copy}</button>
              <button class="mini-btn" id="f-gen" title="生成密码">${ICONS.dice}</button>
            </div>
          </div>
          <div class="row" style="padding-top:0;padding-bottom:4px">
            <span class="row-label"></span>
            <div id="pwd-meter">${pwdMeterHtml(item.password)}</div>
          </div>
          <div class="row">
            <span class="row-label">网址</span>
            <input class="row-input" id="f-url" value="${escapeHtml(item.url)}" placeholder="https://" spellcheck="false" />
            <div class="row-actions"><button class="mini-btn" id="cp-url" title="复制">${ICONS.copy}</button></div>
          </div>
        </div>
      ` : `
        <div class="section-label">${kind.label}信息</div>
        <div class="rows" id="fields-rows"></div>
      `}

      <div class="section-label">分类</div>
      <div class="type-picker" style="padding-left:12px">
        ${TYPES.filter((t) => t.key !== 'all' && t.key !== 'fav')
          .map((t) => `<button class="tp ${(item.category || 'other') === t.key ? 'on' : ''}" data-cat="${t.key}">${t.label}</button>`)
          .join('')}
      </div>

      <div class="section-label">两步验证 <button id="otp-edit">${item.otp ? '更换密钥' : '绑定验证器'}</button></div>
      <div id="otp-area" data-secret="${escapeHtml(item.otp)}"></div>

      <div class="section-label">${isLogin ? '附加字段' : '添加字段'} <button id="add-field">+ 添加</button></div>
      <div class="rows" id="extra-rows" style="margin-top:0"></div>

      <div class="section-label">备注</div>
      <div class="notes-wrap">
        <textarea class="notes" id="f-notes" placeholder="安全问题答案、恢复码、备用邮箱…" spellcheck="false">${escapeHtml(item.notes)}</textarea>
      </div>

      ${item.history && item.history.length ? `
        <div class="section-label">历史密码 <button id="clear-history">清空</button></div>
        <div class="history-list">
          ${item.history.slice().reverse().map((h) => `<div class="history-row">
            <span class="hv">${escapeHtml(h.p)}</span>
            <span class="ht">${fmtDate(h.t)}</span>
          </div>`).join('')}
        </div>` : ''}
    </div>`;

  bindDetail(item, isLogin);
  renderOtpArea(item);
  renderFieldRows(item, isLogin);
}

function bindDetail(item, isLogin) {
  const touch = () => { item.updatedAt = Date.now(); };

  const bind = (sel, key, ev = 'input') => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(ev, () => {
      item[key] = el.value;
      touch();
      persist();
      if (key === 'title') {
        const a = avatarOf(item.title || '?');
        const avEl = $('.detail-head .avatar');
        if (avEl) { avEl.textContent = a.ch; avEl.style.background = a.bg; }
        renderList();
      }
      if (key === 'password') {
        const m = $('#pwd-meter');
        if (m) m.innerHTML = pwdMeterHtml(item.password);
      }
    });
  };

  bind('#f-title', 'title');
  if (isLogin) {
    bind('#f-user', 'username');
    bind('#f-pwd', 'password');
    bind('#f-url', 'url');

    $('#f-peek').addEventListener('click', () => {
      const p = $('#f-pwd');
      const show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      $('#f-peek').innerHTML = show ? ICONS.eyeOff : ICONS.eye;
    });
    $('#cp-user').addEventListener('click', () => copyText(item.username, '用户名已复制'));
    $('#cp-pwd').addEventListener('click', () => copySecret(item.password));
    $('#cp-url').addEventListener('click', () => copyText(item.url, '网址已复制'));
    $('#f-gen').addEventListener('click', () => {
      openGenerator((pwd) => {
        pushHistory(item);
        item.password = pwd;
        touch();
        $('#f-pwd').value = pwd;
        $('#f-pwd').type = 'text';
        const m = $('#pwd-meter');
        if (m) m.innerHTML = pwdMeterHtml(pwd);
        persist();
        toast('已生成并填入', 'ok');
      });
    });
  }

  bind('#f-notes', 'notes');

  $$('.type-picker .tp').forEach((b) =>
    b.addEventListener('click', () => {
      item.category = b.dataset.cat;
      touch();
      $$('.type-picker .tp').forEach((x) => x.classList.toggle('on', x === b));
      persist();
      renderList();
    })
  );

  $('#f-fav').addEventListener('click', () => {
    item.favorite = !item.favorite;
    touch();
    persist();
    renderList();
    $('#f-fav').innerHTML = item.favorite ? ICONS.starOn : ICONS.star;
  });

  $('#f-del').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '移到回收站？',
      desc: `「${escapeHtml(item.title || '未命名')}」会被移到回收站，可以随时恢复。`,
      okText: '移到回收站',
      danger: true,
    });
    if (!ok) return;
    item.deletedAt = Date.now();
    persist(true);
    const next = visibleItems()[0];
    state.selectedId = next ? next.id : null;
    renderList();
    renderDetail();
    toast('已移到回收站');
  });

  $('#add-field').addEventListener('click', async () => {
    const r = await promptDialog({
      title: '添加字段',
      desc: '比如「安全问题答案」「恢复码」「PIN」',
      fields: [
        { key: 'label', placeholder: '字段名' },
        { key: 'value', placeholder: '内容' },
      ],
      okText: '添加',
    });
    if (!r || !r.label.trim()) return;
    item.fields.push({ id: uid(), label: r.label.trim(), value: r.value, secret: false });
    touch();
    persist();
    renderDetail();
  });

  $('#otp-edit').addEventListener('click', async () => {
    const r = await promptDialog({
      title: '绑定两步验证',
      desc: '把验证器（Google Authenticator、1Password 等）里显示的 Base32 密钥粘贴进来，只保存在本机。',
      fields: [
        { key: 'secret', placeholder: '例如 JBSWY3DPEHPK3PXP', value: item.otp || '' },
      ],
      okText: '保存',
    });
    if (!r) return;
    const secret = r.secret.replace(/\s/g, '');
    if (secret) {
      try {
        await totpCode(secret);
      } catch (e) {
        toast('密钥格式不正确', 'err');
        return;
      }
    }
    item.otp = secret;
    touch();
    persist();
    renderDetail();
    toast(secret ? '已绑定验证器' : '已移除两步验证', 'ok');
  });

  const ch = $('#clear-history');
  if (ch) ch.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清空历史密码？', desc: '旧密码将无法找回。', okText: '清空', danger: true });
    if (!ok) return;
    item.history = [];
    persist();
    renderDetail();
  });
}

function pushHistory(item) {
  if (!item.password) return;
  item.history = item.history || [];
  if (item.history.length && item.history[item.history.length - 1].p === item.password) return;
  item.history.push({ p: item.password, t: Date.now() });
  if (item.history.length > 10) item.history = item.history.slice(-10);
}

function renderOtpArea(item) {
  const box = $('#otp-area');
  if (!box) return;
  if (!item.otp) {
    box.innerHTML = `<div style="font-size:12.5px;color:var(--faint);padding:4px 2px">未绑定。绑定后这里会显示每 30 秒刷新的动态验证码。</div>`;
    return;
  }
  const C = 2 * Math.PI * 9.5;
  box.innerHTML = `
    <div class="otp-box">
      <div class="otp-code" id="otp-code">------</div>
      <svg class="otp-ring" viewBox="0 0 24 24">
        <circle class="bg" cx="12" cy="12" r="9.5"></circle>
        <circle class="fg" id="otp-ring-fg" cx="12" cy="12" r="9.5" stroke-dasharray="${C}" stroke-dashoffset="0" transform="rotate(-90 12 12)"></circle>
      </svg>
      <span class="otp-hint" id="otp-left">30s</span>
      <button class="mini-btn" id="otp-copy" title="复制验证码">${ICONS.copy}</button>
    </div>`;
  $('#otp-copy').addEventListener('click', () => {
    const code = $('#otp-code').textContent.replace(/\s/g, '');
    if (code && code !== '密钥无效') copyText(code, '验证码已复制');
  });
  startOtpTicker();
}

function renderFieldRows(item, isLogin) {
  const primary = $('#fields-rows');
  const extra = $('#extra-rows');
  const rowHtml = (f, i) => `<div class="row">
      <span class="row-label">${escapeHtml(f.label)}</span>
      <input class="row-input ${f.secret ? 'mono' : ''}" data-fi="${i}"
        type="${f.secret ? 'password' : 'text'}" value="${escapeHtml(f.value)}" placeholder="点击输入" spellcheck="false" />
      <div class="row-actions">
        ${f.secret ? `<button class="mini-btn" data-peekf="${i}" title="显示/隐藏">${ICONS.eye}</button>` : ''}
        <button class="mini-btn" data-copyf="${i}" title="复制">${ICONS.copy}</button>
        <button class="mini-btn" data-delf="${i}" title="删除字段">${ICONS.x}</button>
      </div>
    </div>`;

  if (primary) {
    const hint = item.kind === 'note'
      ? ''
      : `<div style="color:var(--faint);font-size:12.5px;padding:6px 12px">还没有字段，点下方「添加」补充。</div>`;
    primary.innerHTML = item.fields.map((f, i) => rowHtml(f, i)).join('') || hint;
  }
  if (extra) {
    extra.innerHTML = isLogin
      ? (item.fields.length ? item.fields.map((f, i) => rowHtml(f, i)).join('') : '')
      : '';
  }

  const root = isLogin ? extra : primary;
  if (!root) return;

  $$('.row-input[data-fi]', root).forEach((inp) => {
    inp.addEventListener('input', () => {
      const f = item.fields[+inp.dataset.fi];
      if (!f) return;
      f.value = inp.value;
      item.updatedAt = Date.now();
      persist();
    });
  });
  $$('[data-peekf]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.peekf;
      const inp = $(`.row-input[data-fi="${i}"]`, root);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
    })
  );
  $$('[data-copyf]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const f = item.fields[+b.dataset.copyf];
      if (!f) return;
      if (f.secret) copySecret(f.value);
      else copyText(f.value, '已复制');
    })
  );
  $$('[data-delf]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const i = +b.dataset.delf;
      item.fields.splice(i, 1);
      item.updatedAt = Date.now();
      persist();
      renderDetail();
    })
  );
}

/* ---------------- 新建 ---------------- */
function addItem() {
  const card = $('#modal-card');
  card.classList.add('wide');
  card.innerHTML = `
    <h3>新建条目</h3>
    <p class="modal-sub">选择类型，字段会自动准备好</p>
    <div class="kind-grid">
      ${Object.entries(KINDS).map(([k, v]) => `
        <button class="kind" data-kind="${k}">
          ${ICONS[k] || ICONS.note}
          <span>${v.label}</span>
        </button>`).join('')}
    </div>
    <div class="modal-actions"><button class="ghost-btn" id="kind-cancel">取消</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#kind-cancel').addEventListener('click', closeModal);
  $$('.kind', card).forEach((b) =>
    b.addEventListener('click', () => {
      closeModal();
      createItem(b.dataset.kind);
    })
  );
}

function createItem(kind) {
  const item = {
    id: uid(),
    kind,
    title: '',
    username: '',
    password: '',
    url: '',
    otp: '',
    category: kind === 'card' ? 'bank' : kind === 'apikey' ? 'server' : 'web',
    fields: defaultFields(kind),
    notes: '',
    favorite: false,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  };
  state.items.unshift(item);
  state.filter = 'all';
  state.query = '';
  $('#search').value = '';
  renderFilters();
  selectItem(item.id);
  persist();
  setTimeout(() => { const t = $('#f-title'); if (t) t.focus(); }, 50);
}

$('#add-btn').addEventListener('click', addItem);

/* ---------------- 搜索 ---------------- */
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

/* ---------------- 密码体检 ---------------- */
function computeAudit() {
  const logins = activeItems().filter((i) => i.kind === 'login');
  const weak = [], reused = [], old = [], empty = [];

  const pwdMap = new Map();
  logins.forEach((i) => {
    const p = i.password;
    if (!p) {
      empty.push(i);
      return;
    }
    if (pwdStrength(p) <= 1 || p.length < 8) weak.push(i);
    if (!pwdMap.has(p)) pwdMap.set(p, []);
    pwdMap.get(p).push(i);
  });
  pwdMap.forEach((arr) => { if (arr.length > 1) reused.push(...arr); });
  activeItems().forEach((i) => {
    if (Date.now() - (i.updatedAt || 0) > OLD_DAYS * 86400000) old.push(i);
  });

  const uniq = (arr) => Array.from(new Map(arr.map((i) => [i.id, i])).values());
  const w = uniq(weak), r = uniq(reused), o = uniq(old), e = uniq(empty);

  let score = 100;
  score -= w.length * 9;
  score -= r.length * 7;
  score -= o.length * 4;
  score -= e.length * 11;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, weak: w, reused: r, old: o, empty: e, total: activeItems().length };
}

function renderAudit() {
  const a = computeAudit();
  const grade = a.score >= 90 ? '很好' : a.score >= 70 ? '还行' : a.score >= 50 ? '需要处理' : '风险较高';
  const color = a.score >= 90 ? 'var(--ok)' : a.score >= 70 ? 'var(--warn)' : 'var(--danger)';

  const group = (title, dot, arr, whyFn, emptyText) => `
    <div class="audit-group">
      <div class="audit-group-head">
        <span class="dot" style="background:${dot}"></span>${title}
        <span class="n">${arr.length} 项</span>
      </div>
      ${arr.length ? arr.map((i) => `
        <div class="audit-item" data-goto="${i.id}">
          <span style="color:var(--text)">${escapeHtml(i.title || '未命名')}</span>
          <span class="why">${whyFn(i)}</span>
        </div>`).join('') : `<div class="audit-item" style="cursor:default;color:var(--faint)">${emptyText}</div>`}
    </div>`;

  $('#detail').innerHTML = `
    <div class="detail-inner">
      <div class="view-head">
        <div>
          <h2>密码体检</h2>
          <p>全部在本机计算，密码不会离开这台电脑。</p>
        </div>
        <button class="ghost-btn" id="audit-refresh">${ICONS.refresh}重新检测</button>
      </div>

      <div class="score-wrap">
        <div class="score-num" style="color:${color}">${a.score}<small>分</small></div>
        <div class="score-txt">
          <b>${grade}</b>
          <div>共 ${a.total} 条记录，${a.weak.length + a.reused.length + a.old.length + a.empty.length} 处可改进</div>
        </div>
      </div>

      <div class="audit-list">
        ${group('弱密码', 'var(--danger)', a.weak, (i) => `强度 ${STRENGTH_LABELS[pwdStrength(i.password)] || '低'}`, '没有弱密码 ✓')}
        ${group('重复使用', 'var(--warn)', a.reused, () => '多个账号同一密码', '没有重复密码 ✓')}
        ${group('超过半年未更新', 'var(--faint)', a.old, (i) => fmtAgo(i.updatedAt), '都很新 ✓')}
        ${group('缺少密码', 'var(--danger)', a.empty, () => '密码为空', '没有缺项 ✓')}
      </div>
    </div>`;

  $('#audit-refresh').addEventListener('click', renderAudit);
  $$('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => selectItem(el.dataset.goto))
  );
}

/* ---------------- 回收站 ---------------- */
function renderTrash() {
  const list = trashedItems().sort((a, b) => b.deletedAt - a.deletedAt);
  $('#detail').innerHTML = `
    <div class="detail-inner">
      <div class="view-head">
        <div>
          <h2>回收站</h2>
          <p>删除的条目会先放这里，可以恢复。</p>
        </div>
        ${list.length ? `<button class="ghost-btn danger" id="trash-clear">${ICONS.trash}清空</button>` : ''}
      </div>
      ${list.length ? `<div class="audit-list"><div class="audit-group">
        <div class="audit-group-head"><span class="dot" style="background:var(--faint)"></span>已删除<span class="n">${list.length} 项</span></div>
        ${list.map((i) => `
          <div class="audit-item" style="cursor:default">
            <span style="color:var(--text)">${escapeHtml(i.title || '未命名')}</span>
            <span class="why">${fmtAgo(i.deletedAt)}</span>
            <button class="ghost-btn sm" data-restore="${i.id}">恢复</button>
            <button class="ghost-btn sm danger" data-purge="${i.id}">彻底删除</button>
          </div>`).join('')}
      </div></div>` : `<div class="audit-ok">回收站是空的</div>`}
    </div>`;

  $$('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => {
      const it = state.items.find((i) => i.id === b.dataset.restore);
      if (!it) return;
      it.deletedAt = null;
      persist(true);
      renderList();
      renderTrash();
      toast('已恢复', 'ok');
    })
  );
  $$('[data-purge]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '彻底删除？', desc: '此操作不可撤销，条目将被永久清除。', okText: '永久删除', danger: true });
      if (!ok) return;
      state.items = state.items.filter((i) => i.id !== b.dataset.purge);
      persist(true);
      renderList();
      renderTrash();
      toast('已永久删除');
    })
  );
  const clr = $('#trash-clear');
  if (clr) clr.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清空回收站？', desc: `${list.length} 个条目将被永久删除，不可恢复。`, okText: '清空', danger: true });
    if (!ok) return;
    state.items = state.items.filter((i) => !i.deletedAt);
    persist(true);
    renderList();
    renderTrash();
    toast('回收站已清空');
  });
}

$('#audit-btn').addEventListener('click', () => {
  state.view = state.view === 'audit' ? 'item' : 'audit';
  renderList();
  renderDetail();
});
$('#trash-btn').addEventListener('click', () => {
  state.view = state.view === 'trash' ? 'item' : 'trash';
  renderList();
  renderDetail();
});

/* ---------------- 生成器 ---------------- */
const GEN_SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*-_=+?',
};
const WORDS = ('风 云 山 海 月 星 松 竹 泉 石 舟 桥 灯 塔 鹰 鹿 鲸 燕 沙 雪 秋 春 夏 冬 晨 夜 光 影 歌 书 剑 门 窗 路 城 井 田 林 岸 潮').split(' ');

const genOpt = { mode: 'random', len: 18, lower: true, upper: true, digit: true, symbol: true, words: 4 };

function genPassword() {
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  if (genOpt.mode === 'phrase') {
    const parts = [];
    for (let i = 0; i < genOpt.words; i++) parts.push(WORDS[rnd(WORDS.length)]);
    parts.push(String(rnd(90) + 10));
    return parts.join('-');
  }
  let pool = '';
  const must = [];
  ['lower', 'upper', 'digit', 'symbol'].forEach((k) => {
    if (genOpt[k]) { pool += GEN_SETS[k]; must.push(GEN_SETS[k]); }
  });
  if (!pool) pool = GEN_SETS.lower;
  const out = must.map((s) => s[rnd(s.length)]);
  while (out.length < genOpt.len) out.push(pool[rnd(pool.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, Math.max(genOpt.len, must.length)).join('');
}

function openGenerator(onUse) {
  const card = $('#modal-card');
  const draw = () => {
    const pwd = genPassword();
    card.innerHTML = `
      <h3>密码生成器</h3>
      <p class="modal-sub">使用系统级随机源，生成后不会发送到任何地方</p>
      <div class="gen-out"><span id="gen-val">${escapeHtml(pwd)}</span>
        <button class="mini-btn" id="gen-refresh" title="重新生成">${ICONS.refresh}</button>
      </div>
      <div class="seg" style="margin-top:14px;width:fit-content">
        <button class="${genOpt.mode === 'random' ? 'on' : ''}" data-mode="random">随机字符</button>
        <button class="${genOpt.mode === 'phrase' ? 'on' : ''}" data-mode="phrase">易记短语</button>
      </div>
      ${genOpt.mode === 'random' ? `
        <div class="slider-row">
          <label>长度</label>
          <input type="range" id="gen-len" min="8" max="40" value="${genOpt.len}" />
          <b id="gen-len-v">${genOpt.len}</b>
        </div>
        <div class="opts">
          ${[['upper', '大写字母'], ['lower', '小写字母'], ['digit', '数字'], ['symbol', '符号']]
            .map(([k, label]) => `<button class="opt ${genOpt[k] ? 'on' : ''}" data-k="${k}"><span class="box"></span>${label}</button>`)
            .join('')}
        </div>` : `
        <div class="slider-row">
          <label>词数</label>
          <input type="range" id="gen-words" min="3" max="7" value="${genOpt.words}" />
          <b id="gen-words-v">${genOpt.words}</b>
        </div>
        <p style="font-size:11.5px;color:var(--faint)">形如「山-月-松-岸-42」，好记又难猜</p>`}
      <div class="modal-actions">
        <button class="ghost-btn" id="gen-copy">复制</button>
        <button class="ghost-btn" id="gen-cancel">取消</button>
        <button class="primary" style="width:auto;padding:0 18px;height:33px;margin:0" id="gen-use">使用</button>
      </div>`;

    $('#gen-refresh').addEventListener('click', draw);
    $$('[data-mode]', card).forEach((b) =>
      b.addEventListener('click', () => { genOpt.mode = b.dataset.mode; draw(); })
    );
    const lenEl = $('#gen-len');
    if (lenEl) lenEl.addEventListener('input', (e) => {
      genOpt.len = +e.target.value;
      $('#gen-len-v').textContent = genOpt.len;
      $('#gen-val').textContent = genPassword();
    });
    const wordsEl = $('#gen-words');
    if (wordsEl) wordsEl.addEventListener('input', (e) => {
      genOpt.words = +e.target.value;
      $('#gen-words-v').textContent = genOpt.words;
      $('#gen-val').textContent = genPassword();
    });
    $$('.opt', card).forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.k;
        const onCount = ['lower', 'upper', 'digit', 'symbol'].filter((x) => genOpt[x]).length;
        if (genOpt[k] && onCount === 1) return;
        genOpt[k] = !genOpt[k];
        draw();
      })
    );
    $('#gen-copy').addEventListener('click', () => copySecret($('#gen-val').textContent));
    $('#gen-cancel').addEventListener('click', closeModal);
    $('#gen-use').addEventListener('click', () => {
      const v = $('#gen-val').textContent;
      closeModal();
      onUse && onUse(v);
    });
  };
  draw();
  $('#modal').classList.remove('hidden');
}

/* ---------------- 设置 ---------------- */
$('#menu-btn').addEventListener('click', async () => {
  const card = $('#modal-card');
  card.classList.add('wide');
  let backups = [];
  try { backups = await store.listBackups(); } catch (_) {}

  const seg = (key, opts) => `<div class="seg">${opts.map(([v, label]) =>
    `<button data-pref="${key}" data-v="${v}" class="${prefs[key] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;

  card.innerHTML = `
    <h3>设置</h3>
    <p class="modal-sub">数据文件：${escapeHtml(state.meta.path || '-')}</p>

    <div class="section-label" style="margin-top:0">界面风格</div>
    <div class="theme-grid">
      ${THEMES.map((t) => `
        <button class="theme-card ${prefs.theme === t.key ? 'on' : ''}" data-theme-pick="${t.key}">
          <div class="theme-prev" style="background:${t.colors[0]}">
            <i style="background:${t.colors[1]}"></i>
            <i style="background:${t.colors[2]};opacity:.75"></i>
            <i style="background:${t.colors[3]};opacity:.5"></i>
          </div>
          <div class="theme-name">${t.name}</div>
        </button>`).join('')}
    </div>

    <div class="section-label">行为</div>
    <div class="setting-row">
      <div><div class="label">自动锁定</div><div class="desc">无操作多久后自动上锁</div></div>
      ${seg('autolock', [[1, '1 分'], [5, '5 分'], [15, '15 分'], [30, '30 分'], [0, '关闭']])}
    </div>
    <div class="setting-row">
      <div><div class="label">剪贴板自动清除</div><div class="desc">复制密码后多久清空剪贴板</div></div>
      ${seg('clipClear', [[15, '15 秒'], [30, '30 秒'], [60, '60 秒'], [0, '关闭']])}
    </div>

    <div class="section-label">数据</div>
    <div class="setting-row">
      <div><div class="label">修改主密码</div><div class="desc">会用新密码重新加密整个库</div></div>
      <button class="ghost-btn sm" id="set-pwd">修改</button>
    </div>
    <div class="setting-row">
      <div><div class="label">导出加密备份</div><div class="desc">保存到桌面，可用主密码恢复</div></div>
      <button class="ghost-btn sm" id="set-export">导出</button>
    </div>
    <div class="setting-row">
      <div><div class="label">导出 CSV</div><div class="desc" style="color:var(--warn)">明文，慎用</div></div>
      <button class="ghost-btn sm" id="set-csv">导出</button>
    </div>
    <div class="setting-row">
      <div><div class="label">从 CSV 导入</div><div class="desc">支持 Chrome、Bitwarden、1Password 等格式</div></div>
      <button class="ghost-btn sm" id="set-import">选择文件</button>
    </div>

    <div class="section-label">自动备份（${backups.length} 份）</div>
    <div class="backup-list" id="backup-list">
      ${backups.length ? backups.map((b) => `
        <div class="backup-row">
          <span>${escapeHtml(b.name.replace('vault-', '').replace('.dat', ''))} · ${(b.size / 1024).toFixed(1)} KB</span>
          <button data-restore-bk="${escapeHtml(b.name)}">恢复</button>
        </div>`).join('') : '<div style="color:var(--faint);font-size:12px;padding:8px 2px">首次保存后会自动生成</div>'}
    </div>

    <div class="modal-actions">
      <button class="ghost-btn" id="set-close">关闭</button>
    </div>`;

  $('#modal').classList.remove('hidden');
  $('#set-close').addEventListener('click', closeModal);

  $$('[data-theme-pick]', card).forEach((b) =>
    b.addEventListener('click', () => {
      applyTheme(b.dataset.themePick);
      $$('[data-theme-pick]', card).forEach((x) => x.classList.toggle('on', x === b));
    })
  );

  $$('[data-pref]', card).forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.pref;
      prefs[key] = +b.dataset.v;
      savePrefs();
      $$(`[data-pref="${key}"]`, card).forEach((x) => x.classList.toggle('on', x === b));
      if (key === 'autolock') { resetAutoLock(); toast('自动锁定已更新', 'ok'); }
    })
  );

  $('#set-pwd').addEventListener('click', openChangePassword);
  $('#set-export').addEventListener('click', async () => {
    try {
      const p = await store.exportBackup();
      toast('已导出：' + p, 'ok');
    } catch (e) { toast(String(e.message || e), 'err'); }
  });
  $('#set-csv').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '导出明文 CSV？',
      desc: 'CSV 里的密码是<strong style="color:var(--danger)">未加密的明文</strong>，任何能读到这个文件的人都能看到。仅用于迁移到别的软件，完成后请立即删除。',
      okText: '我明白，导出',
      danger: true,
    });
    if (!ok) return;
    const rows = [['name', 'url', 'username', 'password', 'category', 'notes']];
    activeItems().forEach((i) => {
      const pwd = i.kind === 'login' ? i.password : (i.fields.find((f) => f.secret) || {}).value || '';
      rows.push([i.title, i.url, i.username, pwd, i.category, i.notes]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    try {
      const p = await store.exportText('\ufeff' + csv, 'vault-plaintext.csv');
      toast('已导出：' + p, 'ok');
    } catch (e) { toast(String(e.message || e), 'err'); }
  });
  $('#set-import').addEventListener('click', () => $('#file-input').click());

  $$('#backup-list [data-restore-bk]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '从备份恢复？',
        desc: '会覆盖当前全部数据，恢复后需要用<strong>该备份创建时的主密码</strong>重新解锁。',
        okText: '恢复',
        danger: true,
      });
      if (!ok) return;
      try {
        await store.restore(b.dataset.restoreBk);
        closeModal();
        await doLock(true);
        toast('已恢复，请用该备份时的主密码解锁', 'ok');
      } catch (e) { toast(String(e.message || e), 'err'); }
    })
  );
});

function openChangePassword() {
  const card = $('#modal-card');
  card.classList.remove('wide');
  card.innerHTML = `
    <h3>修改主密码</h3>
    <p class="modal-sub">会用新密码重新加密整个数据库，旧密码立即失效</p>
    <div class="field"><input id="np1" type="password" placeholder="新主密码" /></div>
    <div class="field"><input id="np2" type="password" placeholder="再次输入新主密码" /></div>
    <p class="error" id="np-err"></p>
    <div class="modal-actions">
      <button class="ghost-btn" id="np-cancel">取消</button>
      <button class="primary" style="width:auto;padding:0 18px;height:33px;margin:0" id="np-ok">确认修改</button>
    </div>`;
  $('#modal').classList.remove('hidden');
  $('#np1').focus();
  $('#np-cancel').addEventListener('click', closeModal);
  $('#np-ok').addEventListener('click', async () => {
    const a = $('#np1').value, b = $('#np2').value;
    if (a.length < 6) return ($('#np-err').textContent = '主密码至少 6 位');
    if (a !== b) return ($('#np-err').textContent = '两次输入不一致');
    try {
      await store.changePassword(a);
      closeModal();
      toast('主密码已更新', 'ok');
    } catch (e) {
      $('#np-err').textContent = String(e.message || e);
    }
  });
}

/* ---------------- CSV 导入 ---------------- */
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  e.target.value = '';
  try {
    const rows = parseCsv(text);
    if (rows.length < 2) return toast('文件里没有可导入的数据', 'err');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
    const iName = find('name', 'title', '标题', '名称');
    const iUrl = find('url', 'website', '网址');
    const iUser = find('username', 'login', 'user', '账号', '用户名');
    const iPwd = find('password', '密码');
    const iNote = find('note', '备注', 'note');
    if (iPwd < 0 && iUser < 0) return toast('没识别出这是密码表，请检查表头', 'err');

    let count = 0;
    rows.slice(1).forEach((r) => {
      const title = (iName >= 0 ? r[iName] : '') || (iUrl >= 0 ? r[iUrl] : '') || '导入条目';
      if (!(iPwd >= 0 && r[iPwd]) && !(iUser >= 0 && r[iUser])) return;
      state.items.unshift({
        id: uid(), kind: 'login', title: title.trim(),
        username: (iUser >= 0 ? r[iUser] : '') || '',
        password: (iPwd >= 0 ? r[iPwd] : '') || '',
        url: (iUrl >= 0 ? r[iUrl] : '') || '',
        otp: '', category: 'web', fields: [],
        notes: (iNote >= 0 ? r[iNote] : '') || '',
        favorite: false, history: [],
        createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
      });
      count++;
    });
    persist(true);
    renderList();
    renderDetail();
    toast(`已导入 ${count} 条`, 'ok');
  } catch (err) {
    toast('导入失败：' + (err.message || err), 'err');
  }
});

/* ---------------- 快捷键 ---------------- */
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (state.unlocked) $('#search').focus();
    return;
  }
  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    if (state.unlocked) doLock();
    return;
  }
  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (state.unlocked) addItem();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (document.activeElement === $('#search')) {
      $('#search').value = ''; state.query = ''; renderList();
    }
  }
  if (state.unlocked && !mod && ['ArrowDown', 'ArrowUp'].includes(e.key) && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    const list = visibleItems();
    if (!list.length) return;
    const idx = list.findIndex((i) => i.id === state.selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (next !== idx) { e.preventDefault(); selectItem(list[next].id); }
  }
});

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ---------------- 启动 ---------------- */
(async function boot() {
  loadPrefs();
  try {
    state.meta = await store.status();
  } catch (e) {
    state.meta = { exists: false, path: '', backupDir: '' };
  }
  setGateMode(state.meta.exists ? 'unlock' : 'create');
  window.addEventListener('beforeunload', () => {
    if (state.unlocked && state.dirty) { try { store.save(serialize()); } catch (_) {} }
  });
  setTimeout(() => $('#pwd').focus(), 120);
})();

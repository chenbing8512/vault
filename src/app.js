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
const APP_VERSION = '1.7.3';
const DATA_VERSION = 4;
const SYNC_VERSION_KEY = 'vault.syncVersion';
const SYNC_SERVER = 'https://vault-sync.43.153.51.6.sslip.io/vault-sync';
const LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.6" /><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3" /><circle cx="12" cy="15.8" r="1.35" fill="currentColor" stroke="none" /></svg>';
let returnToSettings = false;
const syncCache = { at: 0, version: null, logs: null };   // 同步 tab 的 30s 缓存

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
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3.5 8 4.2-8 4.2-8-4.2 8-4.2Z"/><path d="m4 12.4 8 4.2 8-4.2"/><path d="m4 16.8 8 4.2 8-4.2"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.2a2 2 0 0 1 2-2h3.3l2 2.2h6.7a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2V7.2Z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M11.2 3.6H5a1.4 1.4 0 0 0-1.4 1.4v6.2a1.6 1.6 0 0 0 .47 1.13l7.4 7.4a1.6 1.6 0 0 0 2.26 0l6.2-6.2a1.6 1.6 0 0 0 0-2.26l-7.4-7.4a1.6 1.6 0 0 0-1.13-.47Z"/><circle cx="8" cy="8" r="1.3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z"/><path d="m9 12 2 2 4-4" stroke-linecap="round"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="4.2" rx="1.3"/><path d="M5 8.7v9.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.7"/><path d="M10 12.4h4"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M10 13.8a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.2 7"/><path d="M14 10.2a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.4-1.4"/></svg>',
  copyItem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 5.8A2.3 2.3 0 0 0 13.2 3.5H6.3A2.3 2.3 0 0 0 4 5.8v7a2.3 2.3 0 0 0 2.3 2.3"/></svg>',
};

/* ---------------- 全局状态 ---------------- */
const DEFAULT_VAULT = { id: 'v-self', name: '个人', color: '#6f8cff' };

const state = {
  items: [],
  vaults: [DEFAULT_VAULT],
  folders: [],
  tags: [],
  curVaultId: DEFAULT_VAULT.id,
  selectedId: null,
  filter: 'all',
  query: '',
  scope: { type: 'all', id: null },
  view: 'item',
  sort: 'recent',
  collapsed: {},
  unlocked: false,
  dirty: false,
  meta: { exists: false, path: '', backupDir: '' },
};

const prefs = { theme: 'aurora', autolock: 5, clipClear: 30, trashDays: 30, fontScale: 100, fontFamily: 'system' };

/* ---------------- 字体与大小 ---------------- */
/* 所有 font-size 都是 rem，改 html 根字号就能整体缩放。
   基准 16px × scale；布局用 px 的地方（三栏宽度、图标、头像）保持不缩放，避免撑破。 */
const FONT_SCALE_MIN = 80;
const FONT_SCALE_MAX = 140;
const FONT_SCALE_STEP = 5;

/* 字体族预设：key 存在 prefs.fontFamily 里，CSS 里用 [data-font] 匹配 */
const FONT_FAMILIES = [
  { key: 'system',  name: '系统默认', css: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif', desc: 'SF Pro + 苹方' },
  { key: 'pingfang', name: '苹方', css: '"PingFang SC", "Hiragino Sans GB", -apple-system, sans-serif', desc: 'macOS 中文更饱满' },
  { key: 'harmony', name: '鸿蒙黑体', css: '"HarmonyOS Sans SC", "MiSans", -apple-system, sans-serif', desc: '需已安装，否则回退' },
  { key: 'source',  name: '思源黑体', css: '"Source Han Sans SC", "Noto Sans CJK SC", "Source Han Sans CN", -apple-system, sans-serif', desc: '需已安装，否则回退' },
  { key: 'lxl',     name: '霞鹜文楷', css: '"LXGW WenKai", "LXGW WenKai Screen", -apple-system, sans-serif', desc: '楷体风，需已安装' },
  { key: 'mono',    name: '等宽', css: '"SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace', desc: '程序员风，密码区不变' },
  { key: 'serif',   name: '宋体/衬线', css: '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif', desc: '阅读向' },
];

function fontFamilyCss(key) {
  const f = FONT_FAMILIES.find((x) => x.key === key);
  return f ? f.css : FONT_FAMILIES[0].css;
}

function applyFont(persist = true) {
  const scale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, +prefs.fontScale || 100));
  prefs.fontScale = scale;
  const root = document.documentElement;
  root.style.fontSize = (16 * scale / 100).toFixed(2) + 'px';
  root.setAttribute('data-font', prefs.fontFamily || 'system');
  if (persist) savePrefs();
}

function setFontScale(scale, persist = true) {
  prefs.fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(scale / FONT_SCALE_STEP) * FONT_SCALE_STEP));
  applyFont(persist);
}

function stepFontScale(delta) {
  setFontScale((+prefs.fontScale || 100) + delta);
  toast('字号 ' + prefs.fontScale + '%' + (prefs.fontScale === 100 ? '' : '  ·  ⌘0 恢复'), 'ok', 1200);
}

/* ---------------- 基础工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* 家目录缩写，长路径不撑破设置面板 */
function shortPath(p) {
  if (!p) return '-';
  const m = p.match(/^\/Users\/[^/]+/) || p.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  return m ? p.replace(m[0], '~') : p;
}

/* 备份时间：同年省掉年份 */
function fmtBkTime(sec) {
  if (!sec) return '-';
  const d = new Date(sec * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()}-`;
  return `${y}${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
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
function toast(msg, kind = '', duration = 2300) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, duration);
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
  applyFont(false);
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
  if (returnToSettings) { returnToSettings = false; setTimeout(() => { if (state.unlocked) openSettings(); }, 0); }
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
  async restore(name, dir) {
    if (IS_DESKTOP) return invoke('restore_backup', { name, dir });
    throw new Error('浏览器模式不支持从备份恢复');
  },
  async deleteBackup(name, dir) {
    if (IS_DESKTOP) return invoke('delete_backup', { name, dir });
    throw new Error('浏览器模式不支持删除备份');
  },
  async backupConfig() {
    if (IS_DESKTOP) return invoke('backup_config');
    return { primary: '-', extra: null };
  },
  async setBackupDir(path) {
    if (IS_DESKTOP) return invoke('set_backup_dir', { path });
    throw new Error('浏览器模式不支持自定义备份目录');
  },
  async pickBackupDir() {
    if (IS_DESKTOP) return invoke('pick_backup_dir');
    return null;
  },
  async revealDir(path) {
    if (IS_DESKTOP) return invoke('reveal_dir', { path });
    throw new Error('浏览器模式不支持打开目录');
  },
  async probeBackups() {
    if (IS_DESKTOP) return invoke('probe_backups');
    return [];
  },
  async restoreFromPath(path) {
    if (IS_DESKTOP) return invoke('restore_from_path', { path });
    throw new Error('浏览器模式不支持恢复');
  },
  async exportText(content, filename) {
    if (IS_DESKTOP) return invoke('export_text', { content, filename });
    downloadBlob(content, filename);
    return '已下载到浏览器下载目录';
  },
  /* ---------- 云端同步 ---------- */
  _syncAcct() {
    const s = prefs.sync || {};
    return { server: s.server || '', token: s.token || '' };
  },
  async syncLogin(username, password, register) {
    if (!IS_DESKTOP) throw new Error('浏览器模式不支持同步');
    const s = prefs.sync || {};
    return invoke('sync_login', { server: s.server || '', username, password, register: !!register });
  },
  async syncVersion() { const a = this._syncAcct(); return invoke('sync_version', a); },
  async syncPush(baseVersion) { const a = this._syncAcct(); return invoke('sync_push', { ...a, baseVersion }); },
  async syncPull() { const a = this._syncAcct(); return invoke('sync_pull', a); },
  async syncDecryptBlob(blob) { return invoke('sync_decrypt_blob', { blob }); },
  async syncLogs() { const a = this._syncAcct(); return invoke('sync_logs', { ...a, limit: 20 }); },
};

/* ---------------- 同步逻辑 ---------------- */
let syncBusy = false;

function syncLocalVersion() { return +(localStorage.getItem(SYNC_VERSION_KEY) || 0); }
function setSyncLocalVersion(v) { localStorage.setItem(SYNC_VERSION_KEY, String(v)); }

function rerenderAll() { renderNav(); renderFilters(); renderList(); const cur = state.selectedId; if (cur && state.items.some((i) => i.id === cur && !i.deletedAt)) selectItem(cur); else renderDetail(); }

/** 条目级合并：两边都有按 updatedAt 取新；删除用 deletedAt 时间戳比较。 */
function mergeVault(localRaw, remoteRaw) {
  const L = localRaw || {}, R = remoteRaw || {};
  const byId = (arr) => { const m = new Map(); (arr || []).forEach((x) => x && x.id != null && m.set(String(x.id), x)); return m; };
  const stamp = (x) => Math.max(+(x.updatedAt) || 0, +(x.deletedAt) || 0, +(x.createdAt) || 0);
  const mergeArr = (a, b) => {
    const A = byId(a), B = byId(b);
    const out = new Map(A);
    B.forEach((id, rb) => {
      const la = out.get(id);
      if (!la) { out.set(id, rb); return; }
      // 远端删除晚于本地修改 → 取删除；反之保留本地
      if (rb.deletedAt && !la.deletedAt && +(rb.deletedAt) > +(la.updatedAt || 0)) { out.set(id, rb); return; }
      if (la.deletedAt && !rb.deletedAt && +(la.deletedAt) > +(rb.updatedAt || 0)) return;
      out.set(id, stamp(rb) > stamp(la) ? rb : la);
    });
    return Array.from(out.values());
  };
  // 文件夹被删：任一边没有即为删除（文件夹没有 deletedAt）
  const lf = byId(L.folders), rf = byId(R.folders);
  const folders = Array.from(lf.keys()).filter((id) => rf.has(id)).map((id) => (+((rf.get(id).updatedAt) || 0) > +(lf.get(id).updatedAt || 0) ? rf.get(id) : lf.get(id)));
  const tags = (() => {
    const m = new Map();
    [...(L.tags || []), ...(R.tags || [])].forEach((t) => { if (t && t.name && !m.has(t.name)) m.set(t.name, t); });
    return Array.from(m.values());
  })();
  return {
    version: 4,
    items: mergeArr(L.items, R.items),
    vaults: mergeArr(L.vaults, R.vaults),
    folders,
    tags,
    curVaultId: (R.curVaultId && (R.vaults || []).some((v) => v.id === R.curVaultId)) ? R.curVaultId : L.curVaultId,
    settings: {},
  };
}

/**
 * 同步主流程：
 *  1. 查云端版本
 *  2. 云端更新 → 拉取、解密、合并、落盘
 *  3. 本地有变化或合并后 → 推送
 *  4. 推送遇 409 → 重新拉取合并再推一次
 */
async function doSync(manual = false) {
  const s = prefs.sync || {};
  if (!s.token || syncBusy) return false;
  syncBusy = true;
  const label = manual ? '' : 'auto';
  try {
    if (manual) toast('正在同步…', '', 600);
    const remote = await store.syncVersion();
    const localV = syncLocalVersion();
    let merged = false;

    if (remote.exists && remote.version !== localV) {
      const pull = await store.syncPull();
      let remoteRaw;
      try { remoteRaw = JSON.parse(await store.syncDecryptBlob(pull.blob)); }
      catch (e) { throw new Error('云端数据无法用当前主密码解密。请确认两台设备使用同一主密码，或先在原设备修改为一致。'); }
      const localRaw = JSON.parse(serialize());
      const mergedRaw = mergeVault(localRaw, remoteRaw);
      const changed = JSON.stringify(mergedRaw.items) !== JSON.stringify(localRaw.items)
        || JSON.stringify(mergedRaw.folders) !== JSON.stringify(localRaw.folders)
        || JSON.stringify(mergedRaw.tags) !== JSON.stringify(localRaw.tags);
      if (changed) { loadData(mergedRaw); rerenderAll(); await persist(true); merged = true; }
      setSyncLocalVersion(remote.version);
    }

    // 本地 dirty 或刚合并过 → 推送；手动同步总是推送一次（保证云端有最新）
    const needPush = manual || merged || state.dirty || !remote.exists || (remote.version === localV && localV === 0);
    if (needPush) {
      await persist(true);
      const base = remote.exists ? remote.version : 0;
      try {
        const nv = await store.syncPush(base);
        setSyncLocalVersion(nv);
        if (manual) toast(merged ? '已合并并同步（云端 v' + nv + '）' : '已上传到云端（v' + nv + '）', 'ok', 1800);
      } catch (e) {
        if (String(e.message || e).startsWith('CONFLICT')) {
          // 409：再拉一次合并后重推
          const p2 = await store.syncPull();
          const r2 = JSON.parse(await store.syncDecryptBlob(p2.blob));
          const m2 = mergeVault(JSON.parse(serialize()), r2);
          loadData(m2); rerenderAll(); await persist(true);
          const nv = await store.syncPush(p2.version);
          setSyncLocalVersion(nv);
          if (manual) toast('云端有变化，已合并（v' + nv + '）', 'ok', 1800);
        } else throw e;
      }
    } else if (manual) {
      toast('已是最新（v' + remote.version + '）', 'ok', 1500);
    }
    return true;
  } catch (e) {
    const msg = String(e.message || e);
    if (manual) toast('同步失败：' + msg, 'err', 4000);
    else console.warn('[sync]', msg);
    return false;
  } finally {
    syncBusy = false;
    syncCache.at = 0;   // 同步过了，缓存作废
    const pane = $('#settings-pane');
    if (pane && $('#sync-status', pane) && $('#sync-logs', pane)) {
      refreshSyncStatus(pane); loadSyncLogs(pane);
    }
  }
}

/** 自动同步入口：解锁后 + 每次保存后（延迟 3s 合并连续保存） */
let autoSyncTimer = null;
function scheduleAutoSync(delay = 3000) {
  const s = prefs.sync || {};
  if (!s.token || !s.auto || !IS_DESKTOP) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => doSync(false), delay);
}

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function serialize() {
  return JSON.stringify({
    version: 4,
    items: state.items,
    vaults: state.vaults,
    folders: state.folders,
    tags: state.tags,
    curVaultId: state.curVaultId,
    settings: {},
  });
}

/* ---------------- 持久化 ---------------- */
let saveTimer = null;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    try {
      await store.save(serialize());
      state.dirty = false;
      scheduleAutoSync();
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

function migrateItems(items) {
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
      tags: Array.isArray(it.tags) ? it.tags.filter(Boolean).map(String) : [],
      vaultId: it.vaultId || DEFAULT_VAULT.id,
      folderId: it.folderId || null,
      history: Array.isArray(it.history) ? it.history : [],
      createdAt: it.createdAt || Date.now(),
      updatedAt: it.updatedAt || it.createdAt || Date.now(),
      usedAt: it.usedAt || null,
      archivedAt: it.archivedAt || null,
      deletedAt: it.deletedAt || null,
    };
  });
}

/* 旧版本数据（v1/v2）只有扁平 items，这里补出默认保险库与文件夹结构 */
function loadData(data) {
  const raw = data || {};
  state.vaults = Array.isArray(raw.vaults) && raw.vaults.length
    ? raw.vaults.map((v) => ({ id: v.id || uid(), name: v.name || '保险库', color: v.color || '#6f8cff' }))
    : [{ ...DEFAULT_VAULT }];
  const vaultIds = new Set(state.vaults.map((v) => v.id));

  state.folders = (Array.isArray(raw.folders) ? raw.folders : [])
    .filter((f) => f && f.id && f.name)
    .map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId || null,
      vaultId: vaultIds.has(f.vaultId) ? f.vaultId : state.vaults[0].id,
    }));

  state.items = migrateItems(raw.items);
  // 校正悬空的保险库 / 文件夹引用，避免迁移后条目“消失”
  const folderIds = new Set(state.folders.map((f) => f.id));
  state.items.forEach((i) => {
    if (!vaultIds.has(i.vaultId)) i.vaultId = state.vaults[0].id;
    if (i.folderId && !folderIds.has(i.folderId)) i.folderId = null;
  });

  /* 标签表（v4 新增）：name 全局唯一，color 可空表示跟随主题。
     v1~v3 数据没有这张表，从条目里把用过的标签补登记回来。 */
  const tagSeen = new Set();
  state.tags = [];
  const pushTag = (name, color) => {
    const n = normTag(name);
    if (!n || tagSeen.has(n)) return;
    tagSeen.add(n);
    state.tags.push({ name: n, color: safeColor(color) });
  };
  (Array.isArray(raw.tags) ? raw.tags : []).forEach((t) => pushTag(t && t.name, t && t.color));
  state.items.forEach((i) => (i.tags || []).forEach((t) => pushTag(t, '')));

  state.curVaultId = state.vaults.some((v) => v.id === raw.curVaultId) ? raw.curVaultId : state.vaults[0].id;
}

const activeItems = () => state.items.filter((i) => !i.deletedAt);
const trashedItems = () => state.items.filter((i) => i.deletedAt);
const archivedItems = () => state.items.filter((i) => i.archivedAt && !i.deletedAt);

/* ---------------- 组织模型 ---------------- */
function currentVault() {
  return state.vaults.find((v) => v.id === state.curVaultId) || state.vaults[0] || DEFAULT_VAULT;
}

/* 当前保险库内、未删除且未归档的条目 */
function vaultLive() {
  return activeItems().filter((i) => i.vaultId === state.curVaultId && !i.archivedAt);
}

const folderById = (id) => state.folders.find((f) => f.id === id) || null;
const childFolders = (pid) => state.folders.filter((f) => (f.parentId || null) === (pid || null) && f.vaultId === state.curVaultId);

/* 某个文件夹及其所有后代 */
function folderSubtree(id) {
  const out = new Set([id]);
  let guard = 0;
  let added = true;
  while (added && guard++ < 20) {
    added = false;
    state.folders.forEach((f) => {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); added = true; }
    });
  }
  return out;
}

function folderPath(id) {
  const parts = [];
  let cur = folderById(id);
  let guard = 0;
  while (cur && guard++ < 12) {
    parts.unshift(cur.name);
    cur = cur.parentId ? folderById(cur.parentId) : null;
  }
  return parts.join(' / ');
}

/* 条目数（含子文件夹） */
function folderCount(id) {
  const set = folderSubtree(id);
  return vaultLive().filter((i) => i.folderId && set.has(i.folderId)).length;
}

/* 从网址里取站点标识，用于同一网站多账号归组 */
function domainOf(url) {
  let s = String(url || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].split('@').pop();
  s = s.replace(/:\d+$/, '');
  return s;
}

function sameSiteItems(item) {
  const d = domainOf(item.url);
  if (!d) return [];
  return activeItems().filter(
    (i) => i.id !== item.id && !i.archivedAt && i.vaultId === item.vaultId && domainOf(i.url) === d
  );
}

/* ---------------- 标签 ---------------- */
const TAG_COLORS = ['', '#6f8cff', '#46d39a', '#f5a623', '#ff6b6b', '#c084fc', '#38bdf8'];

/* 归一：去 #、折叠空白、限 20 字 */
function normTag(v) {
  return String(v == null ? '' : v).trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ').slice(0, 20);
}
/* 只接受 #rgb / #rrggbb(aa)，挡掉注入 */
function safeColor(c) {
  const s = String(c || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ? s : '';
}
const tagRecord = (name) => state.tags.find((t) => t.name === name) || null;
const tagColorOf = (name) => { const r = tagRecord(name); return r ? r.color || '' : ''; };

/* 登记一个标签，已存在则原样返回 */
function ensureTag(name, color) {
  const n = normTag(name);
  if (!n) return null;
  let r = tagRecord(n);
  if (!r) { r = { name: n, color: safeColor(color) }; state.tags.push(r); }
  return r;
}

/* 当前库里用到该标签的条目数 */
const tagUsage = (name) => vaultLive().filter((i) => (i.tags || []).includes(name)).length;

/* 当前 scope 选中的标签（支持多选叠加，全部满足才算命中） */
function tagIdsOf(sc) {
  if (!sc || sc.type !== 'tag') return [];
  if (Array.isArray(sc.ids) && sc.ids.length) return sc.ids;
  return sc.id ? [sc.id] : [];
}

/* 点标签：普通点击=单选；⌘/Ctrl/Shift 点击=叠加或取消 */
function setTagScope(name, additive) {
  const cur = tagIdsOf(state.scope);
  let next;
  if (additive) {
    next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
  } else {
    next = cur.length === 1 && cur[0] === name ? [] : [name];
  }
  if (!next.length) { setScope('all', null); return; }
  setScope('tag', next[0], next);
}

/* 全部标签（含 0 条目的空标签），按用量降序 */
function allTags() {
  const map = new Map();
  state.tags.forEach((t) => map.set(t.name, 0));
  vaultLive().forEach((i) => (i.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count, color: tagColorOf(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

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
  // 新建时有醒目的探测区，就不重复挂链接了
  const link = $('#gate-restore');
  if (link) link.classList.toggle('hidden', isCreate);
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

/* 解锁页的「从备份恢复」：主文件被删、密码忘了、换机器都靠它 */
$('#gate-restore').addEventListener('click', async () => {
  let found = [];
  try { found = await store.probeBackups(); } catch (_) {}
  if (!found.length) {
    toast('没找到可恢复的备份。可把 vault-*.dat 放进桌面或文稿再试', 'err');
    return;
  }
  showRecoverList(found);
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
    loadData(data);
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
  state.scope = { type: 'all', id: null, ids: [] };
  state.filter = 'all';
  cleanTrashOnBoot();
  renderNav();
  renderFilters();
  renderList();
  const first = visibleItems()[0];
  if (first) selectItem(first.id);
  else renderDetail();
  resetAutoLock();
  scheduleAutoSync(1200);
  scheduleUpdateCheck();
}

/* 回收站里超过保留期的条目自动清理 */
function cleanTrashOnBoot() {
  if (!prefs.trashDays) return;
  const cutoff = Date.now() - prefs.trashDays * 86400000;
  const before = state.items.length;
  state.items = state.items.filter((i) => !(i.deletedAt && i.deletedAt < cutoff));
  if (state.items.length !== before) persist();
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
  state.vaults = [{ ...DEFAULT_VAULT }];
  state.folders = [];
  state.selectedId = null;
  state.query = '';
  state.filter = 'all';
  state.view = 'item';
  state.scope = { type: 'all', id: null, ids: [] };
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

/* ---------------- 弹出菜单 ---------------- */
function showMenu(anchor, items) {
  const pop = $('#menu-pop');
  pop.innerHTML = items.map((it, idx) => {
    if (it.sep) return '<div class="sep"></div>';
    if (it.label) return `<div class="pop-label">${escapeHtml(it.label)}</div>`;
    return `<button data-mi="${idx}" class="${it.danger ? 'danger' : ''}">
      ${it.icon || ''}<span>${escapeHtml(it.text)}</span>${it.checked ? '<span class="chk">✓</span>' : ''}
    </button>`;
  }).join('');
  pop.classList.remove('hidden');

  const r = (anchor && typeof anchor.x === 'number')
    ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
    : anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = r.left;
  let top = r.bottom + 5;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 5);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = top + 'px';

  pop.querySelectorAll('[data-mi]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMenu();
      const it = items[+b.dataset.mi];
      if (it && it.onClick) it.onClick();
    })
  );
}

function hideMenu() { $('#menu-pop').classList.add('hidden'); }
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu-pop') && !e.target.closest('[data-more]') && !e.target.closest('#vault-pick')) hideMenu();
});

/* ---------------- 侧栏导航 ---------------- */
function navItemHtml({ type, id, label, icon, count, depth = 0, more = false, hasKids = false, collapsed = false }) {
  const on = state.scope.type === type && (id ? state.scope.id === id : true);
  const pad = 8 + depth * 14;
  const tw = hasKids
    ? `<span class="tw" data-tw="${escapeHtml(id)}" title="展开/收起"></span>`
    : (depth ? '<span class="tw-ph"></span>' : '');
  return `<button class="nav-item ${on ? 'on' : ''} ${depth ? 'child' : ''} ${collapsed ? 'collapsed' : ''}"
      data-scope="${type}" ${id ? `data-sid="${escapeHtml(id)}"` : ''} style="padding-left:${pad}px">
    ${tw}${depth ? '' : (icon || '')}
    <span class="lbl">${escapeHtml(label)}</span>
    <span class="n ${more ? 'hide-on-hover' : ''}">${count == null ? '' : count}</span>
    ${more ? `<span class="row-more" data-more="${escapeHtml(id)}" data-kind="${type}">⋯</span>` : ''}
  </button>`;
}

function renderNav() {
  const v = currentVault();
  $('#vault-name').textContent = v.name;
  $('#vault-dot').style.background = v.color;

  const live = vaultLive();
  $('#nav-main').innerHTML = [
    navItemHtml({ type: 'all', label: '全部条目', icon: ICONS.layers, count: live.length }),
    navItemHtml({ type: 'fav', label: '收藏', icon: ICONS.star, count: live.filter((i) => i.favorite).length || '' }),
    navItemHtml({ type: 'recent', label: '最近使用', icon: ICONS.clock, count: '' }),
  ].join('');

  $('#nav-tools').innerHTML = [
    navItemHtml({ type: 'audit', label: '密码体检', icon: ICONS.shield, count: '' }),
    navItemHtml({ type: 'archived', label: '归档', icon: ICONS.archive, count: archivedItems().filter((i) => i.vaultId === state.curVaultId).length || '' }),
    navItemHtml({ type: 'trash', label: '回收站', icon: ICONS.trash, count: trashedItems().length || '' }),
  ].join('');

  renderFolderTree();
  renderTags();
}

function renderFolderTree() {
  const box = $('#folder-tree');
  const roots = childFolders(null);
  if (!roots.length) {
    box.innerHTML = `<button class="tag-empty tag-empty-add">还没有文件夹<br>用「＋」按项目或用途分一层</button>`;
    box.querySelector('.tag-empty-add').addEventListener('click', () => createFolder(null));
    return;
  }
  const walk = (list, depth) => list.map((f) => {
    const kids = childFolders(f.id);
    const collapsed = !!state.collapsed[f.id];
    return navItemHtml({
      type: 'folder', id: f.id, label: f.name, depth,
      count: folderCount(f.id), more: true, hasKids: kids.length > 0, collapsed,
    }) + (kids.length && !collapsed ? walk(kids, depth + 1) : '');
  }).join('');
  box.innerHTML = walk(roots, 0);
}

const TAG_SIDE_LIMIT = 14;

function tagChipHtml(t) {
  const on = tagIdsOf(state.scope).includes(t.name);
  return `<button class="tag-mini ${on ? 'on' : ''}" data-tag="${escapeHtml(t.name)}" draggable="true"
      title="⌘ 点击叠加筛选 · 拖到条目 / 文件夹上打标签 · 右键管理">
    ${t.color ? `<i class="tag-dot" style="background:${t.color}"></i>` : ''}
    <span class="tag-txt">${escapeHtml(t.name)}</span><span class="tag-n">${t.count}</span>
  </button>`;
}

function renderTags() {
  const tags = allTags();
  const box = $('#tag-list');
  if (!tags.length) {
    box.innerHTML = `<div class="tag-empty">给条目加标签，之后能跨文件夹筛</div>`;
    return;
  }
  box.innerHTML = tags.slice(0, TAG_SIDE_LIMIT).map(tagChipHtml).join('')
    + (tags.length > TAG_SIDE_LIMIT
      ? `<button class="tag-mini tag-more" data-tag-manage="1">全部 ${tags.length} 个 ›</button>`
      : '');
}

/* ---------------- 标签管理 ---------------- */
/* 改完标签后的统一刷新：侧栏 → 列表 → 详情 → 落盘 */
function tagRefresh() {
  renderNav();
  renderFilters();
  renderList();
  renderDetail();
  persist();
}

async function createTagDialog() {
  const r = await promptDialog({
    title: '新建标签',
    desc: '建好的空标签会出现在侧栏，条目详情里可以直接勾选。',
    fields: [{ key: 'name', placeholder: '例如 客户 / 运维 / 待办', value: '' }],
    okText: '创建',
  });
  if (!r) return;
  const n = normTag(r.name);
  if (!n) return;
  if (tagRecord(n)) { toast('标签「' + n + '」已存在', 'err'); return; }
  ensureTag(n);
  tagRefresh();
  toast('已新建标签「' + n + '」');
}

/* 详情页给条目挂一个标签（同时登记到标签表） */
function addTagToItem(item, raw) {
  const n = normTag(raw);
  if (!n) return false;
  item.tags = item.tags || [];
  if (!item.tags.includes(n)) {
    item.tags.push(n);
    ensureTag(n);
  }
  item.updatedAt = Date.now();
  tagRefresh();
  const t = $('#tag-input');
  if (t) t.focus();
  return true;
}

/* 重命名 / 合并共用：条目上的 from 全部换成 to */
function applyRename(from, to) {
  state.items.forEach((i) => {
    if (!Array.isArray(i.tags) || !i.tags.includes(from)) return;
    const next = i.tags.filter((t) => t !== from);
    if (!next.includes(to)) next.push(to);
    i.tags = next;
  });
  const src = tagRecord(from);
  const dst = tagRecord(to);
  if (dst) state.tags = state.tags.filter((t) => t.name !== from);
  else if (src) src.name = to;
  else ensureTag(to);
  const scIds = tagIdsOf(state.scope);
  if (scIds.includes(from)) {
    const next = Array.from(new Set(scIds.map((n) => (n === from ? to : n))));
    state.scope = { type: 'tag', id: next[0], ids: next };
  }
  tagRefresh();
}

async function renameTagDialog(name) {
  const r = await promptDialog({
    title: '重命名标签',
    desc: '所有条目上的这个标签会一起改名；若与已有标签同名则自动合并。',
    fields: [{ key: 'name', value: name, placeholder: '新名称' }],
    okText: '保存',
  });
  if (!r) return false;
  const n = normTag(r.name);
  if (!n || n === name) return false;
  const merged = !!tagRecord(n);
  applyRename(name, n);
  toast(merged ? `已合并到「${n}」` : `已改为「${n}」`);
  return true;
}

function removeTag(name) {
  state.items.forEach((i) => {
    if (Array.isArray(i.tags)) i.tags = i.tags.filter((t) => t !== name);
  });
  state.tags = state.tags.filter((t) => t.name !== name);
  const rest = tagIdsOf(state.scope).filter((n) => n !== name);
  state.scope = rest.length
    ? { type: 'tag', id: rest[0], ids: rest }
    : { type: 'all', id: null, ids: [] };
  tagRefresh();
}

async function deleteTagDialog(name) {
  const n = tagUsage(name);
  const ok = await confirmDialog({
    title: `删除标签「${name}」？`,
    desc: n ? `会从 ${n} 个条目上移除，条目本身不受影响。` : '这个标签还没挂在任何条目上。',
    okText: '删除',
    danger: true,
  });
  if (!ok) return false;
  removeTag(name);
  toast('已删除标签「' + name + '」');
  return true;
}

function cycleTagColor(name) {
  const r = ensureTag(name);
  if (!r) return;
  const idx = TAG_COLORS.indexOf(r.color || '');
  r.color = TAG_COLORS[(idx + 1) % TAG_COLORS.length];
  tagRefresh();
  toast(r.color ? '已换颜色' : '颜色跟随主题');
}

/* 把一个标签合并到另一个（菜单里选） */
function openMergeMenu(anchor, from) {
  const others = state.tags.filter((t) => t.name !== from).map((t) => t.name);
  if (!others.length) { toast('还没有其它标签可以合并', 'err'); return; }
  showMenu(anchor, [
    { label: `把「${from}」合并到` },
    ...others.map((n) => ({ text: n, onClick: () => { applyRename(from, n); toast(`已合并到「${n}」`); openTagManager(); } })),
  ]);
}

/* 标签 chip 右键菜单 */
function openTagMenu(anchor, name) {
  showMenu(anchor, [
    { label: '#' + name },
    { text: '只看这个标签', icon: ICONS.tag, onClick: () => setScope('tag', name) },
    { sep: true },
    { text: '重命名…', icon: ICONS.refresh, onClick: async () => { if (await renameTagDialog(name)) openTagMenuNeeded(); } },
    { text: '换颜色', icon: ICONS.eye, onClick: () => cycleTagColor(name) },
    { text: '管理所有标签…', icon: ICONS.layers, onClick: () => openTagManager() },
    { sep: true },
    { text: '删除标签', icon: ICONS.trash, danger: true, onClick: async () => { if (await deleteTagDialog(name)) openTagMenuNeeded(); } },
  ]);
}
function openTagMenuNeeded() {
  if (!$('#modal').classList.contains('hidden')) openTagManager();
}

/* 标签管理面板 */
function openTagManager() {
  const card = $('#modal-card');
  const prevScroll = $('#tm-list') ? $('#tm-list').scrollTop : 0;
  /* 自愈：条目上用到但没登记的标签先补登记 */
  allTags().forEach((t) => ensureTag(t.name, t.color));
  const rows = allTags();
  card.classList.add('wide');
  card.innerHTML = `
    <h3>管理标签</h3>
    <p class="modal-sub">标签跨文件夹通用，可以先建好再往条目上挂。右键侧栏标签也能直接改。</p>
    <div class="tag-mgr-add">
      <input id="tm-new" placeholder="新标签名称，回车创建" spellcheck="false" maxlength="20" />
      <button class="primary" id="tm-add" style="width:auto;padding:0 14px;height:34px;margin:0">新建</button>
    </div>
    <div class="tag-mgr-list" id="tm-list">
      ${rows.length ? rows.map((t) => `
        <div class="tag-row" data-trow="${escapeHtml(t.name)}">
          <button class="tag-swatch" data-swatch="${escapeHtml(t.name)}" title="点击换颜色"
            style="${t.color ? `background:${t.color}` : ''}"></button>
          <span class="tag-row-name">${escapeHtml(t.name)}</span>
          <span class="tag-row-n">${t.count} 条</span>
          <button class="row-act" data-trename="${escapeHtml(t.name)}">重命名</button>
          <button class="row-act" data-tmerge="${escapeHtml(t.name)}">合并</button>
          <button class="row-act danger" data-tdel="${escapeHtml(t.name)}">删除</button>
        </div>`).join('') : '<div class="tag-mgr-empty">还没有标签，上面输入框建第一个</div>'}
    </div>
    <div class="modal-actions"><button class="ghost-btn" id="tm-close">关闭</button></div>`;
  $('#modal').classList.remove('hidden');

  const list = $('#tm-list');
  if (list) list.scrollTop = prevScroll;
  const input = $('#tm-new');

  const commit = async () => {
    const n = normTag(input.value);
    if (!n) return;
    if (tagRecord(n)) { toast('标签「' + n + '」已存在', 'err'); return; }
    ensureTag(n);
    tagRefresh();
    openTagManager();
    toast('已新建标签「' + n + '」');
  };
  $('#tm-add').addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  $('#tm-close').addEventListener('click', closeModal);
  setTimeout(() => input.focus(), 60);

  $$('[data-swatch]').forEach((b) => b.addEventListener('click', () => {
    cycleTagColor(b.dataset.swatch);
    openTagManager();
  }));
  $$('[data-trename]').forEach((b) => b.addEventListener('click', async () => {
    await renameTagDialog(b.dataset.trename);
    openTagManager();
  }));
  $$('[data-tmerge]').forEach((b) => b.addEventListener('click', () => openMergeMenu(b, b.dataset.tmerge)));
  $$('[data-tdel]').forEach((b) => b.addEventListener('click', async () => {
    await deleteTagDialog(b.dataset.tdel);
    openTagManager();
  }));
}

/* ---------------- 拖拽：侧栏标签 → 条目 / 文件夹 ---------------- */
let dragTag = null;
let lastDropAt = 0;
let dropEl = null;

function clearDropMark() {
  if (dropEl) { dropEl.classList.remove('drop-ok'); dropEl = null; }
}

/* 落点：列表条目，或侧栏文件夹（含子文件夹里的条目） */
function dropTargetAt(el) {
  const itemEl = el && el.closest ? el.closest('#list .item[data-id]') : null;
  if (itemEl) return { el: itemEl, kind: 'item', id: itemEl.dataset.id };
  const fEl = el && el.closest ? el.closest('#folder-tree .nav-item[data-scope="folder"]') : null;
  if (fEl) return { el: fEl, kind: 'folder', id: fEl.dataset.sid };
  return null;
}

/* 给一批条目挂标签，返回真正新增的条数 */
function applyTagToItems(items, raw) {
  const n = normTag(raw);
  if (!n) return 0;
  ensureTag(n);
  let added = 0;
  items.forEach((i) => {
    i.tags = i.tags || [];
    if (!i.tags.includes(n)) { i.tags.push(n); i.updatedAt = Date.now(); added++; }
  });
  return added;
}

function endDragVisuals() {
  document.body.classList.remove('tag-dragging');
  $$('#tag-list .tag-mini.dragging').forEach((el) => el.classList.remove('dragging'));
  clearDropMark();
}

document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest ? e.target.closest('#tag-list [data-tag]') : null;
  if (!chip) return;
  dragTag = chip.dataset.tag;
  chip.classList.add('dragging');
  document.body.classList.add('tag-dragging');
  try {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'vault-tag:' + dragTag);
  } catch (_) {}
});

document.addEventListener('dragend', () => {
  dragTag = null;
  endDragVisuals();
});

document.addEventListener('dragover', (e) => {
  if (!dragTag) return;
  const t = dropTargetAt(e.target);
  if (!t) return;
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
  if (dropEl !== t.el) { clearDropMark(); t.el.classList.add('drop-ok'); dropEl = t.el; }
});

document.addEventListener('dragleave', (e) => {
  if (!dragTag) return;
  if (!dropTargetAt(e.target)) clearDropMark();
});

document.addEventListener('drop', (e) => {
  if (!dragTag) return;
  /* 只要在拖标签，就吃掉默认行为，免得 text/plain 被插进搜索框 */
  e.preventDefault();
  const t = dropTargetAt(e.target);
  if (!t) { dragTag = null; lastDropAt = Date.now(); endDragVisuals(); return; }
  const tag = dragTag;
  lastDropAt = Date.now();
  dragTag = null;
  endDragVisuals();

  if (t.kind === 'item') {
    const it = state.items.find((x) => x.id === t.id);
    if (!it) return;
    if ((it.tags || []).includes(tag)) { toast(`「${it.title || '未命名'}」已经有 #${tag}`); return; }
    applyTagToItems([it], tag);
    tagRefresh();
    toast(`已给「${it.title || '未命名'}」加上 #${tag}`);
    return;
  }

  const f = folderById(t.id);
  const set = folderSubtree(t.id);
  const targets = vaultLive().filter((i) => i.folderId && set.has(i.folderId));
  if (!targets.length) { toast('这个文件夹里还没有条目', 'err'); return; }
  const added = applyTagToItems(targets, tag);
  tagRefresh();
  toast(added
    ? `已给「${f ? f.name : '文件夹'}」里 ${added} 条加上 #${tag}`
    : `「${f ? f.name : '文件夹'}」里的条目都已有 #${tag}`);
});

function setScope(type, id, ids) {
  const tagIds = type === 'tag'
    ? (Array.isArray(ids) && ids.length ? ids.slice() : (id ? [id] : []))
    : [];
  state.scope = { type, id: id || tagIds[0] || null, ids: tagIds };
  state.view = (type === 'audit' || type === 'trash') ? type : 'item';
  state.selectedId = null;
  state.filter = 'all';
  hideMenu();
  renderNav();
  renderFilters();
  renderList();
  const first = visibleItems()[0];
  if (type === 'item' || type === 'all' || type === 'fav' || type === 'recent' ||
      type === 'folder' || type === 'tag' || type === 'archived') {
    if (first) { state.selectedId = first.id; renderList(); }
  }
  renderDetail();
}

/* 导航点击（事件委托） */
document.addEventListener('click', (e) => {
  const tw = e.target.closest('[data-tw]');
  if (tw) {
    e.stopPropagation();
    e.preventDefault();
    const id = tw.dataset.tw;
    state.collapsed[id] = !state.collapsed[id];
    renderFolderTree();
    return;
  }

  const tagManage = e.target.closest('[data-tag-manage]');
  if (tagManage) { openTagManager(); return; }

  const tagBtn = e.target.closest('#tag-list [data-tag]');
  if (tagBtn) {
    if (Date.now() - lastDropAt < 350) return;  // 拖拽结束后的误触
    setTagScope(tagBtn.dataset.tag, e.metaKey || e.ctrlKey || e.shiftKey);
    return;
  }

  const moreBtn = e.target.closest('[data-more]');
  if (moreBtn) {
    e.stopPropagation();
    openFolderMenu(moreBtn, moreBtn.dataset.more, moreBtn.dataset.kind);
    return;
  }

  const navBtn = e.target.closest('.nav-item[data-scope]');
  if (navBtn) {
    const type = navBtn.dataset.scope;
    const sid = navBtn.dataset.sid || null;
    setScope(type, sid);
  }
});

/* ---------------- 右键菜单 ---------------- */
document.addEventListener('contextmenu', (e) => {
  const itemEl = e.target.closest('#list .item[data-id]');
  if (itemEl) {
    e.preventDefault();
    const it = state.items.find((x) => x.id === itemEl.dataset.id);
    if (!it) return;
    selectItem(it.id);
    openItemMenu(it, e.clientX, e.clientY);
    return;
  }

  const fEl = e.target.closest('#folder-tree .nav-item[data-scope="folder"]');
  if (fEl) {
    e.preventDefault();
    openFolderMenu(fEl, fEl.dataset.sid, 'folder');
    return;
  }

  const tEl = e.target.closest('#tag-list [data-tag]');
  if (tEl) {
    e.preventDefault();
    openTagMenu(tEl, tEl.dataset.tag);
    return;
  }

  /* 输入框保留系统粘贴菜单，其它位置屏蔽 WebView 自带的 Reload 菜单 */
  if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
  hideMenu();
});

function openFolderMenu(anchor, id, kind) {
  const f = folderById(id);
  if (!f) return;
  showMenu(anchor, [
    { label: f.name },
    { text: '新建子文件夹', icon: ICONS.folder, onClick: () => createFolder(f.id) },
    { text: '重命名', onClick: () => renameFolder(f.id) },
    { text: '移动到…', onClick: () => moveFolderDialog(f.id) },
    { sep: true },
    { text: '删除文件夹', danger: true, onClick: () => deleteFolder(f.id) },
  ]);
}

/* 条目右键菜单：收藏 / 归档 / 删除 */
function openItemMenu(item, x, y) {
  const entries = [
    { label: item.title || '未命名' },
    {
      text: item.favorite ? '取消收藏' : '收藏',
      icon: item.favorite ? ICONS.starOn : ICONS.star,
      onClick: () => toggleFavorite(item),
    },
    {
      text: item.archivedAt ? '取消归档' : '归档',
      icon: ICONS.archive,
      onClick: () => toggleArchive(item),
    },
  ];

  if (item.kind === 'login') {
    entries.push({ sep: true });
    if (item.username) entries.push({ text: '复制用户名', icon: ICONS.copy, onClick: () => copyText(item.username, '用户名已复制') });
    if (item.password) entries.push({ text: '复制密码', icon: ICONS.copy, onClick: () => copySecret(item.password) });
  }

  entries.push({ sep: true });
  entries.push({ text: '移到回收站', icon: ICONS.trash, danger: true, onClick: () => deleteItem(item) });

  showMenu({ x, y }, entries);
}

function renderFilters() {
  const box = $('#filters');
  const hide = state.view === 'audit' || state.view === 'trash';
  box.classList.toggle('hidden', hide);
  if (hide) return;
  box.innerHTML = TYPES.map(
    (t) => `<button class="chip ${state.filter === t.key ? 'on' : ''}" data-filter="${t.key}">${t.label}</button>`
  ).join('');
  $$('#filters .chip').forEach((c) =>
    c.addEventListener('click', () => {
      state.filter = c.dataset.filter;
      renderFilters();
      renderList();
    })
  );
}

function scopeTitle() {
  const sc = state.scope;
  switch (sc.type) {
    case 'fav': return '收藏';
    case 'recent': return '最近使用';
    case 'folder': return folderPath(sc.id) || '文件夹';
    case 'tag': {
      const ids = tagIdsOf(sc);
      if (!ids.length) return '标签';
      if (ids.length === 1) return '#' + ids[0];
      return '#' + ids.slice(0, 2).join(' + #') + (ids.length > 2 ? ` +${ids.length - 2}` : '');
    }
    case 'archived': return '归档';
    case 'audit': return '密码体检';
    case 'trash': return '回收站';
    default: return '全部条目';
  }
}

function scopeBase() {
  const sc = state.scope;
  if (sc.type === 'folder' && sc.id) {
    const set = folderSubtree(sc.id);
    return vaultLive().filter((i) => i.folderId && set.has(i.folderId));
  }
  if (sc.type === 'tag') {
    const ids = tagIdsOf(sc);
    if (ids.length) return vaultLive().filter((i) => ids.every((n) => (i.tags || []).includes(n)));
    return vaultLive();
  }
  if (sc.type === 'recent') {
    return vaultLive().filter((i) => i.usedAt).sort((a, b) => b.usedAt - a.usedAt).slice(0, 20);
  }
  if (sc.type === 'archived') {
    return state.items.filter((i) => i.archivedAt && !i.deletedAt && i.vaultId === state.curVaultId);
  }
  return vaultLive();
}

function sortItems(list) {
  const arr = list.slice();
  if (state.scope.type === 'recent') return arr;
  if (state.sort === 'name') return arr.sort((a, b) => (a.title || '未命名').localeCompare(b.title || '未命名', 'zh'));
  if (state.sort === 'created') return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return arr.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  let list = scopeBase();
  if (state.filter === 'fav') list = list.filter((i) => i.favorite);
  else if (state.filter !== 'all') list = list.filter((i) => (i.category || 'other') === state.filter);
  if (q) {
    list = list.filter((i) =>
      [i.title, i.username, i.url, i.notes, (i.tags || []).join(' '), (i.fields || []).map((f) => f.label + ' ' + f.value).join(' ')]
        .join(' ').toLowerCase().includes(q)
    );
  }
  return sortItems(list);
}

function siteCounts() {
  const map = new Map();
  vaultLive().forEach((i) => {
    const d = domainOf(i.url);
    if (d) map.set(d, (map.get(d) || 0) + 1);
  });
  return map;
}

function renderList() {
  const list = visibleItems();
  const box = $('#list');
  const isTrash = state.view === 'trash';
  const tagIds = tagIdsOf(state.scope);
  $('#count').textContent = isTrash ? `${trashedItems().length} 条` : `${list.length} 条${state.query ? '匹配' : ''}`;
  $('#scope-title').textContent = scopeTitle();
  const clearBtn = $('#scope-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', tagIds.length < 2);

  if (isTrash) {
    box.innerHTML = `<div class="empty-list">回收站是独立视图<br><span style="opacity:.7">已删除的条目和恢复操作都在右侧</span></div>`;
    return;
  }

  if (!list.length) {
    const empty = state.query ? '没有匹配的条目' :
      state.scope.type === 'archived' ? '归档是空的<br><span style="opacity:.7">归档只隐藏条目，不会删除</span>' :
      state.scope.type === 'folder' ? '这个文件夹还是空的<br><span style="opacity:.7">在条目详情里选「移动到」就能放进来</span>' :
      state.scope.type === 'tag' ? (tagIds.length > 1
        ? '没有同时满足这些标签的条目<br><span style="opacity:.7">用 ⌘ 点标签可以减掉一个条件</span>'
        : '这个标签下还没有条目<br><span style="opacity:.7">把侧栏标签拖到条目上就能挂上</span>') :
      '还没有任何记录<br>点左下角「新建条目」开始';
    box.innerHTML = `<div class="empty-list">${empty}</div>`;
    return;
  }

  const dom = siteCounts();
  const showGroup = state.sort === 'name';
  let lastChar = '';

  box.innerHTML = list.map((i) => {
    const av = avatarOf(i.title || '?');
    let sub = i.kind === 'login' ? (i.username || i.url || '—') : (KINDS[i.kind] ? KINDS[i.kind].label : '');
    if (state.scope.type === 'recent' && i.usedAt) sub = `${sub} · ${fmtAgo(i.usedAt)}用过`;
    const d = domainOf(i.url);
    const nSame = d ? dom.get(d) || 0 : 0;
    let sep = '';
    if (showGroup) {
      const ch = firstChar(i.title || '未命名');
      if (ch !== lastChar) { lastChar = ch; sep = `<div class="list-sep">${escapeHtml(ch)}</div>`; }
    }
    const tagDots = (i.tags || []).length
      ? `<span class="tag-dots" title="${escapeHtml(i.tags.join(' · '))}">${i.tags.slice(0, 3).map((t) => {
          const c = tagColorOf(t);
          return `<i${c ? ` style="background:${c}"` : ''}></i>`;
        }).join('')}${i.tags.length > 3 ? `<b>+${i.tags.length - 3}</b>` : ''}</span>`
      : '';
    return sep + `<div class="item ${i.id === state.selectedId && state.view === 'item' ? 'active' : ''}" data-id="${i.id}">
      <div class="avatar" style="background:${av.bg}">${escapeHtml(av.ch)}</div>
      <div class="item-body">
        <div class="item-title">${escapeHtml(i.title || '未命名')}</div>
        <div class="item-sub">${escapeHtml(sub)}</div>
      </div>
      ${tagDots}
      ${nSame > 1 ? `<span class="badge-multi" title="这个网站共 ${nSame} 个账号">${nSame}</span>` : ''}
      ${i.archivedAt ? '<span class="badge-arch">归档</span>' : ''}
      ${i.otp ? '<span class="badge-otp">2FA</span>' : ''}
      ${i.favorite ? '<span class="star">★</span>' : ''}
    </div>`;
  }).join('');
  $$('#list .item').forEach((el) => el.addEventListener('click', () => selectItem(el.dataset.id)));
}

function firstChar(t) {
  const c = String(t).trim()[0] || '#';
  return /[a-zA-Z]/.test(c) ? c.toUpperCase() : /[0-9]/.test(c) ? '0-9' : '其 他';
}

function selectItem(id) {
  const it = state.items.find((x) => x.id === id);
  if (it) { it.usedAt = Date.now(); persist(); }
  state.view = 'item';
  state.selectedId = id;
  renderList();
  renderDetail();
}

/* ---------------- 文件夹操作 ---------------- */
function createFolder(parentId) {
  promptDialog({
    title: parentId ? '新建子文件夹' : '新建文件夹',
    desc: parentId ? `会建在「${folderPath(parentId)}」下面` : '按项目、用途或客户分一层，条目可以移动到文件夹里',
    fields: [{ key: 'name', placeholder: '文件夹名称' }],
    okText: '创建',
  }).then((r) => {
    if (!r || !r.name.trim()) return;
    const f = { id: uid(), name: r.name.trim(), parentId: parentId || null, vaultId: state.curVaultId };
    state.folders.push(f);
    persist();
    state.collapsed[parentId] = false;
    renderNav();
    setScope('folder', f.id);
    toast('文件夹已创建', 'ok');
  });
}

function renameFolder(id) {
  const f = folderById(id);
  if (!f) return;
  promptDialog({ title: '重命名文件夹', fields: [{ key: 'name', value: f.name }], okText: '保存' }).then((r) => {
    if (!r || !r.name.trim()) return;
    f.name = r.name.trim();
    persist();
    renderNav();
    renderList();
  });
}

function moveFolderDialog(id) {
  const f = folderById(id);
  if (!f) return;
  const bad = folderSubtree(id);
  const options = state.folders.filter((x) => x.vaultId === f.vaultId && !bad.has(x.id));
  const card = $('#modal-card');
  card.classList.remove('wide');
  card.innerHTML = `
    <h3>移动文件夹</h3>
    <p class="modal-sub">把「${escapeHtml(f.name)}」移到别的位置</p>
    <div class="folder-pick">
      <button class="folder-opt ${!f.parentId ? 'on' : ''}" data-parent="">（顶层）</button>
      ${options.map((o) => `<button class="folder-opt ${f.parentId === o.id ? 'on' : ''}" data-parent="${o.id}">${escapeHtml(folderPath(o.id))}</button>`).join('')}
    </div>
    <div class="modal-actions"><button class="ghost-btn" id="fp-cancel">取消</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#fp-cancel').addEventListener('click', closeModal);
  $$('.folder-opt', card).forEach((b) =>
    b.addEventListener('click', () => {
      f.parentId = b.dataset.parent || null;
      persist();
      closeModal();
      renderNav();
      renderList();
      toast('已移动', 'ok');
    })
  );
}

async function deleteFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const set = folderSubtree(id);
  const subs = Array.from(set).filter((x) => x !== id);
  const affected = vaultLive().filter((i) => i.folderId && set.has(i.folderId));
  const ok = await confirmDialog({
    title: '删除文件夹？',
    desc: `「${escapeHtml(f.name)}」${subs.length ? `及其 ${subs.length} 个子文件夹` : ''}会被删除${affected.length ? `，里面的 ${affected.length} 个条目会退回「未分类」（不会被删除）` : ''}。`,
    okText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.items.forEach((i) => { if (i.folderId && set.has(i.folderId)) i.folderId = null; });
  state.folders = state.folders.filter((x) => !set.has(x.id));
  if (state.scope.type === 'folder' && set.has(state.scope.id)) state.scope = { type: 'all', id: null };
  persist();
  renderNav();
  renderList();
  renderDetail();
  toast('文件夹已删除，条目已保留');
}

/* ---------------- 保险库操作 ---------------- */
$('#vault-pick').addEventListener('click', (e) => {
  e.stopPropagation();
  const items = state.vaults.map((v, idx) => ({
    text: `${v.name}（${activeItems().filter((i) => i.vaultId === v.id && !i.archivedAt).length}）`,
    checked: v.id === state.curVaultId,
    icon: `<span class="vdot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${v.color}"></span>`,
    onClick: () => switchVault(v.id),
  }));
  items.push({ sep: true });
  items.push({ text: '新建保险库…', icon: ICONS.plus, onClick: () => createVault() });
  if (state.vaults.length > 1) {
    items.push({ text: '管理当前保险库…', onClick: () => manageVault(currentVault().id) });
  }
  showMenu($('#vault-pick'), items);
});

function switchVault(id) {
  state.curVaultId = id;
  state.scope = { type: 'all', id: null };
  state.view = 'item';
  state.selectedId = null;
  state.filter = 'all';
  persist();
  renderNav();
  renderFilters();
  renderList();
  renderDetail();
}

function createVault() {
  promptDialog({
    title: '新建保险库',
    desc: '保险库之间彼此独立，适合把「个人」「工作」「客户」分开，避免在列表里混在一起。',
    fields: [{ key: 'name', placeholder: '例如 工作' }],
    okText: '创建',
  }).then((r) => {
    if (!r || !r.name.trim()) return;
    const palette = ['#6f8cff', '#35d39b', '#fb923c', '#f472b6', '#a78bfa', '#38bdf8'];
    const v = { id: uid(), name: r.name.trim(), color: palette[state.vaults.length % palette.length] };
    state.vaults.push(v);
    persist();
    switchVault(v.id);
    toast('保险库已创建', 'ok');
  });
}

function manageVault(id) {
  const v = state.vaults.find((x) => x.id === id);
  if (!v) return;
  showMenu($('#vault-pick'), [
    { label: v.name },
    { text: '重命名', onClick: () => renameVault(id) },
    { text: '换个颜色', onClick: () => cycleVaultColor(id) },
    { sep: true },
    { text: '删除这个保险库', danger: true, onClick: () => deleteVault(id) },
  ]);
}

function renameVault(id) {
  const v = state.vaults.find((x) => x.id === id);
  if (!v) return;
  promptDialog({ title: '重命名保险库', fields: [{ key: 'name', value: v.name }], okText: '保存' }).then((r) => {
    if (!r || !r.name.trim()) return;
    v.name = r.name.trim();
    persist();
    renderNav();
  });
}

function cycleVaultColor(id) {
  const v = state.vaults.find((x) => x.id === id);
  if (!v) return;
  const palette = ['#6f8cff', '#35d39b', '#fb923c', '#f472b6', '#a78bfa', '#38bdf8', '#eab308', '#f87171'];
  const i = palette.indexOf(v.color);
  v.color = palette[(i + 1) % palette.length];
  persist();
  renderNav();
}

async function deleteVault(id) {
  if (state.vaults.length <= 1) return toast('至少要保留一个保险库', 'err');
  const v = state.vaults.find((x) => x.id === id);
  const count = state.items.filter((i) => i.vaultId === id && !i.deletedAt).length;
  const ok = await confirmDialog({
    title: `删除「${escapeHtml(v.name)}」？`,
    desc: count ? `里面还有 ${count} 个条目，删除后这些条目会一起进回收站，可以恢复。` : '这个保险库是空的。',
    okText: '删除',
    danger: true,
  });
  if (!ok) return;
  state.items.forEach((i) => { if (i.vaultId === id) i.deletedAt = Date.now(); });
  state.folders = state.folders.filter((f) => f.vaultId !== id);
  state.vaults = state.vaults.filter((x) => x.id !== id);
  persist();
  switchVault(state.vaults[0].id);
  toast('保险库已删除，条目在回收站');
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
  const vault = state.vaults.find((v) => v.id === item.vaultId) || currentVault();
  const same = sameSiteItems(item);
  const tags = item.tags || [];
  if (item.archivedAt) metaBits.push('<span>已归档</span>');

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
          <button class="ghost-btn icon-only" id="f-dup" title="复制成新条目（适合同站点第二个账号）">${ICONS.copyItem}</button>
          <button class="ghost-btn icon-only ${item.archivedAt ? 'active-tool' : ''}" id="f-arch" title="${item.archivedAt ? '取消归档' : '归档（从列表收起）'}">${ICONS.archive}</button>
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
          <div class="row static">
            <span class="row-label">网址</span>
            <input class="row-input" id="f-url" value="${escapeHtml(item.url)}" placeholder="https://" spellcheck="false" />
            <div class="row-actions always">
              <button class="mini-btn" id="open-url" title="在浏览器打开">${ICONS.link}</button>
              <button class="mini-btn" id="cp-url" title="复制">${ICONS.copy}</button>
            </div>
          </div>
        </div>
      ` : `
        <div class="section-label">${kind.label}信息</div>
        <div class="rows" id="fields-rows"></div>
      `}

      <div class="section-label">位置</div>
      <div class="loc-grid">
        <button class="loc-chip" id="pick-vault" title="切换到别的保险库">
          <span class="vdot" style="background:${vault.color}"></span>${escapeHtml(vault.name)}
        </button>
        <button class="loc-chip" id="pick-folder" title="移动到文件夹">
          ${ICONS.folder}${item.folderId ? escapeHtml(folderPath(item.folderId)) : '未分类'}
        </button>
      </div>

      <div class="section-label">标签</div>
      <div class="tag-editor" id="tag-editor">
        ${tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}<button data-rmtag="${escapeHtml(t)}" title="移除">${ICONS.x}</button></span>`).join('')}
        <input class="tag-input" id="tag-input" placeholder="${tags.length ? '再加一个…' : '输入标签后回车'}" spellcheck="false" />
      </div>
      <div class="tag-suggest hidden" id="tag-suggest"></div>

      <div class="section-label">分类</div>
      <div class="type-picker" style="padding-left:2px">
        ${TYPES.filter((t) => t.key !== 'all' && t.key !== 'fav')
          .map((t) => `<button class="tp ${(item.category || 'other') === t.key ? 'on' : ''}" data-cat="${t.key}">${t.label}</button>`)
          .join('')}
      </div>

      ${isLogin ? `
        <div class="section-label">同一网站的其它账号 <button id="add-same">+ 添加一个</button></div>
        <div class="related">
          ${same.length ? same.map((x) => `<div class="related-item" data-rel="${x.id}">
            <span class="ri-av" style="background:${avatarOf(x.title || '?').bg}">${escapeHtml(avatarOf(x.title || '?').ch)}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.title || '未命名')}</span>
            <span class="ri-u">${escapeHtml(x.username || '无账号')}</span>
          </div>`).join('') : '<div class="related-empty">还没有。同一网站要多开账号时点右上角复制图标，或点这里新建。</div>'}
        </div>
      ` : ''}

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
    $('#open-url').addEventListener('click', async () => {
      const raw = (item.url || '').trim();
      if (!raw) return toast('这条还没有填网址', 'err');
      const full = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      try {
        if (IS_DESKTOP) await invoke('open_url', { url: full });
        else window.open(full, '_blank', 'noopener');
      } catch (e) {
        toast(String(e && e.message ? e.message : e), 'err');
      }
    });
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

  /* 位置：保险库 */
  $('#pick-vault').addEventListener('click', (e) => {
    e.stopPropagation();
    showMenu($('#pick-vault'), [
      { label: '所在保险库' },
      ...state.vaults.map((v) => ({
        text: v.name,
        checked: v.id === item.vaultId,
        icon: `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${v.color}"></span>`,
        onClick: () => {
          if (v.id === item.vaultId) return;
          const target = v;
          item.vaultId = target.id;
          item.folderId = null;
          touch();
          persist();
          toast('已移到「' + target.name + '」', 'ok');
          renderNav();
          renderList();
          renderDetail();
        },
      })),
    ]);
  });

  /* 位置：文件夹 */
  $('#pick-folder').addEventListener('click', (e) => {
    e.stopPropagation();
    const list = state.folders.filter((f) => f.vaultId === item.vaultId);
    const entries = [{ text: '未分类', checked: !item.folderId, onClick: () => setItemFolder(item, null) }];
    if (list.length) entries.push({ sep: true });
    list.forEach((f) => entries.push({
      text: folderPath(f.id),
      checked: item.folderId === f.id,
      onClick: () => setItemFolder(item, f.id),
    }));
    entries.push({ sep: true });
    entries.push({ text: '新建文件夹…', icon: ICONS.plus, onClick: () => createFolder(item.folderId) });
    showMenu($('#pick-folder'), entries);
  });

  /* 标签：候选下拉 + 回车添加 + 点 × 删除 */
  const tagInput = $('#tag-input');
  const tagSuggest = $('#tag-suggest');
  if (tagInput) {
    const showSuggest = () => {
      if (!tagSuggest) return;
      const q = normTag(tagInput.value).toLowerCase();
      const cands = allTags()
        .map((t) => t.name)
        .filter((n) => !(item.tags || []).includes(n) && (!q || n.toLowerCase().includes(q)))
        .slice(0, 10);
      if (!cands.length) { tagSuggest.classList.add('hidden'); return; }
      tagSuggest.innerHTML = cands.map((n) =>
        `<button class="tag-sug" data-tag-add="${escapeHtml(n)}">${ICONS.tag}<span>${escapeHtml(n)}</span></button>`
      ).join('');
      tagSuggest.classList.remove('hidden');
    };
    tagInput.addEventListener('focus', showSuggest);
    tagInput.addEventListener('input', showSuggest);
    tagInput.addEventListener('blur', () => setTimeout(() => tagSuggest && tagSuggest.classList.add('hidden'), 140));
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagToItem(item, tagInput.value);
      } else if (e.key === 'Escape') {
        if (tagSuggest) tagSuggest.classList.add('hidden');
      } else if (e.key === 'Backspace' && !tagInput.value && (item.tags || []).length) {
        item.tags.pop();
        touch();
        tagRefresh();
      }
    });
    if (tagSuggest) {
      /* 用 mousedown，赶在 blur 之前 */
      tagSuggest.addEventListener('mousedown', (e) => {
        const b = e.target.closest('[data-tag-add]');
        if (!b) return;
        e.preventDefault();
        addTagToItem(item, b.dataset.tagAdd);
      });
    }
  }
  $$('[data-rmtag]').forEach((b) =>
    b.addEventListener('click', () => {
      item.tags = (item.tags || []).filter((t) => t !== b.dataset.rmtag);
      touch();
      tagRefresh();
    })
  );

  /* 同站点账号 / 复制 / 归档 */
  const addSame = $('#add-same');
  if (addSame) addSame.addEventListener('click', () => duplicateItem(item, true));
  $$('[data-rel]').forEach((el) => el.addEventListener('click', () => selectItem(el.dataset.rel)));

  $('#f-dup').addEventListener('click', () => duplicateItem(item));
  $('#f-arch').addEventListener('click', () => toggleArchive(item));

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

  $('#f-del').addEventListener('click', () => deleteItem(item));

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

function setItemFolder(item, folderId) {
  item.folderId = folderId || null;
  item.updatedAt = Date.now();
  persist();
  renderNav();
  renderList();
  renderDetail();
  toast(folderId ? '已移到「' + folderPath(folderId) + '」' : '已移出文件夹', 'ok');
}

/* 复制条目：asNewAccount=true 时生成同站点的空白新账号 */
function duplicateItem(item, asNewAccount) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid();
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.usedAt = null;
  copy.deletedAt = null;
  copy.archivedAt = null;
  copy.favorite = false;
  copy.history = [];

  const base = (item.title || '未命名').replace(/\s*\(\d+\)$/, '').replace(/\s*副本$/, '');
  if (asNewAccount) {
    const used = new Set([item.title].concat(sameSiteItems(item).map((s) => s.title)));
    let n = 2;
    while (used.has(base + ' (' + n + ')')) n++;
    copy.title = base + ' (' + n + ')';
    copy.username = '';
    copy.password = '';
    copy.otp = '';
    copy.notes = '';
    copy.fields = (copy.fields || []).map((f) => ({ ...f, value: '' }));
  } else {
    copy.title = base + ' 副本';
  }

  state.items.unshift(copy);
  persist();
  if (state.scope.type === 'archived') state.scope = { type: 'all', id: null };
  renderNav();
  selectItem(copy.id);
  setTimeout(() => {
    const t = asNewAccount ? $('#f-user') : $('#f-title');
    if (t) { t.focus(); if (asNewAccount) t.select(); }
  }, 60);
  toast(asNewAccount ? '已为同一网站新建账号，填上用户名即可' : '已复制条目', 'ok');
}

function toggleFavorite(item) {
  item.favorite = !item.favorite;
  item.updatedAt = Date.now();
  persist();
  renderList();
  renderDetail();
  toast(item.favorite ? '已收藏' : '已取消收藏', 'ok');
}

async function deleteItem(item) {
  const ok = await confirmDialog({
    title: '移到回收站？',
    desc: `「${escapeHtml(item.title || '未命名')}」会被移到回收站，可以随时恢复。`,
    okText: '移到回收站',
    danger: true,
  });
  if (!ok) return;
  item.deletedAt = Date.now();
  item.updatedAt = Date.now();
  persist(true);
  const next = visibleItems()[0];
  state.selectedId = next ? next.id : null;
  renderNav();
  renderList();
  renderDetail();
  toast('已移到回收站');
}

function toggleArchive(item) {
  item.archivedAt = item.archivedAt ? null : Date.now();
  item.updatedAt = Date.now();
  persist();
  if (item.archivedAt) {
    toast('已归档，不再占用列表');
    const next = visibleItems()[0];
    state.selectedId = next ? next.id : null;
  } else {
    toast('已取消归档', 'ok');
  }
  renderNav();
  renderList();
  renderDetail();
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
    box.innerHTML = `<div style="font-size:13.5px;color:var(--muted);padding:4px 2px;line-height:1.7">未绑定。绑定后这里会显示每 30 秒刷新的动态验证码。</div>`;
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
      : `<div style="color:var(--muted);font-size:13.5px;padding:6px 12px">还没有字段，点下方「添加」补充。</div>`;
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
  const sc = state.scope;
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
    tags: sc.type === 'tag' && sc.id ? [sc.id] : [],
    vaultId: state.curVaultId,
    folderId: sc.type === 'folder' ? sc.id : null,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    usedAt: null,
    archivedAt: null,
    deletedAt: null,
  };
  state.items.unshift(item);
  if (state.scope.type === 'archived' || state.scope.type === 'recent') {
    state.scope = { type: 'all', id: null };
  }
  state.filter = 'all';
  state.query = '';
  $('#search').value = '';
  renderNav();
  renderFilters();
  renderList();
  selectItem(item.id);
  persist();
  setTimeout(() => { const t = $('#f-title'); if (t) t.focus(); }, 50);
}

$('#add-btn').addEventListener('click', addItem);

/* 列表头「✕」：清掉多标签叠加条件 */
$('#scope-clear').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.unlocked) setScope('all', null);
});

/* 侧栏「文件夹」标题右侧的 ＋ */
$('#add-folder').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.unlocked) createFolder(null);
});

/* 侧栏「标签」标题右侧的 ＋ / ⋯ */
$('#add-tag').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.unlocked) createTagDialog();
});
$('#manage-tags').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.unlocked) openTagManager();
});

/* ---------------- 搜索 ---------------- */
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

/* ---------------- 密码体检 ---------------- */
const COMMON_PW = [
  '123456', '12345678', '123456789', 'password', 'qwerty', 'abc123', '111111',
  '123123', 'admin', '888888', '000000', 'iloveyou', 'wang123', 'a123456',
  'qwerty123', '1qaz2wsx', 'zxcvbnm', '5201314', 'woaini', 'letmein',
];

/* 离线判断一个密码为什么弱，返回原因标签 */
function weakReasons(item) {
  const p = item.password || '';
  const out = [];
  const lower = p.toLowerCase();
  if (p.length < 8) out.push('太短');
  if (/^\d+$/.test(p)) out.push('纯数字');
  if (COMMON_PW.includes(lower)) out.push('常见密码');
  if (/^[a-z]+$/i.test(p) && p.length < 10) out.push('纯字母');
  if (/(012|123|234|345|456|567|678|789|890){2,}/.test(p)) out.push('连续数字');
  if (/(.)\1{2,}/.test(p)) out.push('重复字符');
  const host = domainOf(item.url).split('.')[0];
  if (host && host.length > 2 && lower.includes(host)) out.push('含站点名');
  const user = String(item.username || '').toLowerCase().split('@')[0];
  if (user && user.length > 2 && lower.includes(user)) out.push('含用户名');
  if (!out.length && pwdStrength(p) <= 1) out.push('强度偏低');
  return out;
}

function computeAudit() {
  const scopeItems = vaultLive();
  const logins = scopeItems.filter((i) => i.kind === 'login');
  const weak = [], reused = [], old = [], empty = [];

  const pwdMap = new Map();
  logins.forEach((i) => {
    const p = i.password;
    if (!p) {
      empty.push(i);
      return;
    }
    if (weakReasons(i).length) weak.push(i);
    if (!pwdMap.has(p)) pwdMap.set(p, []);
    pwdMap.get(p).push(i);
  });
  pwdMap.forEach((arr) => { if (arr.length > 1) reused.push(...arr); });
  logins.forEach((i) => {
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

  return { score, weak: w, reused: r, old: o, empty: e, total: scopeItems.length };
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
          <p>只统计当前保险库「${escapeHtml(currentVault().name)}」，全部在本机计算。</p>
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
        ${group('弱密码', 'var(--danger)', a.weak, (i) => escapeHtml(weakReasons(i).join('、') || '强度低'), '没有弱密码 ✓')}
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
          <p>删除的条目会先放这里${prefs.trashDays ? `，超过 ${prefs.trashDays} 天自动清掉` : ''}。所有保险库共用。</p>
        </div>
        ${list.length ? `<button class="ghost-btn danger" id="trash-clear">${ICONS.trash}清空</button>` : ''}
      </div>
      ${list.length ? `<div class="audit-list"><div class="audit-group">
        <div class="audit-group-head"><span class="dot" style="background:var(--faint)"></span>已删除<span class="n">${list.length} 项</span></div>
        ${list.map((i) => `
          <div class="audit-item" style="cursor:default">
            <span style="color:var(--text)">${escapeHtml(i.title || '未命名')}</span>
            <span class="badge-arch">${escapeHtml((state.vaults.find((v) => v.id === i.vaultId) || {}).name || '已删库')}</span>
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
      if (!state.vaults.some((v) => v.id === it.vaultId)) it.vaultId = state.curVaultId;
      persist(true);
      renderNav();
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
      renderNav();
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
    renderNav();
    renderList();
    renderTrash();
    toast('回收站已清空');
  });
}

$('#sort-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const opts = [
    { key: 'recent', text: '最近修改' },
    { key: 'name', text: '名称 A-Z' },
    { key: 'created', text: '添加时间' },
  ];
  showMenu($('#sort-btn'), [
    { label: '排序方式' },
    ...opts.map((o) => ({
      text: o.text,
      checked: state.sort === o.key,
      onClick: () => { state.sort = o.key; renderList(); },
    })),
  ]);
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
/* 分类分页：左侧菜单 + 右侧内容，顶部「← 返回」回主界面。 */
const SET_SECTIONS = [
  { key: 'appearance', name: '外观', desc: '主题、字号、字体' },
  { key: 'behavior',   name: '行为', desc: '锁定、剪贴板、回收站' },
  { key: 'sync',       name: '同步', desc: '多台设备保持一致' },
  { key: 'backup',     name: '备份', desc: '本地自动备份' },
  { key: 'data',       name: '数据', desc: '主密码、导入导出' },
  { key: 'about',      name: '关于', desc: '版本与更新' },
];
let settingsSection = 'appearance';

function openSettings(section) {
  settingsSection = section || settingsSection || 'appearance';
  renderSettings();
}

function closeSettings() {
  $('#settings-view').classList.add('hidden');
  resetAutoLock();
}

function renderSettings() {
  const view = $('#settings-view');
  const hasToken = !!(prefs.sync && prefs.sync.token);
  const syncAuto = !!(prefs.sync && prefs.sync.auto);
  view.innerHTML = `
    <div class="settings-shell">
      <header class="settings-head">
        <button class="icon-btn settings-back" id="set-back" title="返回主界面">${ICON_BACK}</button>
        <h3>设置</h3>
        <span class="settings-ver">v${APP_VERSION}</span>
      </header>
      <div class="settings-body">
        <nav class="settings-nav">
          ${SET_SECTIONS.map((s) => `
            <button class="settings-nav-item ${settingsSection === s.key ? 'on' : ''}" data-sec="${s.key}">
              <span class="nm">${s.name}</span>
              <span class="ds">${s.key === 'sync' ? (hasToken ? (syncAuto ? '已登录 · 自动' : '已登录 · 手动') : '未登录') : s.desc}</span>
            </button>`).join('')}
        </nav>
        <div class="settings-pane" id="settings-pane"></div>
      </div>
    </div>`;
  view.classList.remove('hidden');
  $('#set-back').addEventListener('click', closeSettings);
  $$('[data-sec]', view).forEach((b) =>
    b.addEventListener('click', () => { settingsSection = b.dataset.sec; renderSettings(); })
  );
  view.onkeydown = (e) => { if (e.key === 'Escape') closeSettings(); };
  const pane = $('#settings-pane');
  ({ appearance: renderSetAppearance, behavior: renderSetBehavior, sync: renderSetSync,
     backup: renderSetBackup, data: renderSetData, about: renderSetAbout })[settingsSection](pane);
}

const ICON_BACK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
$('#menu-btn').addEventListener('click', () => openSettings());

const seg = (key, opts) => `<div class="seg">${opts.map(([v, label]) =>
  `<button data-pref="${key}" data-v="${v}" class="${+prefs[key] === +v ? 'on' : ''}">${label}</button>`).join('')}</div>`;

function bindSeg(pane) {
  $$('[data-pref]', pane).forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.pref;
      prefs[key] = +b.dataset.v;
      savePrefs();
      $$(`[data-pref="${key}"]`, pane).forEach((x) => x.classList.toggle('on', x === b));
      if (key === 'autolock') { resetAutoLock(); toast('自动锁定已更新', 'ok', 1200); }
    })
  );
}

/* ---------- 外观 ---------- */
function renderSetAppearance(pane) {
  pane.innerHTML = `
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

    <div class="section-label">字体与大小</div>
    <div class="font-row">
      <div class="font-row-txt">
        <div class="label">界面字号</div>
        <div class="desc">⌘ + / ⌘ − 调整，⌘ 0 复位</div>
      </div>
      <div class="font-scale">
        <button class="ghost-btn sm" id="font-minus" title="缩小">−</button>
        <span class="font-scale-val" id="font-scale-val">${prefs.fontScale}%</span>
        <button class="ghost-btn sm" id="font-plus" title="放大">＋</button>
      </div>
    </div>
    <div class="font-presets" id="font-presets">
      ${[85, 100, 110, 125, 140].map((v) =>
        `<button class="font-preset ${+prefs.fontScale === v ? 'on' : ''}" data-fs="${v}">${v}%</button>`).join('')}
    </div>
    <div class="setting-row">
      <div><div class="label">界面字体</div><div class="desc">未安装的字体会自动回退到系统默认</div></div>
      <select id="font-family" class="font-select">
        ${FONT_FAMILIES.map((f) =>
          `<option value="${f.key}" ${prefs.fontFamily === f.key ? 'selected' : ''}>${f.name}</option>`).join('')}
      </select>
    </div>
    <div class="font-sample" id="font-sample">Vault 字体预览 · Aa Bb 123 · 春眠不觉晓，处处闻啼鸟。</div>`;

  $$('[data-theme-pick]', pane).forEach((b) =>
    b.addEventListener('click', () => {
      applyTheme(b.dataset.themePick);
      $$('[data-theme-pick]', pane).forEach((x) => x.classList.toggle('on', x === b));
    })
  );
  const paintFontUI = () => {
    $('#font-scale-val', pane).textContent = prefs.fontScale + '%';
    $$('#font-presets [data-fs]', pane).forEach((x) => x.classList.toggle('on', +x.dataset.fs === +prefs.fontScale));
  };
  $('#font-minus', pane).addEventListener('click', () => { stepFontScale(-FONT_SCALE_STEP); paintFontUI(); });
  $('#font-plus', pane).addEventListener('click', () => { stepFontScale(FONT_SCALE_STEP); paintFontUI(); });
  $$('#font-presets [data-fs]', pane).forEach((b) =>
    b.addEventListener('click', () => { setFontScale(+b.dataset.fs); toast('字号 ' + prefs.fontScale + '%', 'ok', 1200); paintFontUI(); })
  );
  const fontSample = $('#font-sample', pane);
  const paintFontDesc = () => {
    const f = FONT_FAMILIES.find((x) => x.key === prefs.fontFamily) || FONT_FAMILIES[0];
    fontSample.title = f.desc; fontSample.dataset.desc = f.desc;
  };
  paintFontDesc();
  $('#font-family', pane).addEventListener('change', (e) => {
    prefs.fontFamily = e.target.value; applyFont(); paintFontDesc(); toast('字体已切换', 'ok', 1200);
  });
}

/* ---------- 行为 ---------- */
function renderSetBehavior(pane) {
  pane.innerHTML = `
    <div class="section-label" style="margin-top:0">安全</div>
    <div class="setting-row">
      <div><div class="label">自动锁定</div><div class="desc">无操作多久后自动上锁</div></div>
      ${seg('autolock', [[1, '1 分'], [5, '5 分'], [15, '15 分'], [30, '30 分'], [0, '关闭']])}
    </div>
    <div class="setting-row">
      <div><div class="label">剪贴板自动清除</div><div class="desc">复制密码后多久清空剪贴板</div></div>
      ${seg('clipClear', [[15, '15 秒'], [30, '30 秒'], [60, '60 秒'], [0, '关闭']])}
    </div>
    <div class="section-label">回收站</div>
    <div class="setting-row">
      <div><div class="label">保留期限</div><div class="desc">超过期限的已删除条目下次启动时自动清除</div></div>
      ${seg('trashDays', [[7, '7 天'], [30, '30 天'], [90, '90 天'], [0, '永不']])}
    </div>
    <div class="section-label">组织</div>
    <div class="setting-row">
      <div><div class="label">保险库</div><div class="desc">当前 ${state.vaults.length} 个保险库 · ${state.folders.length} 个文件夹</div></div>
      <button class="ghost-btn sm" id="set-vaults">管理</button>
    </div>`;
  bindSeg(pane);
  $('#set-vaults', pane).addEventListener('click', openVaultManager);
}

/* ---------- 同步 ---------- */
function renderSetSync(pane) {
  const s = prefs.sync || (prefs.sync = { enabled: false, auto: true, token: '', user: '', server: SYNC_SERVER });
  pane.innerHTML = `
    <div class="section-label" style="margin-top:0">账号</div>
    ${s.token ? `
      <div class="setting-row">
        <div><div class="label">${escapeHtml(s.user || '')}</div><div class="desc">已登录${s.auto ? ' · 自动同步已开启' : ' · 自动同步已关闭'}</div></div>
        <button class="ghost-btn sm danger" id="sync-logout">退出登录</button>
      </div>` : `
      <div class="sync-form">
        <div class="field"><input id="sync-user" placeholder="用户名（3-32 位）" autocomplete="off"></div>
        <div class="field"><input id="sync-pass" type="password" placeholder="密码（至少 8 位）"></div>
        <div class="sync-form-acts">
          <button class="primary" id="sync-login">登录</button>
          <button class="ghost-btn" id="sync-register">注册新账号</button>
        </div>
        <p class="sync-hint">账号密码只用于登录同步服务，<b>主密码永远不会上传</b>。服务端只存加密后的密文，连服务器管理员也看不到你的密码。</p>
      </div>`}

    <div class="section-label">同步</div>
    <div class="setting-row">
      <div><div class="label">立即同步</div><div class="desc">拉取云端版本并与本地合并，再推送</div></div>
      <button class="ghost-btn sm" id="sync-now" ${s.token ? '' : 'disabled'}>同步</button>
    </div>
    <div class="setting-row">
      <div><div class="label">自动同步</div><div class="desc">每次修改保存后、以及解锁时自动同步</div></div>
      <label class="switch"><input type="checkbox" id="sync-auto" ${s.auto ? 'checked' : ''} ${s.token ? '' : 'disabled'}><span></span></label>
    </div>
    <div class="sync-status" id="sync-status"></div>

    <div class="section-label">最近同步记录</div>
    <div class="sync-logs" id="sync-logs"><div class="bk-empty">加载中…</div></div>`;

  if (s.token) {
    $('#sync-logout', pane).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '退出同步账号？', desc: '本地数据不受影响，只是不再同步。', okText: '退出' });
      if (!ok) return;
      prefs.sync.token = ''; prefs.sync.user = ''; savePrefs();
      syncCache.at = 0; syncCache.version = null; syncCache.logs = null;
      renderSettings();
    });
    $('#sync-now', pane).addEventListener('click', () => doSync(true));
    $('#sync-auto', pane).addEventListener('change', (e) => {
      prefs.sync.auto = e.target.checked; savePrefs();
      toast(e.target.checked ? '自动同步已开启' : '自动同步已关闭', 'ok', 1200);
    });
    // 30s 内切回来不重新请求（之前每切一次 tab 就发 2 个 HTTPS 请求）
    const fresh = syncCache.at && Date.now() - syncCache.at < 30000;
    if (fresh && syncCache.version) paintSyncVersion(pane, syncCache.version);
    else refreshSyncStatus(pane);
    if (fresh && syncCache.logs) paintSyncLogs(pane, syncCache.logs);
    else loadSyncLogs(pane);
  } else {
    const submit = async (register) => {
      const u = $('#sync-user', pane).value.trim(), p = $('#sync-pass', pane).value;
      if (!u || !p) { toast('请输入用户名和密码', 'err'); return; }
      const btn = register ? $('#sync-register', pane) : $('#sync-login', pane);
      btn.disabled = true; btn.textContent = register ? '注册中…' : '登录中…';
      try {
        const r = await store.syncLogin(u, p, register);
        prefs.sync.token = r.token; prefs.sync.user = r.user; prefs.sync.server = r.server; savePrefs();
        syncCache.at = 0; syncCache.version = null; syncCache.logs = null;
        toast(register ? '注册成功，已登录' : '登录成功', 'ok');
        renderSettings();
      } catch (e) { toast(String(e.message || e), 'err'); }
      btn.disabled = false; btn.textContent = register ? '注册新账号' : '登录';
    };
    $('#sync-login', pane).addEventListener('click', () => submit(false));
    $('#sync-register', pane).addEventListener('click', () => submit(true));
    $('#sync-pass', pane).addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(false); });
  }
}

function paintSyncVersion(pane, v) {
  const el = $('#sync-status', pane); if (!el) return;
  const localV = +(localStorage.getItem('vault.syncVersion') || 0);
  el.innerHTML = `<div class="sync-stat"><span>云端 ${v.exists ? 'v' + v.version : '空'}</span><span>本地已知 v${localV}</span><span class="${v.version > localV ? 'warn' : 'ok'}">${!v.exists ? '尚未上传' : v.version > localV ? '云端有新版本' : '已是最新'}</span></div>`;
}

async function refreshSyncStatus(pane) {
  const el = $('#sync-status', pane); if (!el) return;
  el.innerHTML = '<div class="desc">检查云端…</div>';
  try {
    const v = await store.syncVersion();
    if (!$('#sync-status', pane)) return;   // 用户已切走
    syncCache.version = v; syncCache.at = Date.now();
    paintSyncVersion(pane, v);
  } catch (e) {
    if ($('#sync-status', pane)) el.innerHTML = `<div class="desc" style="color:var(--danger)">${escapeHtml(String(e.message || e))}</div>`;
  }
}

function paintSyncLogs(pane, r) {
  const el = $('#sync-logs', pane); if (!el) return;
  const list = Array.isArray(r.list) ? r.list : [];
  const ACT = { push: '推送', pull: '拉取', conflict: '冲突', register: '注册', login: '登录', logout: '退出' };
    el.innerHTML = list.length ? list.map((x) => `
      <div class="sync-log-row">
        <span class="bk-when">${fmtSyncTime(x.createdAt)}</span>
        <span class="bk-tag">${ACT[x.action] || escapeHtml(x.action || '-')}</span>
        <span class="${x.result === 'ok' ? 'ok' : 'err'}">${x.result === 'ok' ? '成功' : '拒绝'}</span>
        <span class="desc ellipsis">${escapeHtml(x.detail || '')}${x.clientName ? ' · ' + escapeHtml(x.clientName) : ''}</span>
      </div>`).join('') : '<div class="bk-empty">还没有同步记录</div>';
}

async function loadSyncLogs(pane) {
  const el = $('#sync-logs', pane); if (!el) return;
  try {
    const r = await store.syncLogs();
    if (!$('#sync-logs', pane)) return;   // 用户已切走
    syncCache.logs = r; syncCache.at = Date.now();
    paintSyncLogs(pane, r);
  } catch (e) {
    if ($('#sync-logs', pane)) el.innerHTML = `<div class="bk-empty">${escapeHtml(String(e.message || e))}</div>`;
  }
}

/* 服务端 LocalDateTime 是无时区的 "2026-11-27T15:03:26"（北京时间），Safari/WebKit 对 "T" 直接 new Date 会得到 Invalid Date，手动拆 */
function fmtSyncTime(s) {
  if (!s || typeof s !== 'string') return '-';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return escapeHtml(s);
  const [, y, mo, d, h, mi] = m;
  const now = new Date();
  const sameDay = +y === now.getFullYear() && +mo === now.getMonth() + 1 && +d === now.getDate();
  const sameYear = +y === now.getFullYear();
  const hm = `${h}:${mi}`;
  if (sameDay) return hm;
  const md = `${+mo}月${+d}日`;
  return sameYear ? `${md} ${hm}` : `${y}-${mo}-${d} ${hm}`;
}

/* ---------- 备份 ---------- */
async function renderSetBackup(pane) {
  pane.innerHTML = '<div class="bk-empty">加载中…</div>';
  let backups = [], bkCfg = { primary: '', extra: null };
  try { backups = await store.listBackups(); } catch (_) {}
  try { bkCfg = await store.backupConfig(); } catch (_) {}
  pane.innerHTML = `
    <div class="section-label" style="margin-top:0">备份位置</div>
    <div class="bk-cfg">
      <div class="bk-cfg-row">
        <div class="bk-cfg-txt">
          <div class="label">内置位置<span class="bk-badge">应用目录内</span></div>
          <div class="desc ellipsis" title="${escapeHtml(bkCfg.primary)}">${escapeHtml(shortPath(bkCfg.primary))}</div>
        </div>
        <button class="ghost-btn sm" data-bk-open="${escapeHtml(bkCfg.primary)}">打开</button>
      </div>
      <div class="bk-cfg-row">
        <div class="bk-cfg-txt">
          <div class="label">额外位置${bkCfg.extra ? '<span class="bk-badge ok">已启用</span>' : '<span class="bk-badge warn">未设置</span>'}</div>
          ${bkCfg.extra
            ? `<div class="desc ellipsis" title="${escapeHtml(bkCfg.extra)}">${escapeHtml(shortPath(bkCfg.extra))}</div>`
            : `<div class="desc">建议设成「文稿」里的文件夹 —— 删掉 App 时备份不会跟着消失</div>`}
        </div>
        <span class="bk-cfg-acts">
          ${bkCfg.extra ? '' : '<button class="ghost-btn sm" id="bk-default">用文稿</button>'}
          <button class="ghost-btn sm" id="bk-pick">${bkCfg.extra ? '更换' : '选择…'}</button>
          ${bkCfg.extra ? `<button class="ghost-btn sm" data-bk-open="${escapeHtml(bkCfg.extra)}">打开</button><button class="ghost-btn sm danger" id="bk-clear">清除</button>` : ''}
        </span>
      </div>
    </div>
    <div class="section-label">备份列表（${backups.length} 份）</div>
    <div class="backup-list" id="backup-list">
      ${backups.length ? backups.map((b) => `
        <div class="backup-row">
          <span class="bk-main">
            <span class="bk-when">${fmtBkTime(b.modified)}</span>
            <span class="bk-size">${(b.size / 1024).toFixed(1)} KB</span>
            <span class="bk-tag ${b.dir === 'extra' ? 'ok' : ''}">${b.dir === 'extra' ? '额外' : '内置'}</span>
            ${/-before-restore\.dat$/.test(b.name) ? '<span class="bk-tag warn">恢复前快照</span>' : ''}
          </span>
          <span class="bk-acts">
            <button data-restore-bk="${escapeHtml(b.name)}" data-bk-dir="${b.dir}">恢复</button>
            <button class="danger" data-del-bk="${escapeHtml(b.name)}" data-bk-dir="${b.dir}">删除</button>
          </span>
        </div>`).join('') : '<div class="bk-empty">首次保存后会自动生成</div>'}
    </div>`;
  const reopen = () => renderSettings();

  $$('#backup-list [data-restore-bk]', pane).forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '从备份恢复？',
        desc: '会覆盖当前全部数据，恢复后需要用<strong>该备份创建时的主密码</strong>重新解锁。覆盖前程序会先给当前数据留一份快照。',
        okText: '恢复', danger: true,
      });
      if (!ok) return;
      try {
        await store.restore(b.dataset.restoreBk, b.dataset.bkDir);
        closeSettings(); await doLock(true);
        toast('已恢复，请用该备份时的主密码解锁', 'ok');
      } catch (e) { toast(String(e.message || e), 'err'); }
    })
  );
  $$('#backup-list [data-del-bk]', pane).forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: '删除这份备份？',
        desc: `将删除 <strong>${escapeHtml(b.dataset.delBk)}</strong>，删除后无法找回。当前密码库不受影响。`,
        okText: '删除', danger: true,
      });
      if (!ok) return;
      try { await store.deleteBackup(b.dataset.delBk, b.dataset.bkDir); toast('已删除', 'ok', 1200); reopen(); }
      catch (e) { toast(String(e.message || e), 'err'); }
    })
  );
  $('#bk-pick', pane).addEventListener('click', async () => {
    let p = null;
    try { p = await store.pickBackupDir(); }
    catch (_) {
      const r = await promptDialog({
        title: '输入备份目录', desc: '系统选择框不可用，直接填一个路径。目录不存在会自动创建。',
        fields: [{ key: 'path', placeholder: '~/Documents/Vault Backups', value: '~/Documents/Vault Backups' }], okText: '使用',
      });
      p = r && r.path ? r.path.trim() : null;
    }
    if (!p) return;
    try { await store.setBackupDir(p); toast('额外备份位置已更新', 'ok', 1200); reopen(); }
    catch (e) { toast(String(e.message || e), 'err'); }
  });
  const defBtn = $('#bk-default', pane);
  if (defBtn) defBtn.addEventListener('click', async () => {
    try { await store.setBackupDir('~/Documents/Vault Backups'); toast('已设为 ~/Documents/Vault Backups', 'ok', 1200); reopen(); }
    catch (e) { toast(String(e.message || e), 'err'); }
  });
  const clearBtn = $('#bk-clear', pane);
  if (clearBtn) clearBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清除额外备份位置？', desc: '只停止往那个目录继续写备份，<strong>已经存在的备份文件不会被删除</strong>。', okText: '清除' });
    if (!ok) return;
    try { await store.setBackupDir(null); toast('已清除额外位置', 'ok', 1200); reopen(); }
    catch (e) { toast(String(e.message || e), 'err'); }
  });
  $$('[data-bk-open]', pane).forEach((b) =>
    b.addEventListener('click', () => store.revealDir(b.dataset.bkOpen).catch((e) => toast(String(e.message || e), 'err')))
  );
}

/* ---------- 数据 ---------- */
function renderSetData(pane) {
  pane.innerHTML = `
    <div class="section-label" style="margin-top:0">主密码</div>
    <div class="setting-row">
      <div><div class="label">修改主密码</div><div class="desc">会用新密码重新加密整个库</div></div>
      <button class="ghost-btn sm" id="set-pwd">修改</button>
    </div>
    <div class="section-label">导出</div>
    <div class="setting-row">
      <div><div class="label">导出加密备份</div><div class="desc">保存到桌面，可用主密码恢复</div></div>
      <button class="ghost-btn sm" id="set-export">导出</button>
    </div>
    <div class="setting-row">
      <div><div class="label">导出 CSV</div><div class="desc" style="color:var(--warn)">明文，慎用</div></div>
      <button class="ghost-btn sm" id="set-csv">导出</button>
    </div>
    <div class="section-label">导入</div>
    <div class="setting-row">
      <div><div class="label">从 CSV 导入</div><div class="desc">支持 Chrome、Bitwarden、1Password 等格式</div></div>
      <button class="ghost-btn sm" id="set-import">选择文件</button>
    </div>
    <p class="modal-sub" style="margin-top:16px">数据文件：${escapeHtml(state.meta.path || '-')}</p>`;
  $('#set-pwd', pane).addEventListener('click', openChangePassword);
  $('#set-export', pane).addEventListener('click', async () => {
    try { const p = await store.exportBackup(); toast('已导出：' + p, 'ok'); }
    catch (e) { toast(String(e.message || e), 'err'); }
  });
  $('#set-csv', pane).addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '导出明文 CSV？',
      desc: 'CSV 里的密码是<strong style="color:var(--danger)">未加密的明文</strong>，任何能读到这个文件的人都能看到。仅用于迁移到别的软件，完成后请立即删除。',
      okText: '我明白，导出', danger: true,
    });
    if (!ok) return;
    const rows = [['name', 'url', 'username', 'password', 'category', 'notes']];
    activeItems().forEach((i) => {
      const pwd = i.kind === 'login' ? i.password : (i.fields.find((f) => f.secret) || {}).value || '';
      rows.push([i.title, i.url, i.username, pwd, i.category, i.notes]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    try { const p = await store.exportText('\ufeff' + csv, 'vault-plaintext.csv'); toast('已导出：' + p, 'ok'); }
    catch (e) { toast(String(e.message || e), 'err'); }
  });
  $('#set-import', pane).addEventListener('click', () => $('#file-input').click());
}

/* ---------- 关于 ---------- */
function renderSetAbout(pane) {
  pane.innerHTML = `
    <div class="about-hero">
      <div class="about-logo">${LOGO_SVG}</div>
      <div class="about-name">Vault</div>
      <div class="about-ver">版本 ${APP_VERSION}</div>
    </div>
    <div class="setting-row">
      <div><div class="label">检查更新</div><div class="desc" id="about-upd">定时自动检查，有新版本可一键安装</div></div>
      <span class="about-upd-acts">
        <button class="ghost-btn sm" id="about-check">检查</button>
        <button class="primary sm" id="about-update-btn" disabled style="display:none">更新</button>
      </span>
    </div>
    <div class="setting-row">
      <div><div class="label">数据格式</div><div class="desc">AES-256-GCM · PBKDF2-SHA256 600,000 次 · 格式 v${DATA_VERSION}</div></div>
    </div>
    <p class="modal-sub" style="margin-top:14px">本地密码管理器，所有加密在你的设备上完成，服务端（如启用同步）只中转密文。</p>`;
  $('#about-check', pane).addEventListener('click', () => checkForUpdate(true));
}

/* ---------------- 自动更新 ---------------- */
/* 用 Tauri updater 插件，端点指向 GitHub Release 的 latest.json（CI 自动产出）。
   策略：启动后 30s 查一次，之后每 6 小时一次；手动检查走同一条路径。 */
const UPDATE_CHECK_INTERVAL = 6 * 3600 * 1000;
let updateCheckTimer = null;

async function checkForUpdate(manual = false) {
  if (!IS_DESKTOP) { if (manual) toast('浏览器模式不支持更新', 'err'); return; }
  const hint = document.querySelector('#about-upd');
  const paint = (t) => { if (hint) hint.textContent = t; };
  if (manual) paint('正在检查…');
  try {
    const upd = window.__TAURI__.updater || window.__TAURI_PLUGIN_UPDATER__;
    if (!upd) throw new Error('updater 插件未加载');
    const update = await upd.check();   // 无更新时返回 null
    if (!update) {
      paint('已是最新版本（' + APP_VERSION + '）');
      if (manual) toast('已是最新版本', 'ok', 1500);
      return;
    }
    const nv = update.version || (update.manifest || {}).version || '';
    paint('发现新版本 ' + nv + '，点击「更新」安装');
    toast('发现新版本 ' + nv + '，可在「设置 → 关于」里更新', 'ok', 4000);
    const btn = document.querySelector('#about-update-btn');
    if (btn) { btn.style.display = ''; btn.disabled = false; btn.textContent = '更新到 ' + nv; btn.onclick = () => installUpdate(update); }
    else {
      // 不在关于页时，把更新入口挂到侧栏，用户随时能点
      let fab = document.querySelector('#upd-fab');
      if (!fab) {
        fab = document.createElement('button');
        fab.id = 'upd-fab'; fab.className = 'upd-fab'; fab.textContent = '新版本 ' + nv;
        fab.onclick = () => openSettings('about');
        document.querySelector('.nav-foot') && document.querySelector('.nav-foot').prepend(fab);
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    paint('检查失败：' + msg.slice(0, 80));
    if (manual) toast('检查更新失败：' + msg, 'err', 3000);
  }
}

async function installUpdate(update) {
  const ok = await confirmDialog({
    title: '安装更新？',
    desc: '下载完成后会自动重启应用。未保存的修改请先保存。',
    okText: '下载并安装',
  });
  if (!ok) return;
  toast('正在下载更新…', '', 2000);
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') toast('下载中… 0%', '', 60000);
      else if (ev.event === 'Progress') {
        if (ev.data.total) { const pct = Math.round(ev.data.chunkLength / ev.data.total * 100); toast('下载中… ' + pct + '%', '', 60000); }
      } else if (ev.event === 'Finished') toast('下载完成，正在安装…', 'ok', 60000);
    });
    await (window.__TAURI__.process || window.__TAURI_PLUGIN_PROCESS__).restart();
  } catch (e) {
    toast('更新失败：' + (e.message || e), 'err', 4000);
  }
}

function scheduleUpdateCheck() {
  if (!IS_DESKTOP) return;
  clearTimeout(updateCheckTimer);
  const loop = () => { checkForUpdate(false).finally(() => { updateCheckTimer = setTimeout(loop, UPDATE_CHECK_INTERVAL); }); };
  updateCheckTimer = setTimeout(loop, 30000);
}

function openVaultManager() {
  returnToSettings = true;
  const card = $('#modal-card');
  card.classList.add('wide');
  card.innerHTML = `
    <h3>保险库</h3>
    <p class="modal-sub">每个保险库有独立的条目和文件夹。按「个人 / 工作 / 客户」分开，列表就不会混在一起。</p>
    <div class="backup-list" style="max-height:none">
      ${state.vaults.map((v) => {
        const n = state.items.filter((i) => i.vaultId === v.id && !i.deletedAt).length;
        return `<div class="backup-row">
          <span style="display:flex;align-items:center;gap:8px;color:var(--text)">
            <i style="width:8px;height:8px;border-radius:50%;background:${v.color};display:inline-block"></i>
            ${escapeHtml(v.name)}<span style="color:var(--faint)">${n} 条</span>
          </span>
          <span style="display:flex;gap:9px;align-items:center">
            <button data-vren="${v.id}">重命名</button>
            <button data-vcolor="${v.id}">换色</button>
            ${state.vaults.length > 1 ? `<button data-vdel="${v.id}" style="color:var(--danger)">删除</button>` : ''}
          </span>
        </div>`;
      }).join('')}
    </div>
    <div class="setting-row" style="margin-top:6px">
      <div><div class="label">当前库的文件夹</div><div class="desc">${state.folders.filter((f) => f.vaultId === state.curVaultId).length} 个，可在左侧导航里直接管理</div></div>
      <button class="ghost-btn sm" id="vm-newfolder">新建文件夹</button>
    </div>
    <div class="modal-actions">
      <button class="ghost-btn" id="vm-new">+ 新建保险库</button>
      <button class="ghost-btn" id="vm-close">关闭</button>
    </div>`;
  $('#modal').classList.remove('hidden');

  $('#vm-close').addEventListener('click', closeModal);
  $('#vm-new').addEventListener('click', () => { closeModal(); createVault(); });
  $('#vm-newfolder').addEventListener('click', () => { closeModal(); createFolder(null); });
  $$('[data-vren]', card).forEach((b) => b.addEventListener('click', () => { closeModal(); renameVault(b.dataset.vren); }));
  $$('[data-vcolor]', card).forEach((b) => b.addEventListener('click', () => { cycleVaultColor(b.dataset.vcolor); openVaultManager(); }));
  $$('[data-vdel]', card).forEach((b) => b.addEventListener('click', async () => {
    closeModal();
    await deleteVault(b.dataset.vdel);
  }));
}

function openChangePassword() {
  returnToSettings = true;
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
        favorite: false, tags: [], vaultId: state.curVaultId, folderId: null,
        history: [], createdAt: Date.now(), updatedAt: Date.now(),
        usedAt: null, archivedAt: null, deletedAt: null,
      });
      count++;
    });
    persist(true);
    renderNav();
    renderList();
    renderDetail();
    toast(`已导入 ${count} 条到「${currentVault().name}」`, 'ok');
  } catch (err) {
    toast('导入失败：' + (err.message || err), 'err');
  }
});

/* ---------------- 快捷键 ---------------- */
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  /* 字号：⌘+ / ⌘- / ⌘0（浏览器默认的页面缩放对这个应用没意义，接管掉） */
  if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0')) {
    e.preventDefault();
    if (e.key === '0') { setFontScale(100); toast('字号已恢复 100%', 'ok', 1200); }
    else stepFontScale(e.key === '=' || e.key === '+' ? FONT_SCALE_STEP : -FONT_SCALE_STEP);
    return;
  }
  if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
    e.preventDefault();
    if (state.unlocked) $('#search').focus();
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (state.unlocked) createFolder(null);
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

/* ---------------- 首次运行：找回历史备份 ---------------- */
async function tryRecoverFrom(path) {
  const ok = await confirmDialog({
    title: '用这份备份恢复？',
    desc: '会用这份备份替换当前数据文件，之后请用<strong>那份备份创建时的主密码</strong>解锁。当前数据若已有内容，程序会先留一份快照。',
    okText: '恢复',
  });
  if (!ok) return;
  try {
    await store.restoreFromPath(path);
    state.meta = await store.status();
    $('#gate-recover').classList.add('hidden');
    setGateMode('unlock');
    toast('已恢复，请输入当时的主密码', 'ok');
  } catch (e) { toast(String(e.message || e), 'err'); }
}

function showRecoverList(found) {
  const card = $('#modal-card');
  card.classList.remove('wide');
  card.innerHTML = `
    <h3>历史备份</h3>
    <p class="modal-sub">这些是从备份目录、桌面、文稿和下载里找到的。选一份恢复，之后用它的主密码解锁。</p>
    <div class="backup-list" style="max-height:none">
      ${found.map((f, i) => `
        <div class="backup-row">
          <span class="bk-main">
            <span class="bk-when">${fmtBkTime(f.modified)}</span>
            <span class="bk-size">${(f.size / 1024).toFixed(1)} KB</span>
            <span class="bk-tag">${escapeHtml(f.source)}</span>
          </span>
          <span class="bk-acts"><button data-recover-path="${i}">恢复</button></span>
        </div>`).join('')}
    </div>
    <div class="modal-actions"><button class="ghost-btn" id="recover-list-close">关闭</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#recover-list-close').addEventListener('click', closeModal);
  $$('[data-recover-path]', card).forEach((b) =>
    b.addEventListener('click', () => {
      closeModal();
      tryRecoverFrom(found[+b.dataset.recoverPath].path);
    })
  );
}

async function probeAndOfferRecover() {
  const box = $('#gate-recover');
  if (!box) return;
  let found = [];
  try { found = await store.probeBackups(); } catch (_) { return; }
  if (!found.length) { box.classList.add('hidden'); return; }

  const top = found[0];
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="recover-head">
      <span class="recover-dot"></span>
      检测到 ${found.length} 份历史备份
    </div>
    <div class="recover-sub">最近一份 ${fmtBkTime(top.modified)} · ${(top.size / 1024).toFixed(1)} KB · ${escapeHtml(top.source)}</div>
    <div class="recover-acts">
      <button class="primary sm" id="recover-go">用它恢复</button>
      ${found.length > 1 ? `<button class="ghost-btn sm" id="recover-more">全部 ${found.length} 份</button>` : ''}
      <button class="ghost-btn sm" id="recover-skip">跳过，新建</button>
    </div>`;

  $('#recover-skip').addEventListener('click', () => box.classList.add('hidden'));
  $('#recover-go').addEventListener('click', () => tryRecoverFrom(top.path));
  const more = $('#recover-more');
  if (more) more.addEventListener('click', () => showRecoverList(found));
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  loadPrefs();
  try {
    state.meta = await store.status();
  } catch (e) {
    state.meta = { exists: false, path: '', backupDir: '' };
  }
  setGateMode(state.meta.exists ? 'unlock' : 'create');
  if (!state.meta.exists) {
    // 主文件不在，但备份可能还在 —— 先问一句，别让用户以为数据没了
    probeAndOfferRecover();
  }
  window.addEventListener('beforeunload', () => {
    if (state.unlocked && state.dirty) { try { store.save(serialize()); } catch (_) {} }
  });
  setTimeout(() => $('#pwd').focus(), 120);
})();

/* ============================================================
   密码库 · 本地离线加密密码管理器
   数据加密由 Rust 端完成（AES-256-GCM + PBKDF2-SHA256 600k）
   浏览器直开时降级为 WebCrypto，逻辑保持一致
   ============================================================ */

const TAURI = window.__TAURI__;
const invoke = TAURI && TAURI.core ? TAURI.core.invoke : null;
const IS_DESKTOP = !!invoke;

const AAD_TEXT = 'local-vault::v1';
const ITERATIONS = 600000;
const WEB_KEY = 'vault.envelope.v1';
const AUTOLOCK_MIN = 5;

const TYPES = [
  { key: 'all', label: '全部' },
  { key: 'fav', label: '收藏' },
  { key: 'web', label: '网站' },
  { key: 'mail', label: '邮箱' },
  { key: 'bank', label: '金融' },
  { key: 'server', label: '服务器' },
  { key: 'other', label: '其他' },
];

const state = {
  items: [],
  settings: {},
  selectedId: null,
  filter: 'all',
  query: '',
  unlocked: false,
  dirty: false,
  meta: { exists: false, path: '', backupDir: '' },
};

/* ---------------- 工具 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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
  const ch = (text.trim()[0] || '?').toUpperCase();
  return { ch, bg: `linear-gradient(145deg, ${a}, ${b})` };
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2100);
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
        {
          name: 'AES-GCM', iv: b64.dec(env.iv),
          additionalData: new TextEncoder().encode(AAD_TEXT),
        },
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
    const text = JSON.stringify({ version: 1, items: state.items, settings: state.settings });
    const env = await webStore.encrypt(key, saltB64, ITERATIONS, text);
    localStorage.setItem(WEB_KEY, JSON.stringify(env));
    webStore.key = key;
  },
  async exportBackup() {
    if (IS_DESKTOP) return invoke('export_backup');
    const raw = localStorage.getItem(WEB_KEY);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const blob = new Blob([raw], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vault-backup-${stamp}.dat`;
    a.click();
    return '已下载到浏览器下载目录';
  },
  async listBackups() {
    if (IS_DESKTOP) return invoke('list_backups');
    return [];
  },
  async restore(name) {
    if (IS_DESKTOP) return invoke('restore_backup', { name });
    throw new Error('浏览器模式不支持从本地备份恢复');
  },
};

/* ---------------- 数据持久化 ---------------- */
let saveTimer = null;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    try {
      const text = JSON.stringify({ version: 1, items: state.items, settings: state.settings });
      await store.save(text);
      state.dirty = false;
    } catch (e) {
      toast('保存失败：' + (e.message || e), 'err');
    }
  };
  if (immediate) return run();
  state.dirty = true;
  saveTimer = setTimeout(run, 650);
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
  setTimeout(() => $('#pwd').focus(), 60);
}

function pwdStrength(v) {
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (v.length >= 16) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  score = Math.min(4, Math.max(v.length ? 1 : 0, Math.floor(score * 0.72)));
  return score;
}

function renderStrength(v) {
  const bars = $$('#strength .strength-bar i');
  const s = pwdStrength(v);
  const colors = ['#ff6b6b', '#f59e0b', '#eab308', '#34d399', '#46d39a'];
  const labels = ['太弱', '较弱', '一般', '较强', '很强'];
  bars.forEach((b, i) => { b.style.background = i < s ? colors[s] : 'rgba(255,255,255,.1)'; });
  $('#strength-label').textContent = v ? labels[s] : '强度';
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
    if (pwdStrength(pwd) < 2 && !confirm('这个主密码偏弱，容易被猜到。仍要使用吗？')) return;
  }
  btn.disabled = true;
  const origin = btn.textContent;
  btn.textContent = gateMode === 'create' ? '正在创建…' : '正在解锁…';
  try {
    const plain = gateMode === 'create'
      ? await store.create(pwd)
      : await store.unlock(pwd);
    const data = JSON.parse(plain || '{}');
    state.items = Array.isArray(data.items) ? data.items : [];
    state.settings = data.settings || {};
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
  state.meta = { ...state.meta };
  $('#gate').classList.add('hidden');
  $('#main').classList.remove('hidden');
  renderFilters();
  renderList();
  if (state.items.length) selectItem(state.items[0].id);
  else renderDetail(null);
  resetAutoLock();
}

async function doLock(silent) {
  if (!state.unlocked) return;
  clearTimeout(saveTimer);
  try {
    if (state.dirty) {
      await store.save(JSON.stringify({ version: 1, items: state.items, settings: state.settings }));
    }
  } catch (_) {}
  await store.lock();
  state.unlocked = false;
  state.items = [];
  state.settings = {};
  state.selectedId = null;
  state.query = '';
  state.filter = 'all';
  $('#search').value = '';
  $('#list').innerHTML = '';
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
  if (!state.unlocked) return;
  lockTimer = setTimeout(() => doLock(true), AUTOLOCK_MIN * 60 * 1000);
}
['mousemove', 'keydown', 'click', 'wheel'].forEach((ev) =>
  window.addEventListener(ev, resetAutoLock, { passive: true })
);

/* ---------------- 列表 ---------------- */
function renderFilters() {
  $('#filters').innerHTML = TYPES.map(
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

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  let list = state.items.slice();
  if (state.filter === 'fav') list = list.filter((i) => i.favorite);
  else if (state.filter !== 'all') list = list.filter((i) => (i.type || 'other') === state.filter);
  if (q) {
    list = list.filter((i) =>
      [i.title, i.username, i.url, i.notes].join(' ').toLowerCase().includes(q)
    );
  }
  return list.sort(
    (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

function renderList() {
  const list = visibleItems();
  const box = $('#list');
  $('#count').textContent = `${state.items.length} 条`;
  if (!list.length) {
    box.innerHTML = `<div class="empty-list">${
      state.items.length ? '没有匹配的条目' : '还没有任何记录<br>点右下角「新建」开始'
    }</div>`;
    return;
  }
  box.innerHTML = list
    .map((i) => {
      const av = avatarOf(i.title || '?');
      return `<div class="item ${i.id === state.selectedId ? 'active' : ''}" data-id="${i.id}">
        <div class="avatar" style="background:${av.bg}">${escapeHtml(av.ch)}</div>
        <div class="item-body">
          <div class="item-title">${escapeHtml(i.title || '未命名')}</div>
          <div class="item-sub">${escapeHtml(i.username || i.url || '—')}</div>
        </div>
        ${i.favorite ? '<span class="star">★</span>' : ''}
      </div>`;
    })
    .join('');
  $$('#list .item').forEach((el) =>
    el.addEventListener('click', () => selectItem(el.dataset.id))
  );
}

function selectItem(id) {
  state.selectedId = id;
  renderList();
  renderDetail(id);
}

/* ---------------- 详情 ---------------- */
const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2.5 2.5 0 0 0-2.5 2.5V13"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 4l16 16"/><path d="M9.6 6.1A9.7 9.7 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 4M6.3 8.1A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.6" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="15.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.8L17.5 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>',
  starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.7"><path d="m12 3.8 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 5l-7 7 7 7"/></svg>',
};

function renderDetail(id) {
  const box = $('#detail');
  const item = state.items.find((i) => i.id === id);
  if (!item) {
    box.innerHTML = `<div class="detail-empty"><div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="4" y="10.5" width="16" height="10.5" rx="2.6"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/></svg>
      <div>选择左侧条目查看详情<br><span style="opacity:.6">或按 ⌘N 新建一条</span></div>
    </div></div>`;
    return;
  }
  const av = avatarOf(item.title || '?');
  const updated = item.updatedAt
    ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '';

  box.innerHTML = `
    <div class="detail-inner">
      <div class="detail-head">
        <div class="avatar" style="background:${av.bg}">${escapeHtml(av.ch)}</div>
        <div style="flex:1;min-width:0">
          <input class="detail-title" id="f-title" value="${escapeHtml(item.title)}" placeholder="未命名条目" spellcheck="false" />
          <div class="detail-meta" id="f-meta">${updated ? '更新于 ' + updated : ''}</div>
        </div>
        <div class="head-tools">
          <button class="ghost-btn icon-only" id="f-fav" title="收藏">${item.favorite ? ICONS.starOn : ICONS.star}</button>
          <button class="ghost-btn danger icon-only" id="f-del" title="删除">${ICONS.trash}</button>
        </div>
      </div>

      <div class="section-label">账号信息</div>
      <div class="rows">
        <div class="row">
          <span class="row-label">用户名</span>
          <input class="row-input" id="f-user" value="${escapeHtml(item.username)}" placeholder="邮箱 / 手机号 / 账号" spellcheck="false" />
          <div class="row-actions">
            <button class="mini-btn" data-copy="user" title="复制">${ICONS.copy}</button>
          </div>
        </div>
        <div class="row">
          <span class="row-label">密码</span>
          <input class="row-input mono" id="f-pwd" type="password" value="${escapeHtml(item.password)}" placeholder="点击输入" spellcheck="false" autocomplete="off" />
          <div class="row-actions">
            <button class="mini-btn" id="f-peek" title="显示/隐藏">${ICONS.eye}</button>
            <button class="mini-btn" data-copy="pwd" title="复制">${ICONS.copy}</button>
            <button class="mini-btn" id="f-gen" title="生成密码">${ICONS.dice}</button>
          </div>
        </div>
        <div class="row">
          <span class="row-label">网址</span>
          <input class="row-input" id="f-url" value="${escapeHtml(item.url)}" placeholder="https://" spellcheck="false" />
          <div class="row-actions">
            <button class="mini-btn" data-copy="url" title="复制">${ICONS.copy}</button>
          </div>
        </div>
        <div class="row">
          <span class="row-label">分类</span>
          <div class="type-picker">
            ${TYPES.filter((t) => t.key !== 'all' && t.key !== 'fav')
              .map((t) => `<button class="tp ${(item.type || 'other') === t.key ? 'on' : ''}" data-t="${t.key}">${t.label}</button>`)
              .join('')}
          </div>
        </div>
      </div>

      <div class="section-label">备注</div>
      <div class="notes-wrap">
        <textarea class="notes" id="f-notes" placeholder="安全问题答案、备用邮箱、恢复码…" spellcheck="false">${escapeHtml(item.notes)}</textarea>
      </div>
    </div>`;

  const bind = (sel, key, ev = 'input') => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(ev, () => {
      item[key] = el.value;
      item.updatedAt = Date.now();
      persist();
      if (key === 'title') {
        const a = avatarOf(item.title || '?');
        const avEl = $('.detail-head .avatar');
        avEl.textContent = a.ch;
        avEl.style.background = a.bg;
        renderList();
      }
    });
  };
  bind('#f-title', 'title');
  bind('#f-user', 'username');
  bind('#f-pwd', 'password');
  bind('#f-url', 'url');
  bind('#f-notes', 'notes');

  $$('.type-picker .tp').forEach((b) =>
    b.addEventListener('click', () => {
      item.type = b.dataset.t;
      item.updatedAt = Date.now();
      $$('.type-picker .tp').forEach((x) => x.classList.toggle('on', x === b));
      persist();
    })
  );

  $('#f-peek').addEventListener('click', () => {
    const p = $('#f-pwd');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('#f-peek').innerHTML = show ? ICONS.eyeOff : ICONS.eye;
  });

  $$('.row-actions [data-copy]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.copy;
      const val = k === 'user' ? item.username : k === 'pwd' ? item.password : item.url;
      copyText(val, k === 'pwd' ? '密码已复制，30 秒后自动清除剪贴板' : '已复制');
      if (k === 'pwd') scheduleClipboardWipe(item.password);
    })
  );

  $('#f-gen').addEventListener('click', () => {
    openGenerator((pwd) => {
      item.password = pwd;
      item.updatedAt = Date.now();
      $('#f-pwd').value = pwd;
      $('#f-pwd').type = 'text';
      persist();
      toast('已生成并填入', 'ok');
    });
  });

  $('#f-fav').addEventListener('click', () => {
    item.favorite = !item.favorite;
    item.updatedAt = Date.now();
    persist();
    renderList();
    $('#f-fav').innerHTML = item.favorite ? ICONS.starOn : ICONS.star;
  });

  $('#f-del').addEventListener('click', () => {
    if (!confirm(`删除「${item.title || '未命名'}」？此操作不可撤销。`)) return;
    state.items = state.items.filter((i) => i.id !== item.id);
    state.selectedId = null;
    persist(true);
    renderList();
    renderDetail(null);
    toast('已删除');
  });
}

function scheduleClipboardWipe(original) {
  setTimeout(async () => {
    try {
      const cur = await navigator.clipboard.readText();
      if (cur === original) await navigator.clipboard.writeText('');
    } catch (_) {}
  }, 30000);
}

/* ---------------- 新建 ---------------- */
function addItem() {
  const item = {
    id: uid(),
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    type: 'web',
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.items.unshift(item);
  state.filter = 'all';
  state.query = '';
  $('#search').value = '';
  renderFilters();
  selectItem(item.id);
  persist();
  setTimeout(() => $('#f-title') && $('#f-title').focus(), 40);
}

$('#add-btn').addEventListener('click', addItem);

/* ---------------- 搜索 ---------------- */
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

/* ---------------- 生成器 ---------------- */
const GEN_SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*-_=+?',
};

let genOpt = { len: 18, lower: true, upper: true, digit: true, symbol: true };

function genPassword() {
  let pool = '';
  const must = [];
  ['lower', 'upper', 'digit', 'symbol'].forEach((k) => {
    if (genOpt[k]) { pool += GEN_SETS[k]; must.push(GEN_SETS[k]); }
  });
  if (!pool) pool = GEN_SETS.lower;
  const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const out = must.map((s) => s[rnd(s.length)]);
  while (out.length < genOpt.len) out.push(pool[rnd(pool.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, Math.max(genOpt.len, must.length)).join('');
}

function openGenerator(onUse) {
  const modal = $('#modal');
  const card = $('#modal-card');
  const draw = () => {
    const pwd = genPassword();
    card.innerHTML = `
      <h3>密码生成器</h3>
      <p class="modal-sub">使用系统级随机源，生成后不会发送到任何地方</p>
      <div class="gen-out"><span id="gen-val">${escapeHtml(pwd)}</span>
        <button class="mini-btn" id="gen-refresh" title="重新生成">↻</button>
      </div>
      <div class="slider-row">
        <label>长度</label>
        <input type="range" id="gen-len" min="8" max="40" value="${genOpt.len}" />
        <b id="gen-len-v">${genOpt.len}</b>
      </div>
      <div class="opts">
        ${[['upper', '大写字母'], ['lower', '小写字母'], ['digit', '数字'], ['symbol', '符号']]
          .map(([k, label]) => `<button class="opt ${genOpt[k] ? 'on' : ''}" data-k="${k}"><span class="box"></span>${label}</button>`)
          .join('')}
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="gen-copy">复制</button>
        <button class="ghost-btn" id="gen-cancel">取消</button>
        <button class="primary" style="width:auto;padding:0 18px;height:33px;margin:0" id="gen-use">使用</button>
      </div>`;
    $('#gen-refresh').addEventListener('click', draw);
    $('#gen-len').addEventListener('input', (e) => {
      genOpt.len = +e.target.value;
      $('#gen-len-v').textContent = genOpt.len;
      const np = genPassword();
      $('#gen-val').textContent = np;
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
    $('#gen-copy').addEventListener('click', () => copyText($('#gen-val').textContent, '已复制'));
    $('#gen-cancel').addEventListener('click', closeModal);
    $('#gen-use').addEventListener('click', () => {
      const v = $('#gen-val').textContent;
      closeModal();
      onUse && onUse(v);
    });
  };
  draw();
  modal.classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

/* ---------------- 设置 ---------------- */
$('#menu-btn').addEventListener('click', async () => {
  const card = $('#modal-card');
  let backups = [];
  try { backups = await store.listBackups(); } catch (_) {}
  card.innerHTML = `
    <h3>设置</h3>
    <p class="modal-sub">数据文件：${escapeHtml(state.meta.path || '-')}</p>

    <div class="section-label" style="margin-top:0">安全</div>
    <div class="opts" style="grid-template-columns:1fr">
      <button class="opt" id="set-pwd" style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:9px"><span class="box" style="border-radius:50%"></span>修改主密码</span>
        <span style="color:var(--faint);font-size:11.5px">重新加密整个库</span>
      </button>
      <button class="opt" id="set-export" style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:9px"><span class="box" style="border-radius:50%"></span>导出加密备份</span>
        <span style="color:var(--faint);font-size:11.5px">保存到桌面</span>
      </button>
    </div>

    <div class="section-label">自动备份（最近 ${backups.length} 份）</div>
    <div class="backup-list" id="backup-list">
      ${backups.length ? backups.map((b) => `
        <div class="backup-row">
          <span>${escapeHtml(b.name.replace('vault-', '').replace('.dat', ''))} · ${(b.size / 1024).toFixed(1)} KB</span>
          <button data-restore="${escapeHtml(b.name)}">恢复</button>
        </div>`).join('') : '<div style="color:var(--faint);font-size:12px;padding:8px 2px">首次保存后会自动生成</div>'}
    </div>

    <div class="modal-actions">
      <button class="ghost-btn" id="set-close">关闭</button>
    </div>`;

  $('#set-close').addEventListener('click', closeModal);
  $('#set-export').addEventListener('click', async () => {
    try {
      const p = await store.exportBackup();
      toast('已导出：' + p, 'ok');
    } catch (e) {
      toast(String(e.message || e), 'err');
    }
  });
  $('#set-pwd').addEventListener('click', () => openChangePassword());
  $$('#backup-list [data-restore]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('恢复此备份会覆盖当前数据，并需要重新解锁。继续吗？')) return;
      try {
        await store.restore(b.dataset.restore);
        closeModal();
        await doLock(true);
        toast('已恢复，请用该备份时的主密码解锁', 'ok');
      } catch (e) {
        toast(String(e.message || e), 'err');
      }
    })
  );
  $('#modal').classList.remove('hidden');
});

function openChangePassword() {
  const card = $('#modal-card');
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
    else if (document.activeElement === $('#search')) { $('#search').value = ''; state.query = ''; renderList(); }
  }
});

/* ---------------- 启动 ---------------- */
(async function boot() {
  try {
    state.meta = await store.status();
  } catch (e) {
    state.meta = { exists: false, path: '', backupDir: '' };
  }
  setGateMode(state.meta.exists ? 'unlock' : 'create');
  window.addEventListener('beforeunload', () => {
    if (state.unlocked && state.dirty) {
      try { store.save(JSON.stringify({ version: 1, items: state.items, settings: state.settings })); } catch (_) {}
    }
  });
  // 初次进入时把焦点放在输入框，方便直接敲密码
  setTimeout(() => $('#pwd').focus(), 120);
})();

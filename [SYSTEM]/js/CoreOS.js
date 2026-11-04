'use strict';

let settings = loadSettings();

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw){
      const s = Object.assign({}, DEFAULTS, JSON.parse(raw));
      
      if (typeof s.wallpaper === 'string' && s.wallpaper.indexOf('c:') !== 0) s.wallpaper = Number(s.wallpaper) || 0;
      if (typeof s.wallpaper !== 'number' && typeof s.wallpaper !== 'string') s.wallpaper = DEFAULTS.wallpaper;
      return s;
    }
  }catch(e){  }
  return Object.assign({}, DEFAULTS);
}

function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){}
}

function applySettings(){
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--accent', settings.accent);
  applyWallpaper();
  applyBrightness();
}

const WP_DB_NAME = 'hencore_os_db';
const WP_STORE = 'wallpapers';
let wpDbPromise = null;
let customWallpapers = [];   
const customUrlCache = {};   

function openWpDb(){
  if (wpDbPromise) return wpDbPromise;
  wpDbPromise = new Promise(function(resolve, reject){
    const rq = indexedDB.open(WP_DB_NAME, 1);
    rq.onupgradeneeded = function(){ rq.result.createObjectStore(WP_STORE, { keyPath: 'id' }); };
    rq.onsuccess = function(){ resolve(rq.result); };
    rq.onerror = function(){ reject(rq.error); };
  });
  return wpDbPromise;
}

function wpRequest(store, method){
  return new Promise(function(resolve, reject){
    const rq = store[method].apply(store, Array.prototype.slice.call(arguments, 2));
    rq.onsuccess = function(){ resolve(rq.result); };
    rq.onerror = function(){ reject(rq.error); };
  });
}

async function loadCustomWallpapers(){
  try{
    const db = await openWpDb();
    const store = db.transaction(WP_STORE).objectStore(WP_STORE);
    const items = await wpRequest(store, 'getAll');
    customWallpapers = (items || []).sort(function(a, b){ return a.added - b.added; });
    customWallpapers.forEach(function(it){
      if (!customUrlCache[it.id] && it.blob) customUrlCache[it.id] = URL.createObjectURL(it.blob);
    });
    
    if (typeof settings.wallpaper === 'string' && !customUrlCache[settings.wallpaper.slice(2)]){
      settings.wallpaper = 0; saveSettings();
    }
  }catch(e){
    customWallpapers = [];
  }
}

async function addCustomWallpaper(file){
  if (!file || !/^image\//.test(file.type)){
    HENCORE.notify('Обои', 'Это не изображение — выберите файл PNG или JPG.');
    return null;
  }
  if (customWallpapers.length >= CUSTOM_WP_MAX){
    HENCORE.notify('Обои', 'Максимум ' + CUSTOM_WP_MAX + ' пользовательских обоев — сначала удалите лишние.');
    return null;
  }
  const id = 'wp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  try{
    const db = await openWpDb();
    await new Promise(function(resolve, reject){
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).put({ id: id, name: file.name, type: file.type, added: Date.now(), blob: file });
      tx.oncomplete = resolve;
      tx.onerror = function(){ reject(tx.error); };
    });
    customUrlCache[id] = URL.createObjectURL(file);
    const item = { id: id, name: file.name, added: Date.now() };
    customWallpapers.push(item);
    return item;
  }catch(e){
    HENCORE.notify('Обои', 'Не удалось сохранить изображение.');
    return null;
  }
}

async function deleteCustomWallpaper(id){
  try{
    const db = await openWpDb();
    await new Promise(function(resolve, reject){
      const tx = db.transaction(WP_STORE, 'readwrite');
      tx.objectStore(WP_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = function(){ reject(tx.error); };
    });
  }catch(e){  }
  if (customUrlCache[id]){ URL.revokeObjectURL(customUrlCache[id]); delete customUrlCache[id]; }
  customWallpapers = customWallpapers.filter(function(w){ return w.id !== id; });
  if (settings.wallpaper === 'c:' + id){
    settings.wallpaper = 0;
    saveSettings();
    applyWallpaper();
  }
  refreshWpSection();
}

function applyWallpaper(){
  const w = settings.wallpaper;
  let url;
  if (typeof w === 'string' && w.indexOf('c:') === 0){
    url = customUrlCache[w.slice(2)] || WALLPAPERS[0];
  } else {
    url = WALLPAPERS[Number(w) || 0] || WALLPAPERS[0];
  }
  document.body.style.backgroundImage = 'url("' + url + '")';
}

const brightnessEl = document.createElement('div');
brightnessEl.className = 'hc-brightness';

function applyBrightness(){
  const b = Math.min(100, Math.max(30, Number(settings.brightness) || 100));
  brightnessEl.style.background = 'rgba(0,0,0,' + ((100 - b) / 115).toFixed(4) + ')';
}

let _pageVolume = Math.min(1, Math.max(0, Number(settings.volume) || 0));
const _appVolumes = new WeakMap();   

const _volumeDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');

(function patchMediaVolume(){
  if (!_volumeDesc || !_volumeDesc.set) return;
  Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
    enumerable: _volumeDesc.enumerable,
    configurable: true,
    get: function(){ return _volumeDesc.get.call(this); },
    set: function(v){
      const app = Math.min(1, Math.max(0, Number(v) || 0));
      if (isNaN(app)) return;
      _appVolumes.set(this, app);
      _volumeDesc.set.call(this, _pageVolume * app);
    }
  });
})();

function applyPageVolume(root){
  const doc = root || document;
  const list = doc.querySelectorAll('audio, video');
  for (let i = 0; i < list.length; i++){
    const m = list[i];
    if (!_appVolumes.has(m)) _appVolumes.set(m, m.volume);
    if (_volumeDesc && _volumeDesc.set){
      _volumeDesc.set.call(m, _pageVolume * _appVolumes.get(m));
    } else {
      m.volume = _pageVolume * _appVolumes.get(m);
    }
  }
   
  const frames = doc.querySelectorAll('iframe');
  for (let i = 0; i < frames.length; i++){
    try {
      const idoc = frames[i].contentDocument;
      if (idoc) applyPageVolume(idoc);
    } catch(e){}
  }
}

const _mediaObserver = new MutationObserver(function(){ applyPageVolume(); });
_mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('play', function(){ applyPageVolume(); }, true);

let zTop = 10;
let winId = 0;
const openWins = [];

function isBuiltin(app){ return !!app.builtin; }

function openApp(app){
  const existing = openWins.find(function(w){ return w.app === app; });
  if (existing){ restoreWin(existing); return; }
  createWindow(app);
}

const WIN_SVG = {
  min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  max: '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.7" y="2.7" width="6.6" height="6.6" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  restore: '<svg viewBox="0 0 12 12" aria-hidden="true">' +
    '<rect x="2.4" y="4.6" width="5.2" height="5" rx="0.7" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '<path d="M4.6 4.4V3.5c0-.44.36-.8.8-.8h3.1c.44 0 .8.36.8.8v3.1c0 .44-.36.8-.8.8h-.9" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
    '</svg>',
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 3.2L8.8 8.8 M8.8 3.2L3.2 8.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
};
(function injectWindowStyles(){
  const st = document.createElement('style');
  st.textContent = [
    '.win-btns button{ color:inherit; }',
    '.win-btns button svg{ width:17px; height:17px; display:block; pointer-events:none; }',
    '.win-rz{ position:absolute; z-index:6; touch-action:none; }',
    '.win-rz-n{ top:0; left:10px; right:10px; height:6px; cursor:ns-resize; }',
    '.win-rz-s{ bottom:0; left:10px; right:10px; height:6px; cursor:ns-resize; }',
    '.win-rz-e{ right:0; top:10px; bottom:10px; width:6px; cursor:ew-resize; }',
    '.win-rz-w{ left:0; top:10px; bottom:10px; width:6px; cursor:ew-resize; }',
    '.win-rz-ne{ top:0; right:0; width:14px; height:14px; cursor:nesw-resize; }',
    '.win-rz-nw{ top:0; left:0; width:14px; height:14px; cursor:nwse-resize; }',
    '.win-rz-se{ bottom:0; right:0; width:14px; height:14px; cursor:nwse-resize; }',
    '.win-rz-sw{ bottom:0; left:0; width:14px; height:14px; cursor:nesw-resize; }',
    '.window.maximized .win-rz{ display:none; }'
  ].join('\n');
  (document.head || document.body).appendChild(st);
})();

function createWindow(app){
  const id = 'win' + (++winId);

  const el = document.createElement('div');
  el.className = 'window';
  el.style.width  = (app.width  || 71) + '%';
  el.style.height = (app.height || 71) + '%';

  const head = document.createElement('div');
  head.className = 'win-header';
  head.innerHTML =
    '<div class="win-ic"></div>' +
    '<span class="win-title">' + escapeHtml(app.name) + '</span>' +
    '<div class="win-btns">' +
      '<button class="min" title="Свернуть"></button>' +
      '<button class="max" title="Развернуть"></button>' +
      '<button class="close" title="Закрыть"></button>' +
    '</div>';
  const ic = head.querySelector('.win-ic');
  if (isBuiltin(app)){
    ic.className = 'fb'; ic.textContent = '⚙';
  } else {
    const img = document.createElement('img');
    img.src = app.icon || '';
    img.onerror = function(){
      const fb = document.createElement('span');
      fb.className = 'fb';
      fb.textContent = app.name.charAt(0).toUpperCase();
      img.replaceWith(fb);
    };
    ic.replaceWith(img);
  }
  head.querySelector('.min').innerHTML = WIN_SVG.min;
  head.querySelector('.max').innerHTML = WIN_SVG.max;
  head.querySelector('.close').innerHTML = WIN_SVG.close;

  const body = document.createElement('div');
  body.className = 'win-body' + (isBuiltin(app) ? ' builtin' : '');
  if (isBuiltin(app)){
    buildSettingsUI(body);
  } else {
const frame = document.createElement('iframe');
frame.src = app.path;
frame.setAttribute('allow',
  'accelerometer; autoplay; camera; display-capture; encrypted-media; ' +
  'fullscreen; geolocation; gyroscope; microphone; midi; clipboard-read; ' +
  'clipboard-write; gamepad; hid; serial; usb; xr-spatial-tracking; ' +
  'screen-wake-lock; web-share; publickey-credentials-get; storage-access'
);
frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
frame.addEventListener('load', function(){ applyPageVolume(); });
body.appendChild(frame);
  }

  const rz = document.createElement('div');
  rz.className = 'win-resize';

  el.appendChild(head); el.appendChild(body); el.appendChild(rz);
  document.body.appendChild(el);

  const cw = el.offsetWidth || Math.round(innerWidth * (app.width || 71) / 100);
  const ch = el.offsetHeight || Math.round(innerHeight * (app.height || 71) / 100);
  el.style.left = Math.max(0, Math.round((innerWidth - cw) / 2)) + 'px';
  el.style.top  = Math.max(0, Math.round((innerHeight - ch) / 2)) + 'px';

  const win = { id: id, app: app, el: el, minimized: false, maximized: false, taskBtn: null };
  openWins.push(win);

  el.addEventListener('pointerdown', function(){ focusWin(win); });
  head.querySelector('.close').addEventListener('click', function(e){ e.stopPropagation(); closeWin(win); });
  head.querySelector('.min').addEventListener('click', function(e){ e.stopPropagation(); minimizeWin(win); });
  head.querySelector('.max').addEventListener('click', function(e){ e.stopPropagation(); toggleMax(win); });
  head.addEventListener('dblclick', function(e){
    if (e.target.closest('.win-btns')) return;
    toggleMax(win);
  });

  makeDraggable(win);
  makeResizable(win);

  renderTaskbar();
  focusWin(win);
}

function setMaxIcon(win){
  const b = win.el.querySelector('.max');
  if (!b) return;
  b.innerHTML = win.maximized ? WIN_SVG.restore : WIN_SVG.max;
  b.title = win.maximized ? 'Восстановить' : 'Развернуть';
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateTaskStates(){
  openWins.forEach(function(w){
    if (!w.taskBtn) return;
    w.taskBtn.classList.add('running');
    w.taskBtn.classList.toggle('active', w === activeWin && !w.minimized);
  });
}

function focusWin(win){
  win.el.style.zIndex = ++zTop;
  activeWin = win;
  updateTaskStates();
}

let activeWin = null;

function minimizeWin(win){
  win.minimized = true;
  win.el.style.display = 'none';
  updateTaskStates();
}

function restoreWin(win){
  win.minimized = false;
  win.el.style.display = 'flex';
  focusWin(win);
}

function closeWin(win){
  win.el.remove();
  const i = openWins.indexOf(win);
  if (i >= 0) openWins.splice(i, 1);
  if (win.el === openSettingsRoot) openSettingsRoot = null;
  renderTaskbar();
  if (activeWin && openWins.indexOf(activeWin) !== -1) focusWin(activeWin);
  else {
    const vis = openWins.filter(function(w){ return !w.minimized; });
    if (vis.length) focusWin(vis[vis.length - 1]);
    else { activeWin = null; updateTaskStates(); }
  }
}

function toggleMax(win){
  if (win.maximized){
    win.maximized = false;
    win.el.classList.remove('maximized');
    Object.assign(win.el.style, win.saved);
  } else {
    win.maximized = true;
    win.el.classList.add('maximized');
    win.saved = {
      left: win.el.style.left, top: win.el.style.top,
      width: win.el.style.width, height: win.el.style.height
    };
    Object.assign(win.el.style, { left:'0px', top:'0px', width:'100vw', height:'calc(100vh - 48px)' });
  }
  setMaxIcon(win);
}

function makeDraggable(win){
  const header = win.el.querySelector('.win-header');
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

  header.addEventListener('pointerdown', function(e){
    if (e.target.closest('.win-btns')) return;
    if (win.maximized) return;
    dragging = true;
    win.el.classList.add('hc-dragging');
    sx = e.clientX; sy = e.clientY;
    ox = win.el.offsetLeft; oy = win.el.offsetTop;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', function(e){
    if (!dragging) return;
    win.el.style.left = (ox + e.clientX - sx) + 'px';
    win.el.style.top  = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  function stop(){ dragging = false; win.el.classList.remove('hc-dragging'); }
  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);
}

const RZ_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function makeResizable(win){
  RZ_DIRS.forEach(function(dir){
    const h = document.createElement('div');
    h.className = 'hc-rz hc-rz-' + dir;
    win.el.appendChild(h);

    let sx = 0, sy = 0, base = null, resizing = false;

    h.addEventListener('pointerdown', function(e){
      if (win.maximized) return;
      resizing = true;
      win.el.classList.add('hc-resizing');
      sx = e.clientX; sy = e.clientY;
      const r = win.el.getBoundingClientRect();
      base = { left: r.left, top: r.top, w: r.width, h: r.height };
      h.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    h.addEventListener('pointermove', function(e){
      if (!resizing || !base) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      let left = base.left, top = base.top, w = base.w, ht = base.h;
      if (dir.indexOf('e') >= 0) w = Math.max(320, base.w + dx);
      if (dir.indexOf('s') >= 0) ht = Math.max(200, base.h + dy);
      if (dir.indexOf('w') >= 0){ w = Math.max(320, base.w - dx); left = base.left + (base.w - w); }
      if (dir.indexOf('n') >= 0){ ht = Math.max(200, base.h - dy); top = Math.max(0, base.top + (base.h - ht)); }
      win.el.style.left = left + 'px';
      win.el.style.top = top + 'px';
      win.el.style.width = w + 'px';
      win.el.style.height = ht + 'px';
    });
    function stop(){ resizing = false; base = null; win.el.classList.remove('hc-resizing'); }
    h.addEventListener('pointerup', stop);
    h.addEventListener('pointercancel', stop);
  });
}

const taskitems = document.getElementById('taskitems');

const PINNED_KEY = 'hencore_os_pinned_v1';

let pinnedApps = (function(){
  try{
    const raw = JSON.parse(localStorage.getItem(PINNED_KEY));
    if (Array.isArray(raw)) return raw.filter(function(n){ return typeof n === 'string'; });
  }catch(e){}
  return [];
})();

function savePinned(){
  try{ localStorage.setItem(PINNED_KEY, JSON.stringify(pinnedApps)); }catch(e){}
}

function isPinned(app){
  return pinnedApps.indexOf(app.name) !== -1;
}

function togglePinApp(app){
  if (isPinned(app)){
    pinnedApps = pinnedApps.filter(function(n){ return n !== app.name; });
  } else {
    pinnedApps.push(app.name);
    if (pinnedApps.length > 24) pinnedApps.shift();
  }
  savePinned();
  renderTaskbar();
}

function createTaskBtn(app, win){
  const btn = document.createElement('button');
  btn.className = 'task-item' + (win ? ' running' : '');
  btn.title = app.name;
  btn.innerHTML =
    (isBuiltin(app) ? '<span class="fb">⚙</span>' : '<img src="' + (app.icon || '') + '" alt="">');
  const img = btn.querySelector('img');
  if (img) img.onerror = function(){
    const fb = document.createElement('span');
    fb.className = 'fb';
    fb.textContent = app.name.charAt(0).toUpperCase();
    img.replaceWith(fb);
  };
  btn._app = app;
  if (win){
    btn._win = win;
    win.taskBtn = btn;
    btn.addEventListener('click', function(){
      if (win.minimized) restoreWin(win);
      else if (activeWin === win) minimizeWin(win);
      else focusWin(win);
    });
  } else {
    btn.addEventListener('click', function(){ openApp(app); });
  }
  btn.addEventListener('contextmenu', function(e){
    e.preventDefault();
    e.stopPropagation();
    showCtxMenu(e.clientX, e.clientY, [
      isPinned(app)
        ? { label: 'Открепить от панели задач', action: function(){ togglePinApp(app); } }
        : { label: 'Закрепить на панели задач', action: function(){ togglePinApp(app); } }
    ]);
  });
  return btn;
}

function renderTaskbar(){
  if (!taskitems) return;
  taskitems.innerHTML = '';
  const runningNames = openWins.map(function(w){ return w.app.name; });
  openWins.forEach(function(w){
    taskitems.appendChild(createTaskBtn(w.app, w));
  });
  pinnedApps.forEach(function(name){
    if (runningNames.indexOf(name) !== -1) return;
    const app = findAppByName(name);
    if (app) taskitems.appendChild(createTaskBtn(app, null));
  });
  updateTaskStates();
}

let hcCtxMenu = null;

function showCtxMenu(x, y, items){
  hideCtxMenu();
  const m = document.createElement('div');
  m.className = 'hc-ctx-menu';
  items.forEach(function(it){
    const b = document.createElement('button');
    b.textContent = it.label;
    b.addEventListener('click', function(e){
      e.stopPropagation();
      hideCtxMenu();
      it.action();
    });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top  = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  hcCtxMenu = m;
}

function hideCtxMenu(){
  if (hcCtxMenu){ hcCtxMenu.remove(); hcCtxMenu = null; }
}

document.addEventListener('pointerdown', function(e){
  if (hcCtxMenu && !hcCtxMenu.contains(e.target)) hideCtxMenu();
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') hideCtxMenu();
});

(function injectTaskbarStyles(){
  const st = document.createElement('style');
  st.textContent = [
    '.task-item{position:relative}',
    '.task-item.running{background:var(--hc-hover,rgba(255,255,255,.09))}',
    '.task-item.active{background:var(--hc-hover,rgba(255,255,255,.16))}',
    '.task-item.active::after{content:"";position:absolute;left:50%;bottom:2px;width:16px;height:3px;',
      'border-radius:3px;background:var(--accent,#4cc2ff);transform:translateX(-50%)}',
    '.hc-ctx-menu{position:fixed;z-index:99999;min-width:190px;padding:6px;display:flex;',
      'flex-direction:column;gap:2px;background:var(--hc-panel,#1b1e24);',
      'border:1px solid var(--hc-border,#2e3440);border-radius:10px;',
      'box-shadow:0 10px 30px var(--hc-shadow,rgba(0,0,0,.5))}',
    '.hc-ctx-menu button{all:unset;cursor:pointer;color:var(--hc-text,#e8eaed);',
      'font-size:13px;padding:7px 12px;border-radius:7px;white-space:nowrap}',
    '.hc-ctx-menu button:hover{background:var(--hc-hover,rgba(255,255,255,.1))}',
    '.sm-app.hc-dragging{opacity:.5;outline:1px dashed var(--accent,#4cc2ff)}',
    '#desktop.hc-drop{outline:2px dashed var(--accent,#4cc2ff);outline-offset:-6px}'
  ].join('\n');
  (document.head || document.body).appendChild(st);
})();

const clockEl = document.getElementById('clock');
function tick(){
  const d = new Date();
  const pad = function(n){ return String(n).padStart(2, '0'); };
  clockEl.innerHTML = pad(d.getHours()) + ':' + pad(d.getMinutes()) + '<br>' +
    pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
}
setInterval(tick, 1000);
tick();


(function initCalendar(){
  if (!clockEl) return;

  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  const calPop = document.createElement('div');
  calPop.className = 'hc-pop hc-cal-pop';
  document.body.appendChild(calPop);

  let view = null; 

  function renderCalendar(){
    const now = new Date();
    if (!view) view = { y: now.getFullYear(), m: now.getMonth() };

    const startIdx = (new Date(view.y, view.m, 1).getDay() + 6) % 7;          
    const daysIn   = new Date(view.y, view.m + 1, 0).getDate();
    const prevDays = new Date(view.y, view.m, 0).getDate();

    let cells = '';
    for (let i = startIdx - 1; i >= 0; i--)
      cells += '<span class="hc-cal-day other">' + (prevDays - i) + '</span>';
    for (let d = 1; d <= daysIn; d++){
      const today = (d === now.getDate() && view.m === now.getMonth() && view.y === now.getFullYear());
      cells += '<span class="hc-cal-day' + (today ? ' today' : '') + '">' + d + '</span>';
    }
    const rest = (7 - (startIdx + daysIn) % 7) % 7;
    for (let d = 1; d <= rest; d++)
      cells += '<span class="hc-cal-day other">' + d + '</span>';

    calPop.innerHTML =
      '<div class="hc-pop-title hc-cal-head">' +
        '<button class="hc-cal-nav" data-dir="-1">\u2039</button>' +
        '<span>' + MONTHS[view.m] + ' ' + view.y + '</span>' +
        '<button class="hc-cal-nav" data-dir="1">\u203A</button>' +
      '</div>' +
      '<div class="hc-cal-week">' + WEEK.map(function(w){ return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="hc-cal-grid">' + cells + '</div>';

    calPop.querySelectorAll('.hc-cal-nav').forEach(function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        view.m += Number(b.dataset.dir);
        if (view.m < 0){ view.m = 11; view.y--; }
        if (view.m > 11){ view.m = 0; view.y++; }
        renderCalendar();
      });
    });
  }

  function placeCalendar(){
    const r = clockEl.getBoundingClientRect();
    const bar = document.querySelector('.taskbar');
    const barH = bar ? bar.offsetHeight : 48;
    calPop.style.right = Math.max(8, Math.round(innerWidth - r.right)) + 'px';
    calPop.style.bottom = (barH + 10) + 'px';
  }

  clockEl.addEventListener('click', function(e){
    e.stopPropagation();
    const wasOpen = calPop.classList.contains('open');
    closeAllPops();
    if (!wasOpen){
      view = null;           
      renderCalendar();
      placeCalendar();
      calPop.classList.add('open');
    }
  });

  window.addEventListener('resize', function(){
    if (calPop.classList.contains('open')) placeCalendar();
  });
})();

const TRAY_SVG = {
  sun: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  vol: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="hc-vol-waves" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg>',
  volMute: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 5M21 9l-5 5"/></svg>',
  bat: '<svg viewBox="0 0 24 24" width="19" height="19"><rect x="2" y="7.5" width="17" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="20.5" y="10.5" width="2.5" height="3" rx="0.8" fill="currentColor"/><rect id="hc-bat-fill" x="4" y="9.5" width="13" height="5" rx="0.6" fill="currentColor"/><path id="hc-bat-bolt" d="M11.2 9.2 9 12.6h2.2l-.4 2.6 2.6-3.6h-2.3z" fill="#fbbf24" style="display:none"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>'
};

function iconBtn(svg, title){
  const b = document.createElement('button');
  b.className = 'hc-tray-btn';
  b.title = title;
  b.innerHTML = svg;
  return b;
}

function makePopover(titleText){
  const pop = document.createElement('div');
  pop.className = 'hc-pop';
  pop.innerHTML = '<div class="hc-pop-title">' + titleText + '</div>';
  return pop;
}

const tray = document.createElement('div');
tray.className = 'hc-tray';
tray.id = 'hc-tray';

let trayBriSlider = null, trayBriVal = null;
let trayVolSlider = null, trayVolVal = null;
let trayVolBtn = null;
let trayBatBtn = null, trayBatFill = null, trayBatBolt = null, trayBatInfo = null;
let trayBellBtn = null, trayBellBadge = null, notifList = null, notifCount = null;

function initTray(){
   
  const briWrap = document.createElement('div');
  briWrap.className = 'hc-tray-item';
  const briBtn = iconBtn(TRAY_SVG.sun, 'Яркость');
  const briPop = makePopover('Яркость экрана');
  briPop.innerHTML +=
    '<div class="hc-pop-row"><input type="range" class="hc-slider hc-bri-slider" min="30" max="100" value="' + settings.brightness + '">' +
    '<span class="hc-pop-val">100%</span></div>';
  briWrap.appendChild(briBtn); briWrap.appendChild(briPop);
  trayBriSlider = briPop.querySelector('input');
  trayBriVal = briPop.querySelector('.hc-pop-val');
  trayBriSlider.addEventListener('input', function(){ setBrightness(Number(this.value), this); });
  bindTrayToggle(briBtn, briPop);
  tray.appendChild(briWrap);

  const volWrap = document.createElement('div');
  volWrap.className = 'hc-tray-item';
  const volBtn = iconBtn(TRAY_SVG.vol, 'Громкость');
  const volPop = makePopover('Громкость');
  volPop.innerHTML +=
    '<div class="hc-pop-row"><input type="range" class="hc-slider hc-vol-slider" min="0" max="100" value="' + Math.round(settings.volume * 100) + '">' +
    '<span class="hc-pop-val">100%</span></div>';
  volWrap.appendChild(volBtn); volWrap.appendChild(volPop);
  trayVolBtn = volBtn;
  trayVolSlider = volPop.querySelector('input');
  trayVolVal = volPop.querySelector('.hc-pop-val');
  trayVolSlider.addEventListener('input', function(){ setVolume(Number(this.value) / 100, this); });
  bindTrayToggle(volBtn, volPop);
  tray.appendChild(volWrap);
  updateVolumeUI();

  const batWrap = document.createElement('div');
  batWrap.className = 'hc-tray-item';
  const batBtn = iconBtn(TRAY_SVG.bat, 'Батарея');
  const batPop = makePopover('Батарея');
  batPop.innerHTML += '<div class="hc-pop-text">Данные недоступны</div>';
  batWrap.appendChild(batBtn); batWrap.appendChild(batPop);
  trayBatBtn = batBtn;
  trayBatFill = batBtn.querySelector('#hc-bat-fill');
  trayBatBolt = batBtn.querySelector('#hc-bat-bolt');
  trayBatInfo = batPop.querySelector('.hc-pop-text');
  bindTrayToggle(batBtn, batPop);
  tray.appendChild(batWrap);
  initBattery();

  const bellWrap = document.createElement('div');
  bellWrap.className = 'hc-tray-item hc-bell-wrap';
  const bellBtn = iconBtn(TRAY_SVG.bell, 'Уведомления');
  const badge = document.createElement('span');
  badge.className = 'hc-badge';
  badge.style.display = 'none';
  bellBtn.appendChild(badge);
  const bellPop = document.createElement('div');
  bellPop.className = 'hc-pop hc-notif-pop';
  bellPop.innerHTML =
    '<div class="hc-pop-title hc-notif-head"><span>Уведомления <span class="hc-notif-count"></span></span>' +
    '<button class="hc-clear">Очистить</button></div>' +
    '<div class="hc-notif-list"><div class="hc-notif-empty">Пока пусто</div></div>';
  bellWrap.appendChild(bellBtn); bellWrap.appendChild(bellPop);
  trayBellBtn = bellBtn;
  trayBellBadge = badge;
  notifList = bellPop.querySelector('.hc-notif-list');
  notifCount = bellPop.querySelector('.hc-notif-count');
  bellPop.querySelector('.hc-clear').addEventListener('click', function(e){
    e.stopPropagation();
    notifications.length = 0;
    unreadCount = 0;
    updateBellBadge();
    renderNotifications();
  });
  bindTrayToggle(bellBtn, bellPop);
  tray.appendChild(bellWrap);

  const fps = document.createElement('span');
  fps.className = 'hc-fps';
  fps.id = 'hc-fps';
  fps.title = 'Кадров в секунду';
  fps.textContent = '– fps';
  tray.appendChild(fps);

  if (clockEl && clockEl.parentNode) clockEl.parentNode.insertBefore(tray, clockEl);
}

function bindTrayToggle(btn, pop){
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    const wasOpen = pop.classList.contains('open');
    closeAllPops();
    if (!wasOpen) pop.classList.add('open');
  });
}

function closeAllPops(){
  document.querySelectorAll('.hc-pop.open').forEach(function(p){ p.classList.remove('open'); });
}

function setBrightness(v, src){
  settings.brightness = Math.min(100, Math.max(30, v));
  saveSettings();
  applyBrightness();
  syncSliders('bri', Math.round(settings.brightness), src);
}

function setVolume(v, src){
  settings.volume = Math.min(1, Math.max(0, v));
  _pageVolume = settings.volume;
  applyPageVolume();
  saveSettings();
  updateVolumeUI();
  syncSliders('vol', Math.round(settings.volume * 100), src);
}

function syncSliders(kind, value, src){
  const sel = kind === 'bri' ? '.hc-bri-slider' : '.hc-vol-slider';
  document.querySelectorAll(sel).forEach(function(s){
    if (s !== src) s.value = value;
    const lbl = s.parentNode.querySelector('.hc-pop-val, .st-val');
    if (lbl) lbl.textContent = value + '%';
  });
  updateVolumeUI();
}

function updateVolumeUI(){
  if (trayVolBtn) trayVolBtn.innerHTML = (settings.volume === 0 ? TRAY_SVG.volMute : TRAY_SVG.vol);
}

function initBattery(){
  if (!navigator.getBattery){
    if (trayBatInfo) trayBatInfo.textContent = 'Браузер не сообщает уровень батареи.';
    if (trayBatBtn) trayBatBtn.style.opacity = '0.35';
    return;
  }
  navigator.getBattery().then(function(b){
    function update(){
      const lvl = Math.round(b.level * 100);
      if (trayBatFill) trayBatFill.setAttribute('width', String(13 * b.level));
      if (trayBatBolt) trayBatBolt.style.display = b.charging ? '' : 'none';
      if (trayBatBtn){
        trayBatBtn.style.color = (!b.charging && lvl <= 20) ? '#ef4444' : '';
      }
      if (trayBatInfo){
        trayBatInfo.innerHTML = '<b>' + lvl + '%</b> — ' + (b.charging ? 'заряжается' : 'от батареи');
      }
      if (!b.charging && lvl <= 20 && !b._warned){
        b._warned = true;
        HENCORE.notify('Батарея', 'Заряд ниже 20% — подключите питание.');
      }
      if (b.charging) b._warned = false;
    }
    update();
    b.addEventListener('levelchange', update);
    b.addEventListener('chargingchange', update);
  }).catch(function(){});
}

let fpsFrames = 0, fpsLast = performance.now();
function fpsLoop(t){
  fpsFrames++;
  if (t - fpsLast >= 1000){
    const v = Math.round(fpsFrames * 1000 / (t - fpsLast));
    fpsFrames = 0; fpsLast = t;
    const el = document.getElementById('hc-fps');
    if (el) el.textContent = v + ' fps';
  }
  requestAnimationFrame(fpsLoop);
}
requestAnimationFrame(fpsLoop);

const notifications = [];
let unreadCount = 0;

function updateBellBadge(){
  if (!trayBellBadge) return;
  trayBellBadge.style.display = unreadCount > 0 ? '' : 'none';
  trayBellBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
}

function renderNotifications(){
  if (!notifList) return;
  notifCount.textContent = notifications.length ? '(' + notifications.length + ')' : '';
  if (!notifications.length){
    notifList.innerHTML = '<div class="hc-notif-empty">Пока пусто</div>';
    return;
  }
  
  notifList.innerHTML = '';
  notifications.slice(0, 30).forEach(function(n){
    const d = document.createElement('div');
    d.className = 'hc-notif' + (n.unread ? ' unread' : '');
    const t = new Date(n.t);
    d.innerHTML = '<div class="hc-notif-title">' + escapeHtml(n.title) + '</div>' +
      '<div class="hc-notif-text">' + escapeHtml(n.text) + '</div>' +
      '<div class="hc-notif-time">' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + '</div>';
    d.addEventListener('click', function(){ n.unread = false; if (unreadCount > 0) unreadCount--; updateBellBadge(); d.classList.remove('unread'); });
    notifList.appendChild(d);
  });
}

const toastsEl = document.createElement('div');
toastsEl.className = 'hc-toasts';

function showToast(title, text){
  const t = document.createElement('div');
  t.className = 'hc-toast';
  t.innerHTML = '<div class="hc-notif-title">' + escapeHtml(title) + '</div>' +
    '<div class="hc-notif-text">' + escapeHtml(text) + '</div>';
  toastsEl.appendChild(t);
  setTimeout(function(){
    t.classList.add('out');
    setTimeout(function(){ t.remove(); }, 350);
  }, 4000);
}

window.HENCORE = {
  notify: function(title, text){
    notifications.unshift({ t: Date.now(), title: title || 'Уведомление', text: text || '', unread: true });
    if (notifications.length > 50) notifications.length = 50;
    unreadCount = Math.min(unreadCount + 1, 99);
    updateBellBadge();
    renderNotifications();
    showToast(title, text);
  }
};

document.addEventListener('pointerdown', function(e){
  if (!e.target.closest('.hc-tray') && !e.target.closest('.hc-cal-pop')) closeAllPops();
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') closeAllPops();
});

const desktop = document.getElementById('desktop');

const BUILTIN_SETTINGS = { name: 'Настройки', builtin: 'settings', icon: '' };

const startmenu = document.getElementById('startmenu');
const startbtn  = document.getElementById('startbtn');
const smGrid    = document.getElementById('sm-grid');
const smSearch  = document.getElementById('sm-search-input');

function buildStartMenu(filter){
  smGrid.innerHTML = '';
  const q = (filter || '').trim().toLowerCase();
  const items = APPS.concat([BUILTIN_SETTINGS]).filter(function(a){
    return a.name.toLowerCase().includes(q);
  });
  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'sm-empty';
    empty.textContent = 'Ничего не найдено';
    smGrid.appendChild(empty);
    return;
  }
  items.forEach(function(app){
    const d = document.createElement('div');
    d.className = 'sm-app';
    if (isBuiltin(app)){
      d.innerHTML = '<div class="fallback">⚙</div><span>' + escapeHtml(app.name) + '</span>';
    } else {
      const img = document.createElement('img');
      img.src = app.icon || '';
      img.onerror = function(){
        const fb = document.createElement('div');
        fb.className = 'fallback';
        fb.textContent = app.name.charAt(0).toUpperCase();
        img.replaceWith(fb);
      };
      const lbl = document.createElement('span');
      lbl.textContent = app.name;
      d.appendChild(img); d.appendChild(lbl);
    }
    d.addEventListener('click', function(){ toggleStartMenu(false); openApp(app); });
    d.draggable = true;
    d.addEventListener('dragstart', function(e){
      if (e.dataTransfer){
        e.dataTransfer.setData('text/hencore-app', app.name);
        e.dataTransfer.effectAllowed = 'copy';
      }
      d.classList.add('hc-dragging');
    });
    d.addEventListener('dragend', function(){ d.classList.remove('hc-dragging'); });
    smGrid.appendChild(d);
  });
}

function toggleStartMenu(force){
  const show = force !== undefined ? force : startmenu.classList.contains('hidden');
  startmenu.classList.toggle('hidden', !show);
  startbtn.classList.toggle('open', show);
  if (show){ smSearch.value = ''; buildStartMenu(''); smSearch.focus(); }
}

startbtn.addEventListener('click', function(e){ e.stopPropagation(); toggleStartMenu(); });
smSearch.addEventListener('input', function(){ buildStartMenu(smSearch.value); });
smSearch.addEventListener('keydown', function(e){
  if (e.key === 'Enter'){
    const first = smGrid.querySelector('.sm-app');
    if (first) first.click();
  }
});
document.getElementById('sm-power').addEventListener('click', function(){ location.reload(); });

document.addEventListener('pointerdown', function(e){
  if (!startmenu.classList.contains('hidden') &&
      !startmenu.contains(e.target) && !startbtn.contains(e.target)){
    toggleStartMenu(false);
  }
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && !startmenu.classList.contains('hidden')) toggleStartMenu(false);
});

let openSettingsRoot = null;

function buildSettingsUI(root){
  openSettingsRoot = root;
  root.innerHTML =
    '<div class="st-title">Настройки</div>' +
    '<div class="st-sub">Персонализация HENCORE OS Portable</div>' +

    '<div class="st-section"><h3>Тема оформления</h3>' +
      '<div class="seg" id="st-theme">' +
        '<button data-v="dark">Тёмная</button>' +
        '<button data-v="light">Светлая</button>' +
      '</div>' +
    '</div>' +

    '<div class="st-section"><h3>Цвет системы</h3>' +
      '<div class="st-row" id="st-swatches"></div>' +
      '<div class="st-row"><label style="font-size:12.5px">Свой цвет:</label>' +
        '<input type="color" id="st-color" value="' + settings.accent + '">' +
        '<button class="st-btn" id="st-reset-accent">Сбросить</button>' +
      '</div>' +
    '</div>' +

    '<div class="st-section"><h3>Обои рабочего стола</h3>' +
      '<div class="st-row" id="st-wps"></div>' +
      '<div class="st-row">' +
        '<label class="st-btn st-file"><input type="file" id="st-wp-file" accept="image/*" multiple>Загрузить обои</label>' +
      '</div>' +
      '<div class="st-hint">Всего можно добавить до ' + CUSTOM_WP_MAX + ' своих обоев.</div>' +
    '</div>' +

    '<div class="st-section"><h3>Экран</h3>' +
      '<div class="st-row"><label style="font-size:12.5px">Яркость:</label>' +
        '<input type="range" class="hc-bri-slider" min="30" max="100" value="' + settings.brightness + '">' +
        '<span class="st-val" style="font-size:12px; width:36px">' + settings.brightness + '%</span>' +
      '</div>' +
      '<div class="st-hint"> </div>' +
    '</div>' +

    '<div class="st-section"><h3>Громкость</h3>' +
      '<div class="st-row"><label style="font-size:12.5px">Громкость страницы:</label>' +
        '<input type="range" class="hc-vol-slider" min="0" max="100" value="' + Math.round(settings.volume * 100) + '">' +
        '<span class="st-val" style="font-size:12px; width:36px">' + Math.round(settings.volume * 100) + '%</span>' +
      '</div>' +
      '<div class="st-hint">Регулятор управляет громкостью всех звуков страницы.</div>' +
    '</div>' +

    '<div class="st-section"><h3>Система</h3>' +
      '<div class="st-row">' +
        '<button class="st-btn accent" id="st-resetall">Сбросить устройство</button>' +
      '</div>' +
      '<div class="st-hint"></div>' +
    '</div>';

  const seg = root.querySelector('#st-theme');
  seg.querySelectorAll('button').forEach(function(b){
    b.classList.toggle('on', b.dataset.v === settings.theme);
    b.addEventListener('click', function(){
      settings.theme = b.dataset.v;
      saveSettings(); applySettings();
      seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x === b); });
    });
  });

  const swRow = root.querySelector('#st-swatches');
  ACCENT_PRESETS.forEach(function(c){
    const s = document.createElement('button');
    s.className = 'swatch' + (c.toLowerCase() === settings.accent.toLowerCase() ? ' on' : '');
    s.style.background = c;
    s.addEventListener('click', function(){
      settings.accent = c;
      saveSettings(); applySettings();
      swRow.querySelectorAll('.swatch').forEach(function(x){ x.classList.toggle('on', x === s); });
      root.querySelector('#st-color').value = c;
    });
    swRow.appendChild(s);
  });
  root.querySelector('#st-color').addEventListener('input', function(e){
    settings.accent = e.target.value;
    saveSettings(); applySettings();
    swRow.querySelectorAll('.swatch').forEach(function(x){ x.classList.remove('on'); });
  });
  root.querySelector('#st-reset-accent').addEventListener('click', function(){
    settings.accent = DEFAULTS.accent;
    saveSettings(); applySettings();
    root.querySelector('#st-color').value = DEFAULTS.accent;
    swRow.querySelectorAll('.swatch').forEach(function(x){
      x.classList.toggle('on', (x.style.background || '').toLowerCase().includes(DEFAULTS.accent));
    });
  });

  buildWallpaperThumbs(root);
  const fileInput = root.querySelector('#st-wp-file');
  fileInput.addEventListener('change', function(){
    const files = Array.from(this.files || []);
    this.value = '';
    (async function(){
      let last = null;
      for (let i = 0; i < files.length; i++){
        last = await addCustomWallpaper(files[i]);
        if (!last) break;
      }
      if (last){
        settings.wallpaper = 'c:' + last.id;
        saveSettings(); applyWallpaper();
      }
      refreshWpSection();
    })();
  });

  const bri = root.querySelector('.hc-bri-slider');
  bri.addEventListener('input', function(){ setBrightness(Number(this.value), this); });

  const vol = root.querySelector('.hc-vol-slider');
  vol.addEventListener('input', function(){ setVolume(Number(this.value) / 100, this); });

  root.querySelector('#st-resetall').addEventListener('click', async function(){
    if (!confirm('Сбросить устройство к заводским настройкам? Все данные будут удалены безвозвратно.')) return;

    localStorage.clear();
    sessionStorage.clear();

    try {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(db => new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(db.name);

        request.onsuccess = () => {
          console.log(`База ${db.name} успешно удалена.`);
          resolve();
        };

        request.onerror = (e) => {
          console.error(`Ошибка при удалении базы ${db.name}:`, e.target.error);
          resolve(); 
        };

        request.onblocked = () => {
          
          console.warn(`База ${db.name} заблокирована. Закройте другие вкладки с этой ОС.`);
          resolve(); 
        };
      })));

      location.reload();
    } catch (e) {
      console.error('Критическая ошибка при очистке IndexedDB:', e);
      alert('Не удалось полностью очистить данные. Проверьте консоль (F12).');
    }
  });
}

function refreshWpSection(){
  if (!openSettingsRoot || !document.body.contains(openSettingsRoot)) return;
  const row = openSettingsRoot.querySelector('#st-wps');
  if (row) buildWallpaperThumbs(openSettingsRoot);
}

function buildWallpaperThumbs(root){
  const row = root.querySelector('#st-wps');
  if (!row) return;
  row.innerHTML = '';

  WALLPAPERS.forEach(function(wp, i){
    const t = document.createElement('div');
    t.style.backgroundImage = 'url("' + wp + '")';
    t.className = 'wp-thumb' + (settings.wallpaper === i ? ' on' : '');
    t.title = 'Встроенные: ' + wp;
    const probe = new Image();
    probe.onerror = function(){
      t.classList.add('wp-missing');
      t.style.backgroundImage = 'none';
      t.textContent = 'Файл не найден: ' + wp;
    };
    probe.src = wp;
    t.addEventListener('click', function(){
      settings.wallpaper = i;
      saveSettings(); applyWallpaper();
      row.querySelectorAll('.wp-thumb').forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on');
    });
    row.appendChild(t);
  });

  customWallpapers.forEach(function(it){
    const t = document.createElement('div');
    t.className = 'wp-thumb wp-custom' + (settings.wallpaper === 'c:' + it.id ? ' on' : '');
    t.title = it.name;
    const url = customUrlCache[it.id];
    if (url) t.style.backgroundImage = 'url("' + url + '")';
    else t.classList.add('wp-missing'), t.textContent = 'Нет данных';

    const del = document.createElement('button');
    del.className = 'wp-del';
    del.title = 'Удалить';
    del.innerHTML = WIN_SVG.close;
    del.addEventListener('click', function(e){
      e.stopPropagation();
      deleteCustomWallpaper(it.id);
    });
    t.appendChild(del);

    t.addEventListener('click', function(){
      settings.wallpaper = 'c:' + it.id;
      saveSettings(); applyWallpaper();
      row.querySelectorAll('.wp-thumb').forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on');
    });
    row.appendChild(t);
  });
}

function injectSystemStyles(){
  const css = [
     
    'html[data-theme="dark"]{',
      '--hc-panel:#1b1e24; --hc-panel2:#22262e; --hc-border:#2e3440;',
      '--hc-text:#e8eaed; --hc-dim:#9aa0a6; --hc-hover:rgba(255,255,255,.10);',
      '--hc-input:#2a2f38; --hc-shadow:rgba(0,0,0,.5);',
    '}',
    'html[data-theme="light"]{',
      '--hc-panel:#f5f6f8; --hc-panel2:#ffffff; --hc-border:#d6d9e0;',
      '--hc-text:#202124; --hc-dim:#5f6368; --hc-hover:rgba(0,0,0,.07);',
      '--hc-input:#000000; --hc-shadow:rgba(0,0,0,.18);',
    '}',

    'html[data-theme="light"] .window{background:#f5f6f8!important;border-color:#d6d9e0!important;color:#202124!important;box-shadow:0 18px 50px rgba(0,0,0,.25)!important}',
    'html[data-theme="light"] .win-header{color:#202124!important;border-bottom-color:#d6d9e0!important}',
    'html[data-theme="light"] .win-title{color:#202124!important}',
    'html[data-theme="light"] .win-btns button{color:#5f6368!important;background:transparent!important}',
    'html[data-theme="light"] .win-btns button:hover{background:rgba(0,0,0,.09)!important}',
    'html[data-theme="light"] .win-btns .close:hover{background:#e81123!important;color:#fff!important}',
    'html[data-theme="light"] .win-body.builtin{background:#f5f6f8!important;color:#202124!important}',

    'html[data-theme="light"] .startmenu{background:#fbfbfd!important;border-color:#d6d9e0!important;color:#202124!important}',
    'html[data-theme="light"] .sm-app{color:#202124!important}',
    'html[data-theme="light"] .sm-app:hover{background:rgba(0,0,0,.06)!important}',
    'html[data-theme="light"] .sm-empty{color:#5f6368!important}',
    'html[data-theme="light"] #sm-search-input{background:#fff!important;color:#202124!important;border-color:#d6d9e0!important}',
    'html[data-theme="light"] .app-icon span{color:#f0f0f0!important;text-shadow:none!important}',
    'html[data-theme="light"] .app-icon .active{outline-color:var(--accent)}',
    'html[data-theme="light"] .fb,html[data-theme="light"] .fallback{background:#e3e6ec!important;color:#3c4043!important}',

    'html[data-theme="light"] .st-title{color:#202124!important}',
    'html[data-theme="light"] .st-sub,html[data-theme="light"] .st-hint{color:#5f6368!important}',
    'html[data-theme="light"] .st-section h3{color:#202124!important}',
    'html[data-theme="light"] .st-section{background:#fff!important;border-color:#e2e5ea!important}',
    'html[data-theme="light"] .st-btn{background:#e8eaf0!important;color:#202124!important;border-color:#d6d9e0!important}',
    'html[data-theme="light"] .st-btn:hover{background:#dde0e8!important}',
    'html[data-theme="light"] .st-btn.accent{background:var(--accent)!important;color:#fff!important;border-color:transparent!important}',
    'html[data-theme="light"] .seg button{background:#eef0f4!important;color:#202124!important;border-color:#d6d9e0!important}',
    'html[data-theme="light"] .seg button.on{background:var(--accent)!important;color:#fff!important}',
    'html[data-theme="light"] .st-check{color:#202124!important}',
    'html[data-theme="light"] .swatch{border-color:#d6d9e0!important}',
    'html[data-theme="light"] .wp-missing{background:#eef0f4!important;color:#5f6368!important}',
    'html[data-theme="light"] .hc-slider{accent-color:var(--accent)}',

    '.hc-tray{display:flex;align-items:center;gap:2px;margin-right:10px}',
    '.hc-tray-item{position:relative}',
    '.hc-tray-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:34px;border:none;background:transparent;color:inherit;cursor:pointer;border-radius:6px}',
    '.hc-tray-btn:hover{background:var(--hc-hover)}',
    '.hc-fps{font-size:11px;opacity:.75;margin-right:10px;font-variant-numeric:tabular-nums;user-select:none}',

    '.hc-pop{position:absolute;bottom:calc(100% + 10px);right:0;min-width:230px;padding:12px 14px;',
      'background:var(--hc-panel);border:1px solid var(--hc-border);border-radius:10px;color:var(--hc-text);',
      'box-shadow:0 14px 40px var(--hc-shadow);display:none;z-index:2147482000}',
    '.hc-pop.open{display:block}',
    '.hc-pop-title{font-size:12px;font-weight:600;margin-bottom:10px;opacity:.85}',
    '.hc-pop-row{display:flex;align-items:center;gap:10px}',
    '.hc-slider{flex:1;accent-color:var(--accent)}',
    '.hc-pop-val{font-size:12px;min-width:38px;text-align:right;opacity:.8}',
    '.hc-pop-text{font-size:13px;white-space:nowrap}',

    '.hc-notif-pop{min-width:280px;max-height:340px;display:none;flex-direction:column}',
    '.hc-notif-pop.open{display:flex}',
    '.hc-notif-head{display:flex;justify-content:space-between;align-items:center}',
    '.hc-clear{border:none;background:transparent;color:var(--accent);font-size:12px;cursor:pointer;padding:2px 4px;border-radius:4px}',
    '.hc-clear:hover{background:var(--hc-hover)}',
    '.hc-notif-list{overflow-y:auto;display:flex;flex-direction:column;gap:6px;max-height:260px}',
    '.hc-notif-empty{font-size:12.5px;color:var(--hc-dim);text-align:center;padding:16px 0}',
    '.hc-notif{padding:8px 10px;border-radius:8px;background:var(--hc-panel2);border:1px solid var(--hc-border);cursor:default}',
    '.hc-notif.unread{border-left:3px solid var(--accent)}',
    '.hc-notif-title{font-size:12.5px;font-weight:600;color:var(--hc-text)}',
    '.hc-notif-text{font-size:12px;color:var(--hc-dim);margin-top:2px}',
    '.hc-notif-time{font-size:10.5px;color:var(--hc-dim);opacity:.7;margin-top:4px}',
    '.hc-badge{position:absolute;top:2px;right:2px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;',
      'background:#ef4444;color:#fff;font-size:10px;line-height:15px;text-align:center;font-weight:600}',
    '.hc-toasts{position:fixed;right:14px;bottom:60px;display:flex;flex-direction:column;gap:8px;z-index:2147482000}',
    '.hc-toast{min-width:240px;max-width:320px;padding:10px 14px;border-radius:10px;',
      'background:var(--hc-panel);border:1px solid var(--hc-border);color:var(--hc-text);',
      'box-shadow:0 14px 40px var(--hc-shadow);animation:hc-in .25s ease}',
    '.hc-toast.out{opacity:0;transform:translateX(20px);transition:.3s ease}',
    '@keyframes hc-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}',

    '.hc-brightness{position:fixed;inset:0;pointer-events:none;z-index:2147483000;transition:background .15s ease}',

    '.hc-rz{position:absolute;z-index:6;touch-action:none}',
    '.hc-rz-n{top:-3px;left:10px;right:10px;height:6px;cursor:ns-resize}',
    '.hc-rz-s{bottom:-3px;left:10px;right:10px;height:6px;cursor:ns-resize}',
    '.hc-rz-e{right:-3px;top:10px;bottom:10px;width:6px;cursor:ew-resize}',
    '.hc-rz-w{left:-3px;top:10px;bottom:10px;width:6px;cursor:ew-resize}',
    '.hc-rz-ne{top:-4px;right:-4px;width:13px;height:13px;cursor:nesw-resize}',
    '.hc-rz-nw{top:-4px;left:-4px;width:13px;height:13px;cursor:nwse-resize}',
    '.hc-rz-se{bottom:-4px;right:-4px;width:13px;height:13px;cursor:nwse-resize}',
    '.hc-rz-sw{bottom:-4px;left:-4px;width:13px;height:13px;cursor:nesw-resize}',
    '.window.maximized .hc-rz{display:none}',
    '.window.hc-dragging iframe,.window.hc-resizing iframe{pointer-events:none}',

    '.st-file{position:relative;overflow:hidden;cursor:pointer}',
         
    '.wp-thumb{position:relative;overflow:hidden}',
    '.wp-del{position:absolute;top:3px;right:3px;width:20px;height:20px;padding:0;display:none;',
      'align-items:center;justify-content:center;border:none;border-radius:5px;cursor:pointer;z-index:2;',
      'background:rgba(0,0,0,.55);color:#fff}',
    '.wp-del svg{width:10px;height:10px;display:block;pointer-events:none}',
    '.wp-thumb:hover .wp-del{display:flex}',
    '.wp-del:hover{background:#e81123}',
     
    '.hc-cal-pop{position:fixed;min-width:250px}',
    '.hc-cal-head{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;margin-bottom:8px}',
    '.hc-cal-nav{border:none;background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer;padding:2px 8px;border-radius:6px}',
    '.hc-cal-nav:hover{background:var(--hc-hover)}',
    '.hc-cal-week,.hc-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}',
    '.hc-cal-week span{font-size:10.5px;color:var(--hc-dim);text-align:center;padding:2px 0}',
    '.hc-cal-day{font-size:12px;text-align:center;padding:5px 0;border-radius:6px;cursor:default}',
    '.hc-cal-day:hover{background:var(--hc-hover)}',
    '.hc-cal-day.other{opacity:.35}',
    '.hc-cal-day.today{background:var(--accent);color:#fff;font-weight:600}',
    '#clock{cursor:pointer}',
'.st-file input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}'
  ].join('\n');

  const st = document.createElement('style');
  st.id = 'hc-system-styles';
  st.textContent = css;
  document.head.appendChild(st);
}

window.addEventListener('DOMContentLoaded', function(){
  injectSystemStyles();
  document.body.appendChild(brightnessEl);
  document.body.appendChild(toastsEl);
  initTray();
  renderTaskbar();

  applySettings();
  loadCustomWallpapers().then(function(){
    applyWallpaper();          
    buildDesktop();
    buildStartMenu('');
  });
});

const ICON_POS_KEY = 'hencore_os_icon_pos_v1';
const GRID = { gw: 100, gh: 108, pad: 10 };

function loadIconPos(){
  try { return JSON.parse(localStorage.getItem(ICON_POS_KEY)) || {}; }
  catch(e){ return {}; }
}
function saveIconPos(map){
  try { localStorage.setItem(ICON_POS_KEY, JSON.stringify(map)); }
  catch(e){}
}

function maxGridRows(){
  const h = (desktop ? desktop.clientHeight : innerHeight) || innerHeight;
  return Math.max(1, Math.floor((h - GRID.pad * 2) / GRID.gh));
}
function maxGridCols(){
  const w = (desktop ? desktop.clientWidth : innerWidth) || innerWidth;
  return Math.max(1, Math.floor((w - GRID.pad * 2) / GRID.gw));
}

function cellPos(c, r){ return { x: GRID.pad + c * GRID.gw, y: GRID.pad + r * GRID.gh }; }

function placeIconEl(el, c, r){
  c = Math.min(maxGridCols() - 1, Math.max(0, c));
  r = Math.min(maxGridRows() - 1, Math.max(0, r));
  const p = cellPos(c, r);
  el.style.left = p.x + 'px';
  el.style.top  = p.y + 'px';
  el.dataset.c = String(c);
  el.dataset.r = String(r);
}

function cellOccupied(c, r, skipName){
  const nodes = desktop.querySelectorAll('.app-icon');
  for (let i = 0; i < nodes.length; i++){
    const n = nodes[i];
    if (n.dataset.name === skipName) continue;
    if (Number(n.dataset.c) === c && Number(n.dataset.r) === r) return true;
  }
  return false;
}

function findFreeCell(c0, r0, skipName){
  if (!cellOccupied(c0, r0, skipName)) return { c: c0, r: r0 };
  const maxC = maxGridCols(), maxR = maxGridRows();
  for (let rad = 1; rad < maxC + maxR; rad++){
    let best = null, bestD = Infinity;
    for (let dc = -rad; dc <= rad; dc++){
      for (let dr = -rad; dr <= rad; dr++){
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= maxC || r >= maxR) continue;
        if (cellOccupied(c, r, skipName)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD){ bestD = d; best = { c: c, r: r }; }
      }
    }
    if (best) return best;
  }
  return { c: c0, r: r0 };
}

function makeIconEl(app){
  const d = document.createElement('div');
  d.className = 'app-icon';
  d.dataset.name = app.name;
  d.tabIndex = 0;
  const ic = document.createElement('div');
  if (isBuiltin(app)){ ic.className = 'fallback'; ic.textContent = '⚙'; }
  else {
    ic.className = 'ic';
    const img = document.createElement('img');
    img.src = app.icon || '';
    img.onerror = function(){
      const fb = document.createElement('div');
      fb.className = 'fallback';
      fb.textContent = app.name.charAt(0).toUpperCase();
      img.replaceWith(fb);
    };
    ic.appendChild(img);
  }
  const lbl = document.createElement('span');
  lbl.textContent = app.name;
  d.appendChild(ic); d.appendChild(lbl);
  return d;
}

function bindIconDrag(el, app){
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;

  el.addEventListener('pointerdown', function(e){
    if (e.button !== 0) return;
    desktop.querySelectorAll('.app-icon').forEach(function(x){ x.classList.remove('active'); });
    el.classList.add('active');
    sx = e.clientX; sy = e.clientY;
    ox = el.offsetLeft; oy = el.offsetTop;
    moved = false; dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch(err){}
  });

  el.addEventListener('pointermove', function(e){
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (!moved){
      moved = true;
      el.classList.add('hc-drag');
      desktop.classList.add('hc-grid-on');
    }
    el.style.left = Math.max(0, ox + dx) + 'px';
    el.style.top  = Math.max(0, oy + dy) + 'px';
  });

  function finish(){
    if (!dragging) return;
    dragging = false;
    el.classList.remove('hc-drag');
    desktop.classList.remove('hc-grid-on');
    if (!moved) return;
    const r = el.getBoundingClientRect();
    const dr = desktop.getBoundingClientRect();
    const cell = snapToGrid(r.left + r.width / 2 - dr.left, r.top + r.height / 2 - dr.top);
    const free = findFreeCell(cell.c, cell.r, app.name);
    placeIconEl(el, free.c, free.r);
    const map = loadIconPos();
    map[app.name] = { c: free.c, r: free.r };
    saveIconPos(map);
  }
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);

  el.addEventListener('dblclick', function(){ openApp(app); });
  el.addEventListener('keydown', function(e){ if (e.key === 'Enter') openApp(app); });
}

function snapToGrid(x, y){
  const c = Math.round((x - GRID.pad - GRID.gw / 2) / GRID.gw);
  const r = Math.round((y - GRID.pad - GRID.gh / 2) / GRID.gh);
  return {
    c: Math.min(maxGridCols() - 1, Math.max(0, c)),
    r: Math.min(maxGridRows() - 1, Math.max(0, r))
  };
}

const DESKTOP_KEY = 'hencore_os_desktop_v1';
let desktopApps = null;

function loadDesktopApps(){
  try{
    const raw = JSON.parse(localStorage.getItem(DESKTOP_KEY));
    if (Array.isArray(raw)){
      const known = APPS.concat([BUILTIN_SETTINGS]);
      return raw.filter(function(n){ return known.some(function(a){ return a.name === n; }); });
    }
  }catch(e){}
  return APPS.slice(0, 2).map(function(a){ return a.name; });
}

function saveDesktopApps(){
  try{ localStorage.setItem(DESKTOP_KEY, JSON.stringify(desktopApps)); }catch(e){}
}

function findAppByName(name){
  return APPS.filter(function(a){ return a.name === name; })[0] ||
    (BUILTIN_SETTINGS.name === name ? BUILTIN_SETTINGS : null);
}

function addAppToDesktop(app){
  if (!desktopApps) desktopApps = loadDesktopApps();
  if (desktopApps.indexOf(app.name) !== -1) return;
  desktopApps.push(app.name);
  saveDesktopApps();
  buildDesktop();
}

function removeAppFromDesktop(app){
  if (!desktopApps) desktopApps = loadDesktopApps();
  desktopApps = desktopApps.filter(function(n){ return n !== app.name; });
  saveDesktopApps();
  buildDesktop();
}

(function bindDesktopDrop(){
  if (!desktop) return;
  let hover = false;
  desktop.addEventListener('dragover', function(e){
    let ok = false;
    const types = e.dataTransfer.types;
    for (let i = 0; i < types.length; i++){
      if (types[i] === 'text/hencore-app'){ ok = true; break; }
    }
    if (!ok) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!hover){ hover = true; desktop.classList.add('hc-drop'); }
  });
  desktop.addEventListener('dragleave', function(e){
    if (e.relatedTarget && desktop.contains(e.relatedTarget)) return;
    hover = false;
    desktop.classList.remove('hc-drop');
  });
  desktop.addEventListener('drop', function(e){
    e.preventDefault();
    hover = false;
    desktop.classList.remove('hc-drop');
    const name = e.dataTransfer.getData('text/hencore-app');
    const app = name && findAppByName(name);
    if (!app) return;
    toggleStartMenu(false);
     
    const dr = desktop.getBoundingClientRect();
    const cell = snapToGrid(e.clientX - dr.left, e.clientY - dr.top);
    const free = findFreeCell(cell.c, cell.r, app.name);
    const map = loadIconPos();
    map[app.name] = { c: free.c, r: free.r };
    saveIconPos(map);
    addAppToDesktop(app);
  });
})();

function buildDesktop(){
  if (!desktop) return;
  if (!desktopApps) desktopApps = loadDesktopApps();
  desktop.innerHTML = '';
  const saved = loadIconPos();
  const rowsPerCol = maxGridRows();

  desktopApps.forEach(function(name, i){
    const app = findAppByName(name);
    if (!app) return;
    const el = makeIconEl(app);
    let cell = saved[app.name];
    if (!cell || typeof cell.c !== 'number' || typeof cell.r !== 'number'){
      cell = findFreeCell(Math.floor(i / rowsPerCol), i % rowsPerCol, app.name);
    }
    placeIconEl(el, cell.c, cell.r);
    bindIconDrag(el, app);
    el.addEventListener('contextmenu', function(e){
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { label: 'Убрать с рабочего стола', action: function(){ removeAppFromDesktop(app); } }
      ]);
    });
    desktop.appendChild(el);
  });
}

window.addEventListener('resize', function(){
  if (!desktop || !desktop.children.length) return;
  desktop.querySelectorAll('.app-icon').forEach(function(el){
    placeIconEl(el, Number(el.dataset.c) || 0, Number(el.dataset.r) || 0);
  });
});

const NET_CHECK_MS    = 15000;
const NET_TIMEOUT_MS  = 6000;
const NET_HISTORY_MAX = 8;

const NET_PROBES = [
  { name: 'gstatic',    kind: 'fetch', url: 'https://www.gstatic.com/generate_204', mode: 'no-cors' },
  { name: 'cloudflare', kind: 'fetch', url: 'https://cloudflare.com/cdn-cgi/trace', mode: 'cors'    },
  { name: 'google-img', kind: 'image', url: 'https://www.google.com/favicon.ico' }
];

const NET_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' +
    '<rect id="nb1" x="2.5"  y="14.5" width="3.4" height="6"  rx="1"/>' +
    '<rect id="nb2" x="7.7"  y="11.5" width="3.4" height="9"  rx="1"/>' +
    '<rect id="nb3" x="12.9" y="8.5"  width="3.4" height="12" rx="1"/>' +
    '<rect id="nb4" x="18.1" y="5.5"  width="3.4" height="15" rx="1"/>' +
  '</svg>';

let netBtn = null, netRows = {}, netBusy = false;
let netHistory = [];           
let netFails = 0;              
let netWasOffline = null;      
let netProbeIdx = 0;           

function netSetBars(level, color){
  if (!netBtn) return;
  netBtn.style.color = color || '';
  [1, 2, 3, 4].forEach(function(i){
    const b = netBtn.querySelector('#nb' + i);
    if (b) b.style.opacity = i <= level ? '1' : '0.16';
  });
}

function netSetRow(key, text){
  if (netRows[key]) netRows[key].textContent = text;
}

function netStats(){
  const ok = netHistory.filter(function(h){ return h.ok; });
  const rtts = ok.map(function(h){ return h.rtt; });
  const avg = rtts.length
    ? Math.round(rtts.reduce(function(a, b){ return a + b; }, 0) / rtts.length)
    : null;
  let jitter = null;
  if (rtts.length >= 2){
    let s = 0;
    for (let i = 1; i < rtts.length; i++) s += Math.abs(rtts[i] - rtts[i - 1]);
    jitter = Math.round(s / (rtts.length - 1));
  }
  const loss = netHistory.length
    ? Math.round((netHistory.length - ok.length) / netHistory.length * 100)
    : 0;
  return { avg: avg, jitter: jitter, loss: loss };
}

function netQuality(rtt){
  if (rtt === null || rtt < 0) return { bars: 0, label: 'нет соединения', color: '#ef4444' };
  if (rtt < 120) return { bars: 4, label: 'отличный',       color: '#34d399' };
  if (rtt < 300) return { bars: 3, label: 'хороший',        color: '#a3e635' };
  if (rtt < 700) return { bars: 2, label: 'средний',        color: '#fbbf24' };
  return          { bars: 1, label: 'слабый',              color: '#f97316' };
}

function netFetchProbe(probe){
  return new Promise(function(resolve){
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t0 = performance.now();
    const timer = setTimeout(function(){ if (ctrl) ctrl.abort(); resolve(null); }, NET_TIMEOUT_MS);
    const sep = probe.url.indexOf('?') > -1 ? '&' : '?';
    fetch(probe.url + sep + 't=' + Date.now(), {
      mode: probe.mode || 'no-cors',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(res){
      clearTimeout(timer);
       
      if (probe.mode === 'cors' && res && res.ok === false) return resolve(null);
      resolve(Math.round(performance.now() - t0));
    }).catch(function(){ clearTimeout(timer); resolve(null); });
  });
}

function netImageProbe(probe){
  return new Promise(function(resolve){
    const img = new Image();
    let done = false;
    const t0 = performance.now();
    const timer = setTimeout(function(){
      if (!done){ done = true; img.src = ''; resolve(null); }
    }, NET_TIMEOUT_MS);
    img.onload = function(){
      if (!done){ done = true; clearTimeout(timer); resolve(Math.round(performance.now() - t0)); }
    };
    img.onerror = function(){
      if (!done){ done = true; clearTimeout(timer); resolve(null); }
    };
    const sep = probe.url.indexOf('?') > -1 ? '&' : '?';
    img.src = probe.url + sep + 't=' + Date.now();
  });
}

function netRunProbe(probe){
  return probe.kind === 'image' ? netImageProbe(probe) : netFetchProbe(probe);
}

function netPush(ok, rtt){
  netHistory.push({ ok: ok, rtt: rtt });
  if (netHistory.length > NET_HISTORY_MAX) netHistory.shift();
}

function netShowOffline(text){
  netSetBars(0, '#ef4444');
  netSetRow('status', text || 'Оффлайн');
  netSetRow('delay', '—');
  netSetRow('jitter', '—');
  netSetRow('loss', '—');
}

function netApplyState(ok, rtt, probeName){
  const st = netStats();

  if (ok){
    netFails = 0;
    let q = netQuality(st.avg);
     
    if (st.loss >= 50)      q = { bars: 1, label: q.label + ' (нестабильно)', color: '#f97316' };
    else if (st.loss >= 25) q = { bars: Math.max(2, q.bars - 1), label: q.label + ' (потери)', color: '#fbbf24' };
    netSetBars(q.bars, q.color);
    netSetRow('status', 'Онлайн — сигнал ' + q.label);
    netSetRow('delay', (st.avg !== null ? st.avg : rtt) + ' мс');
    netSetRow('jitter', st.jitter !== null ? '±' + st.jitter + ' мс' : '—');
    netSetRow('loss', st.loss + '%');
    netSetRow('probe', probeName);
  } else {
    netFails++;
    if (navigator.onLine === false || netFails >= 2){
      netShowOffline('Оффлайн');
      netSetRow('probe', 'все проверки не прошли');
    } else {
      netSetBars(1, '#f97316');
      netSetRow('status', 'Сеть есть, ответ не получен (' + netFails + '/2)');
      netSetRow('loss', st.loss + '%');
    }
  }

  const offlineNow = !ok && (navigator.onLine === false || netFails >= 2);
  if (offlineNow !== netWasOffline){
    if (netWasOffline !== null){
      HENCORE.notify('Сеть', offlineNow ? 'Соединение с интернетом потеряно' : 'Соединение восстановлено');
    }
    netWasOffline = offlineNow;
  }
}

function netMeasure(){
  if (netBusy) return;
  netBusy = true;
  if (netBtn) netBtn.classList.add('hc-net-busy');

  let i = netProbeIdx;
  let attempts = 0;

  function step(){
    if (attempts >= NET_PROBES.length){
      netProbeIdx = 0;
      netPush(false, null);
      netApplyState(false, null, null);
      netBusy = false;
      if (netBtn) netBtn.classList.remove('hc-net-busy');
      return;
    }
    const probe = NET_PROBES[i % NET_PROBES.length];
    attempts++;
    netRunProbe(probe).then(function(rtt){
      if (rtt !== null){
        netProbeIdx = i % NET_PROBES.length;  
        netPush(true, rtt);
        netApplyState(true, rtt, probe.name);
        netBusy = false;
        if (netBtn) netBtn.classList.remove('hc-net-busy');
      } else {
        i++;
        step();
      }
    });
  }
  step();
}

function netConnectionInfo(){
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return null;
  return { type: c.type || '', eff: c.effectiveType || '', dl: c.downlink || null };
}

function netRefresh(){
  const info = netConnectionInfo();
  if (info){
    if (info.type) netSetRow('type',
      info.type === 'wifi' ? 'Wi-Fi' :
      info.type === 'cellular' ? 'Мобильная сеть' :
      info.type === 'ethernet' ? 'Ethernet' : info.type);
    if (info.eff) netSetRow('eff', info.eff);
    if (info.dl) netSetRow('speed', info.dl + ' Мбит/с )');
  }
  if (navigator.onLine === false){
    netPush(false, null);
    netApplyState(false, null, null);
    return;
  }
  netMeasure();
}

function initNetIndicator(){
  if (!tray || !clockEl) return;

  const wrap = document.createElement('div');
  wrap.className = 'hc-tray-item';

  netBtn = document.createElement('button');
  netBtn.className = 'hc-tray-btn';
  netBtn.id = 'hc-net-btn';
  netBtn.title = 'Состояние сети';
  netBtn.innerHTML = NET_SVG;

  const pop = makePopover('Интернет');
  pop.innerHTML +=
    '<div class="hc-net-row"><span>Статус</span><b id="net-st"></b></div>' +
    '<div class="hc-net-row"><span>Задержка (сред.)</span><b id="net-rtt"></b></div>' +
    '<div class="hc-net-row"><span>Дрожание</span><b id="net-jit"></b></div>' +
    '<div class="hc-net-row"><span>Потери</span><b id="net-loss"></b></div>' +
    '<div class="hc-net-row"><span>Тип сети</span><b id="net-type"></b></div>' +
    '<div class="hc-net-row"><span>Профиль</span><b id="net-eff"></b></div>' +
    '<div class="hc-net-row"><span>Скорость</span><b id="net-dl"></b></div>' +
    '<div class="hc-net-row"><span>Проверка через</span><b id="net-probe"></b></div>' +
    '<div class="hc-notif-empty"> </div>';

  netRows = {
    status: pop.querySelector('#net-st'),
    delay:  pop.querySelector('#net-rtt'),
    jitter: pop.querySelector('#net-jit'),
    loss:   pop.querySelector('#net-loss'),
    type:   pop.querySelector('#net-type'),
    eff:    pop.querySelector('#net-eff'),
    speed:  pop.querySelector('#net-dl'),
    probe:  pop.querySelector('#net-probe')
  };

  wrap.appendChild(netBtn); wrap.appendChild(pop);
  bindTrayToggle(netBtn, pop);

  netBtn.addEventListener('dblclick', function(){
    netHistory = [];
    netFails = 0;
    netRefresh();
  });

  const fpsEl = tray.querySelector('.hc-fps');
  if (fpsEl) tray.insertBefore(wrap, fpsEl);
  else tray.appendChild(wrap);

  netRefresh();

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && typeof conn.addEventListener === 'function'){
    conn.addEventListener('change', netRefresh);
  }
  window.addEventListener('online',  netRefresh);
  window.addEventListener('offline', netRefresh);
  setInterval(netRefresh, NET_CHECK_MS);
}

(function injectAddonStyles(){
  const st = document.createElement('style');
  st.textContent = [
    '#desktop.hc-grid-on{',
      'background-image:radial-gradient(circle, rgba(127,127,127,.4) 1px, transparent 1.6px);',
      'background-size:' + GRID.gw + 'px ' + GRID.gh + 'px;',
      'background-position:' + GRID.pad + 'px ' + GRID.pad + 'px',
    '}',
    '#desktop .app-icon{position:absolute;touch-action:none;cursor:default;user-select:none;-webkit-user-select:none}',
    '#desktop .app-icon.hc-drag{opacity:.65;z-index:5;transform:scale(1.06)}',
    '#hc-net-btn{position:relative}',
    '#hc-net-btn.hc-net-busy::after{',
      'content:"";position:absolute;right:1px;top:1px;width:6px;height:6px;border-radius:50%;',
      'background:var(--accent,#4cc2ff);animation:hc-net-pulse 1s ease-in-out infinite',
    '}',
    '@keyframes hc-net-pulse{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}',
    '.hc-net-row{display:flex;justify-content:space-between;gap:14px;font-size:12.5px;padding:3px 0}',
    '.hc-net-row span{color:var(--hc-dim,#9aa0a6)}',
    '.hc-net-row b{font-weight:600;text-align:right}'
  ].join('\n');
  (document.head || document.body).appendChild(st);
})();

window.addEventListener('DOMContentLoaded', function(){
  initNetIndicator();
});

'use strict';

(function(){
  if (typeof openApp !== 'function' || typeof createWindow !== 'function'){
    console.warn('Ядро загрузилось неправильно, Перезапустите HENCORE OS Portable');
    return;
  }

  function renumberApp(app){
    const same = openWins.filter(function(w){ return w.app === app; });
    same.forEach(function(w, i){
      const label = same.length > 1 ? app.name + ' [' + (i + 1) + ']' : app.name;
      const t = w.el.querySelector('.win-title');
      if (t) t.textContent = label;
      if (w.taskBtn) w.taskBtn.title = label;
    });
  }

  window.openApp = function openAppMulti(app){
    if (!app) return;

    if (isBuiltin(app)){
      const existing = openWins.find(function(w){ return w.app === app; });
      if (existing){ restoreWin(existing); return; }
      createWindow(app);
      return;
    }

    createWindow(app);

    const same = openWins.filter(function(w){ return w.app === app; });
    const n = same.length;
    if (n > 1){
      const win = same[n - 1];
      const step = (n - 1) * 26;
    }
    renumberApp(app);
  };

  const _closeWin = closeWin;
  window.closeWin = function closeWinMulti(win){
    const app = win && win.app;
    _closeWin(win);
    if (app && !isBuiltin(app)) renumberApp(app);
  };

  window.createTaskBtn = function createTaskBtnMulti(app, win){
    const btn = document.createElement('button');
    btn.className = 'task-item' + (win ? ' running' : '');
    btn.title = win
      ? (app.name + ' — окно ' + (openWins.indexOf(win) + 1))
      : app.name;
    btn.innerHTML =
      (isBuiltin(app) ? '<span class="fb">⚙</span>' : '<img src="' + (app.icon || '') + '" alt="">');
    const img = btn.querySelector('img');
    if (img) img.onerror = function(){
      const fb = document.createElement('span');
      fb.className = 'fb';
      fb.textContent = app.name.charAt(0).toUpperCase();
      img.replaceWith(fb);
    };

    btn._app = app;

    if (win){
      btn._win = win;
      win.taskBtn = btn;
      btn.addEventListener('click', function(){
        if (win.minimized) restoreWin(win);
        else if (activeWin === win) minimizeWin(win);
        else focusWin(win);
      });
    } else {
      btn.addEventListener('click', function(){ openApp(app); });
    }

    btn.addEventListener('contextmenu', function(e){
      e.preventDefault();
      e.stopPropagation();

      const items = [{ label: 'Новое окно', action: function(){ openApp(app); } }];
      items.push(isPinned(app)
        ? { label: 'Открепить от панели задач', action: function(){ togglePinApp(app); } }
        : { label: 'Закрепить на панели задач', action: function(){ togglePinApp(app); } });

      const wins = openWins.filter(function(w){ return w.app === app; });
      if (wins.length > 1){
        items.push({ label: 'Закрыть все окна (' + wins.length + ')', action: function(){
          wins.slice().forEach(function(w){ closeWin(w); });
        }});
      }

      showCtxMenu(e.clientX, e.clientY, items);
    });

    return btn;
  };

  console.log('[MultiWindows] Несколько окон одного приложения включены');
})();


(function () {
  'use strict';

  var CFG = {
    height: 3,                             
    bottom: 1,                             
    radius: 3,                               
    idle: 5,                           
    hover: 6,                              
    hoverA: 16,                              
    active: 19,                              
    color: 'var(--accent, #4cc2ff)'
  };

  function injectStyles() {
    if (document.getElementById('hc-taskbar-pill-style')) return;
    var st = document.createElement('style');
    st.id = 'hc-taskbar-pill-style';
    st.textContent = `
#taskitems .task-item{position:relative}
#taskitems .task-item::after{
  content:"";
  position:absolute;
  left:50%;
  bottom:${CFG.bottom}px;
  height:${CFG.height}px;
  border-radius:${CFG.radius}px;
  background:${CFG.color};
  transform:translateX(-50%) scaleX(0);
  transform-origin:center;
  opacity:0;
  pointer-events:none;
  transition:transform .25s cubic-bezier(.4,0,.2,1),width .25s ease,opacity .25s ease;
}
#taskitems .task-item.running::after{
  opacity:1;
  width:${CFG.idle}px;
  transform:translateX(-50%) scaleX(1);
}
#taskitems .task-item.running:hover::after{ width:${CFG.hoverA}px; }
#taskitems .task-item.active::after{
  opacity:1;
  width:${CFG.active}px;
  transform:translateX(-50%) scaleX(1);
}

@media (prefers-reduced-motion:reduce){
  #taskitems .task-item::after{transition:none}
}`;
    (document.head || document.body).appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }
})();



(function(){
'use strict';

if (window.HENCORE_WIDGETS_LOADED) return;
window.HENCORE_WIDGETS_LOADED = true;

var W_KEY = 'hencore_os_widgets_v1';
var TASKBAR_H = 48;

var MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
              'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
var MONTHS_R = ['января','февраля','марта','апреля','мая','июня',
                'июля','августа','сентября','октября','ноября','декабря'];
var DAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

var DEFS = {
  clock:    { title: 'Часы',      w: 220, h: 122, build: buildClock },
  calendar: { title: 'Календарь', w: 256, h: 296, build: buildCalendar },
  notes:    { title: 'Заметки',   w: 280, h: 250, build: buildNotes },
  g2048:    { title: '2048',      w: 292, h: 372, build: build2048 },
  mines:    { title: 'Сапёр',     w: 308, h: 392, build: buildMines }
};

var widgets = [];
var wdgZ = 50;
var layer = null;
var desktopEl = null;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function p2(n){ return String(n).padStart(2, '0'); }
function pad3(n){ return String(Math.min(999, n)).padStart(3, '0'); }

function loadAll(){
  try{
    var r = JSON.parse(localStorage.getItem(W_KEY));
    if (Array.isArray(r)) return r;
  }catch(e){}
  return [];
}

function saveAll(){
  try{
    localStorage.setItem(W_KEY, JSON.stringify(widgets.map(function(w){
      return { id: w.id, type: w.type, x: w.x, y: w.y, data: w.data };
    })));
  }catch(e){}
}

var lastMenuItems = null;
var menuJustShown = false;
var handledStamp = -1;
var fbMenu = null;

if (typeof window.showCtxMenu === 'function'){
  var origShow = window.showCtxMenu;
  window.showCtxMenu = function(x, y, items){
    lastMenuItems = items;
    menuJustShown = true;
    setTimeout(function(){ menuJustShown = false; }, 0);
    return origShow(x, y, items);
  };
}

function fallbackMenu(x, y, items){
  if (fbMenu) fbMenu.remove();
  var m = document.createElement('div');
  m.className = 'hc-ctx-menu';
  items.forEach(function(it){
    var b = document.createElement('button');
    b.textContent = it.label;
    b.addEventListener('click', function(ev){
      ev.stopPropagation();
      if (fbMenu){ fbMenu.remove(); fbMenu = null; }
      it.action();
    });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  var r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top  = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  fbMenu = m;
}

function showMenu(x, y, items){
  if (typeof window.showCtxMenu === 'function') window.showCtxMenu(x, y, items);
  else fallbackMenu(x, y, items);
}

document.addEventListener('pointerdown', function(e){
  if (fbMenu && !fbMenu.contains(e.target)){ fbMenu.remove(); fbMenu = null; }
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && fbMenu){ fbMenu.remove(); fbMenu = null; }
});

function widgetMenuItems(e){
  var extra = [];
  Object.keys(DEFS).forEach(function(type){
    extra.push({
      label: 'Добавить виджет: ' + DEFS[type].title,
      action: function(){ addWidget(type, e.clientX, e.clientY); }
    });
  });
  if (widgets.length){
    extra.push({ label: 'Убрать все виджеты', action: clearAllWidgets });
  }
  return extra;
}

function handleCtx(e){
  var t = e.target;
  if (!t || !t.closest) return;
  if (t.closest('.hc-ctx-menu')) return;
  if (t.closest('.hc-wdg')) return;    
  if (t.closest('.app-icon') || t.closest('.window') ||
      t.closest('.taskbar') || t.closest('.startmenu') ||
      t.closest('.hc-pop')) return;
  if (!desktopEl || !(t === desktopEl || desktopEl.contains(t))) return;
  if (handledStamp === e.timeStamp) return;    
  handledStamp = e.timeStamp;

  e.preventDefault();
   
  var base = (menuJustShown && Array.isArray(lastMenuItems)) ? lastMenuItems.slice() : [];
  showMenu(e.clientX, e.clientY, base.concat(widgetMenuItems(e)));
}

function addWidget(type, px, py){
  var def = DEFS[type];
  if (!def) return;
  var w = {
    id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: type, x: 0, y: 0, data: {}
  };
  w.x = clamp(px - def.w / 2, 6, Math.max(6, innerWidth - def.w - 6));
  w.y = clamp(py - 16, 6, Math.max(6, innerHeight - TASKBAR_H - def.h - 6));
  widgets.push(w);
  renderWidget(w);
  saveAll();
}

function renderWidget(w){
  var def = DEFS[w.type];
  if (!def) return;

  var el = document.createElement('div');
  el.className = 'hc-wdg';
  el.style.width = def.w + 'px';
  el.style.height = def.h + 'px';
  el.style.left = w.x + 'px';
  el.style.top = w.y + 'px';
  el.innerHTML =
    '<div class="hc-wdg-head">' +
      '<span class="hc-wdg-title">' + def.title + '</span>' +
      '<button class="hc-wdg-close" title="Убрать виджет">&#10005;</button>' +
    '</div>' +
    '<div class="hc-wdg-body"></div>';

  w.el = el;
  w.body = el.querySelector('.hc-wdg-body');
  w.data = w.data || {};
  el.style.zIndex = String(++wdgZ);

  el.addEventListener('pointerdown', function(){
    el.style.zIndex = String(++wdgZ);
  });
  el.querySelector('.hc-wdg-close').addEventListener('click', function(e){
    e.stopPropagation();
    removeWidget(w);
  });
  bindWidgetDrag(w);

  el.addEventListener('contextmenu', function(e){
    e.preventDefault();
    e.stopPropagation();
    var items = [{ label: 'Убрать виджет', action: function(){ removeWidget(w); } }];
    if (def.menu) def.menu(w, items);
    showMenu(e.clientX, e.clientY, items);
  });

  def.build(w);
  layer.appendChild(el);
}

function removeWidget(w){
  if (w._cleanup) w._cleanup();
  if (w.el) w.el.remove();
  var i = widgets.indexOf(w);
  if (i >= 0) widgets.splice(i, 1);
  saveAll();
}

function clearAllWidgets(){
  while (widgets.length) removeWidget(widgets[widgets.length - 1]);
}

function bindWidgetDrag(w){
  var head = w.el.querySelector('.hc-wdg-head');
  var sx = 0, sy = 0, ox = 0, oy = 0, drag = false;

  head.addEventListener('pointerdown', function(e){
    if (e.target.closest('.hc-wdg-close')) return;
    drag = true;
    sx = e.clientX; sy = e.clientY;
    ox = w.x; oy = w.y;
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', function(e){
    if (!drag) return;
    w.x = clamp(ox + e.clientX - sx, -40, innerWidth - 40);
    w.y = clamp(oy + e.clientY - sy, 0, innerHeight - TASKBAR_H - 34);
    w.el.style.left = w.x + 'px';
    w.el.style.top = w.y + 'px';
  });
  function stop(){
    if (!drag) return;
    drag = false;
    saveAll();
  }
  head.addEventListener('pointerup', stop);
  head.addEventListener('pointercancel', stop);
}

function buildClock(w){
  var b = w.body;
  b.innerHTML =
    '<div class="wdg-clk-time">--:--:--</div>' +
    '<div class="wdg-clk-date"></div>';
  var t = b.querySelector('.wdg-clk-time');
  var dt = b.querySelector('.wdg-clk-date');

  function tick(){
    var n = new Date();
    t.textContent = p2(n.getHours()) + ':' + p2(n.getMinutes()) + ':' + p2(n.getSeconds());
    dt.textContent = DAYS[n.getDay()] + ', ' + n.getDate() + ' ' + MONTHS_R[n.getMonth()];
  }
  tick();
  var iv = setInterval(tick, 1000);
  w._cleanup = function(){ clearInterval(iv); };
}

function buildCalendar(w){
  var b = w.body;
  var d = w.data;
  var now = new Date();
  if (typeof d.y !== 'number'){ d.y = now.getFullYear(); d.m = now.getMonth(); }

  b.innerHTML =
    '<div class="wdg-cal-head">' +
      '<button class="wdg-cal-nav" data-dir="-1">&#8249;</button>' +
      '<span class="wdg-cal-mon"></span>' +
      '<button class="wdg-cal-nav" data-dir="1">&#8250;</button>' +
    '</div>' +
    '<div class="wdg-cal-week">' +
      '<span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span>' +
      '<span>Пт</span><span>Сб</span><span>Вс</span>' +
    '</div>' +
    '<div class="wdg-cal-grid"></div>';

  var mon = b.querySelector('.wdg-cal-mon');
  var grid = b.querySelector('.wdg-cal-grid');

  function render(){
    mon.textContent = MONTHS[d.m] + ' ' + d.y;
    var nd = new Date();
    var start = (new Date(d.y, d.m, 1).getDay() + 6) % 7;    
    var daysIn = new Date(d.y, d.m + 1, 0).getDate();
    var prevDays = new Date(d.y, d.m, 0).getDate();
    var html = '';
    var i, dd;
    for (i = start - 1; i >= 0; i--)
      html += '<span class="wdg-cal-day other">' + (prevDays - i) + '</span>';
    for (dd = 1; dd <= daysIn; dd++){
      var today = (dd === nd.getDate() && d.m === nd.getMonth() && d.y === nd.getFullYear());
      html += '<span class="wdg-cal-day' + (today ? ' today' : '') + '">' + dd + '</span>';
    }
    var rest = (7 - (start + daysIn) % 7) % 7;
    for (dd = 1; dd <= rest; dd++)
      html += '<span class="wdg-cal-day other">' + dd + '</span>';
    grid.innerHTML = html;
  }

  b.querySelectorAll('.wdg-cal-nav').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      d.m += Number(btn.dataset.dir);
      if (d.m < 0){ d.m = 11; d.y--; }
      if (d.m > 11){ d.m = 0; d.y++; }
      render();
      saveAll();
    });
  });

  render();
}

function buildNotes(w){
  var b = w.body;
  var d = w.data;
  b.innerHTML =
    '<textarea class="wdg-notes-ta" spellcheck="false"' +
      ' placeholder="Пишите здесь — сохранится само&#8230;"></textarea>' +
    '<div class="wdg-notes-hint">Сохраняется автоматически</div>';
  var ta = b.querySelector('textarea');
  ta.value = typeof d.text === 'string' ? d.text : '';
  ta.addEventListener('input', function(){
    d.text = ta.value;
    saveAll();
  });
}

function build2048(w){
  var b = w.body;
  var d = w.data;

  if (!Array.isArray(d.cells) || d.cells.length !== 16){
    d.cells = [];
    for (var i = 0; i < 16; i++) d.cells.push(0);
    d.score = 0;
  }
  if (typeof d.best !== 'number') d.best = 0;
  if (typeof d.over !== 'boolean') d.over = false;
  if (typeof d.wonShown !== 'boolean') d.wonShown = false;

  var cellHtml = '';
  for (var i = 0; i < 16; i++) cellHtml += '<div class="w2048-cell"></div>';

  b.innerHTML =
    '<div class="w2048-top">' +
      '<div class="w2048-score"><span>Счёт</span><b class="w2048-cur">0</b></div>' +
      '<div class="w2048-score"><span>Рекорд</span><b class="w2048-best">0</b></div>' +
      '<button class="w2048-new">Заново</button>' +
    '</div>' +
    '<div class="w2048-grid">' + cellHtml +
      '<div class="w2048-overlay"><span class="w2048-ov-text"></span>' +
      '<button class="w2048-ov-btn">Заново</button></div>' +
    '</div>' +
    '<div class="w2048-hint">Кликните по виджету и играйте стрелками</div>';

  var cells = b.querySelectorAll('.w2048-cell');
  var curEl = b.querySelector('.w2048-cur');
  var bestEl = b.querySelector('.w2048-best');
  var overlay = b.querySelector('.w2048-overlay');
  var ovText = b.querySelector('.w2048-ov-text');

  w.el.tabIndex = -1;
  w.el.style.outline = 'none';
  w.el.addEventListener('pointerdown', function(){ w.el.focus(); });
  w.el.addEventListener('keydown', function(e){
    var dir = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3 }[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    move(dir);
  });

  function tileCls(v){
    if (v <= 8192) return ' t' + v;
    return ' tbig';
  }

  function render(){
    for (var i = 0; i < 16; i++){
      var v = d.cells[i];
      cells[i].className = 'w2048-cell' + (v ? tileCls(v) : '');
      cells[i].textContent = v ? String(v) : '';
    }
    curEl.textContent = d.score;
    bestEl.textContent = Math.max(d.best, d.score);
  }

  function spawn(){
    var empty = [];
    for (var i = 0; i < 16; i++) if (!d.cells[i]) empty.push(i);
    if (!empty.length) return;
    var idx = empty[Math.floor(Math.random() * empty.length)];
    d.cells[idx] = Math.random() < 0.9 ? 2 : 4;
  }

  function canMove(){
    for (var i = 0; i < 16; i++){
      if (!d.cells[i]) return true;
      var r = Math.floor(i / 4), c = i % 4;
      if (c < 3 && d.cells[i] === d.cells[i + 1]) return true;
      if (r < 3 && d.cells[i] === d.cells[i + 4]) return true;
    }
    return false;
  }

  function idxFor(dir, r, k){
    if (dir === 0) return r * 4 + k;           
    if (dir === 1) return r * 4 + (3 - k);     
    if (dir === 2) return k * 4 + r;           
    return (3 - k) * 4 + r;                    
  }

  function move(dir){
    if (d.over) return;
    var changed = false;
    for (var r = 0; r < 4; r++){
      var vals = [], k;
      for (k = 0; k < 4; k++){
        var v = d.cells[idxFor(dir, r, k)];
        if (v) vals.push(v);
      }
      var out = [];
      for (var j = 0; j < vals.length; j++){
        if (j + 1 < vals.length && vals[j] === vals[j + 1]){
          out.push(vals[j] * 2);
          d.score += vals[j] * 2;
          j++;
        } else {
          out.push(vals[j]);
        }
      }
      while (out.length < 4) out.push(0);
      for (k = 0; k < 4; k++){
        var idx = idxFor(dir, r, k);
        if (d.cells[idx] !== out[k]) changed = true;
        d.cells[idx] = out[k];
      }
    }
    if (!changed) return;

    spawn();
    if (d.score > d.best) d.best = d.score;

    if (d.cells.indexOf(2048) !== -1 && !d.wonShown){
      d.wonShown = true;
      ovText.textContent = 'Победа! 2048 \u2713';
      overlay.classList.add('show');
    }
    if (!canMove()){
      d.over = true;
      ovText.textContent = 'Игра окончена';
      overlay.classList.add('show');
    }
    render();
    saveAll();
  }

  function restart(){
    for (var i = 0; i < 16; i++) d.cells[i] = 0;
    d.score = 0;
    d.over = false;
    d.wonShown = false;
    overlay.classList.remove('show');
    spawn();
    spawn();
    render();
    saveAll();
    w.el.focus();
  }

  b.querySelector('.w2048-new').addEventListener('click', function(e){
    e.stopPropagation();
    restart();
  });
  b.querySelector('.w2048-ov-btn').addEventListener('click', function(e){
    e.stopPropagation();
    restart();
  });

  if (d.over){
    ovText.textContent = 'Игра окончена';
    overlay.classList.add('show');
  }

  spawnIfFresh();
  function spawnIfFresh(){
    if (d.cells.every(function(v){ return v === 0; })){
      spawn();
      spawn();
    }
  }
  render();
}

function buildMines(w){
  var b = w.body;
  var d = w.data;
  var S = 9, M = 10, N = S * S;

  if (!Array.isArray(d.open) || d.open.length !== N){
    d.mines = null;
    d.open = [];
    d.flag = [];
    for (var q = 0; q < N; q++){ d.open.push(false); d.flag.push(false); }
    d.started = false;
    d.time = 0;
    d.over = false;
    d.win = false;
    d.boomIdx = -1;
  }
  if (typeof d.time !== 'number') d.time = 0;

  b.innerHTML =
    '<div class="wmin-top">' +
      '<span class="wmin-mines">' + pad3(M) + '</span>' +
      '<button class="wmin-face" title="Заново">\uD83D\uDE42</button>' +
      '<span class="wmin-time">' + pad3(d.time) + '</span>' +
    '</div>' +
    '<div class="wmin-grid"></div>' +
    '<div class="wmin-hint">ЛКМ — открыть, ПКМ — флажок</div>';

  var grid = b.querySelector('.wmin-grid');
  var minesEl = b.querySelector('.wmin-mines');
  var timeEl = b.querySelector('.wmin-time');
  var face = b.querySelector('.wmin-face');
  var cells = [];

  for (var i = 0; i < N; i++){
    var c = document.createElement('div');
    c.className = 'wmin-c';
    c.dataset.i = i;
    grid.appendChild(c);
    cells.push(c);
  }

  function neighbors(idx){
    var r = Math.floor(idx / S), cc = idx % S, out = [];
    for (var dr = -1; dr <= 1; dr++){
      for (var dc = -1; dc <= 1; dc++){
        if (!dr && !dc) continue;
        var rr = r + dr, k = cc + dc;
        if (rr >= 0 && rr < S && k >= 0 && k < S) out.push(rr * S + k);
      }
    }
    return out;
  }

  function countNear(idx){
    var n = 0;
    neighbors(idx).forEach(function(j){ if (d.mines[j]) n++; });
    return n;
  }

  function startTimer(){
    stopTimer();
    w._tmr = setInterval(function(){
      d.time = Math.min(999, d.time + 1);
      timeEl.textContent = pad3(d.time);
      if (d.time % 3 === 0) saveAll();
    }, 1000);
  }
  function stopTimer(){
    if (w._tmr){ clearInterval(w._tmr); w._tmr = null; }
  }
  w._cleanup = stopTimer;

  function updateCounter(){
    var flags = 0;
    for (var i = 0; i < N; i++) if (d.flag[i] && !d.open[i]) flags++;
    minesEl.textContent = pad3(Math.max(0, M - flags));
  }

  function renderCell(idx){
    var c = cells[idx];
    var cls = 'wmin-c';
    var txt = '';
    if (d.flag[idx] && !d.open[idx]){
      txt = '\uD83D\uDEA9';
    } else if (d.open[idx]){
      cls += ' open';
      if (d.mines[idx]){
        txt = '\uD83D\uDCA5';
        if (idx === d.boomIdx) cls += ' boom';
      } else {
        var n = countNear(idx);
        if (n){ txt = String(n); cls += ' n' + n; }
      }
    } else if (d.over && d.mines && d.mines[idx]){
      txt = '\uD83D\uDCA5';
    }
    c.className = cls;
    c.textContent = txt;
  }

  function renderAll(){
    for (var i = 0; i < N; i++) renderCell(i);
    updateCounter();
    timeEl.textContent = pad3(d.time);
    face.textContent = d.over ? (d.win ? '\uD83D\uDE0E' : '\uD83D\uDE35') : '\uD83D\uDE42';
  }

  function placeMines(safeIdx){
    var forbidden = {};
    forbidden[safeIdx] = true;
    neighbors(safeIdx).forEach(function(j){ forbidden[j] = true; });
    var pool = [];
    for (var i = 0; i < N; i++) if (!forbidden[i]) pool.push(i);
    for (var j = pool.length - 1; j > 0; j--){
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = pool[j]; pool[j] = pool[k]; pool[k] = tmp;
    }
    d.mines = [];
    for (i = 0; i < N; i++) d.mines.push(false);
    for (i = 0; i < M; i++) d.mines[pool[i]] = true;
    d.started = true;
    startTimer();
  }

  function openCell(idx){
    if (d.open[idx] || d.flag[idx]) return;
    d.open[idx] = true;
    if (d.mines[idx]) return;
    if (countNear(idx) === 0){
      neighbors(idx).forEach(openCell);
    }
  }

  function checkWin(){
    var opened = 0;
    for (var i = 0; i < N; i++) if (d.open[i]) opened++;
    if (opened === N - M){
      d.win = true;
      d.over = true;
      stopTimer();
      for (i = 0; i < N; i++) if (d.mines[i]) d.flag[i] = true;
      if (window.HENCORE && HENCORE.notify)
        HENCORE.notify('Сапёр', 'Поле разминировано за ' + d.time + ' с! \u270C');
    }
  }

  function restart(){
    d.mines = null;
    for (var i = 0; i < N; i++){ d.open[i] = false; d.flag[i] = false; }
    d.started = false;
    d.time = 0;
    d.over = false;
    d.win = false;
    d.boomIdx = -1;
    stopTimer();
    renderAll();
    saveAll();
  }

  grid.addEventListener('click', function(e){
    var c = e.target.closest('.wmin-c');
    if (!c || d.over) return;
    var idx = Number(c.dataset.i);
    if (d.flag[idx]) return;
    if (!d.started) placeMines(idx);
    if (d.mines[idx]){
      d.over = true;
      d.win = false;
      d.boomIdx = idx;
      stopTimer();
      renderAll();
      saveAll();
      return;
    }
    openCell(idx);
    checkWin();
    renderAll();
    saveAll();
  });

  grid.addEventListener('contextmenu', function(e){
    var c = e.target.closest('.wmin-c');
    if (!c || d.over) return;
    e.preventDefault();
    e.stopPropagation();
    var idx = Number(c.dataset.i);
    if (d.open[idx]) return;
    d.flag[idx] = !d.flag[idx];
    updateCounter();
    renderCell(idx);
    saveAll();
  });

  face.addEventListener('click', function(e){
    e.stopPropagation();
    restart();
  });

  if (d.started && !d.over) startTimer();
  renderAll();
}

DEFS.g2048.menu = function(w, items){
  items.push({
    label: 'Новая игра',
    action: function(){
      var btn = w.body.querySelector('.w2048-new');
      if (btn) btn.click();
    }
  });
};
DEFS.mines.menu = function(w, items){
  items.push({
    label: 'Новая игра',
    action: function(){
      var btn = w.body.querySelector('.wmin-face');
      if (btn) btn.click();
    }
  });
};

function injectStyles(){
  var st = document.createElement('style');
  st.id = 'hc-widget-styles';
  st.textContent = [
    '#hc-wdg-layer{position:fixed;left:0;top:0;right:0;bottom:48px;pointer-events:none;z-index:3}',
    '.hc-wdg{position:absolute;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;',
      'background:rgba(18,21,26,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);',
      'border:1px solid var(--hc-border,rgba(255,255,255,.14));border-radius:14px;',
      'box-shadow:0 14px 34px rgba(0,0,0,.45);color:var(--hc-text,#e8eaed);',
      'font-family:inherit;user-select:none;-webkit-user-select:none}',
    'html[data-theme="light"] .hc-wdg{background:rgba(250,250,252,.9);color:#202124;',
      'border-color:#d3d7de;box-shadow:0 10px 26px rgba(0,0,0,.18)}',
    '.hc-wdg-head{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:move;',
      'flex:0 0 auto;touch-action:none}',
    '.hc-wdg-title{font-size:12px;font-weight:600;opacity:.75;flex:1;white-space:nowrap;overflow:hidden}',
    '.hc-wdg-close{all:unset;cursor:pointer;width:20px;height:20px;border-radius:6px;',
      'display:flex;align-items:center;justify-content:center;font-size:11px;opacity:.7}',
    '.hc-wdg-close:hover{background:rgba(255,255,255,.14);opacity:1}',
    'html[data-theme="light"] .hc-wdg-close:hover{background:rgba(0,0,0,.08)}',
    '.hc-wdg-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 10px 10px}',

    '.wdg-clk-time{font-size:38px;font-weight:700;letter-spacing:1px;text-align:center;',
      'font-variant-numeric:tabular-nums;line-height:1.15;margin-top:4px}',
    '.wdg-clk-date{text-align:center;font-size:13px;opacity:.75;margin-top:2px}',

    '.wdg-cal-head{display:flex;align-items:center;justify-content:space-between;',
      'font-size:13px;font-weight:600}',
    '.wdg-cal-mon{white-space:nowrap}',
    '.wdg-cal-nav{all:unset;cursor:pointer;padding:2px 10px;border-radius:7px;font-size:15px;line-height:1}',
    '.wdg-cal-nav:hover{background:rgba(127,127,127,.22)}',
    '.wdg-cal-week,.wdg-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;',
      'text-align:center;font-size:11.5px}',
    '.wdg-cal-week{margin:8px 0 2px;opacity:.6;flex:0 0 auto}',
    '.wdg-cal-grid{flex:1;align-content:space-between}',
    '.wdg-cal-day{padding:3px 0;border-radius:6px}',
    '.wdg-cal-day.today{background:var(--accent,#4cc2ff);color:#fff;font-weight:700}',
    '.wdg-cal-day.other{opacity:.35}',

    '.wdg-notes-ta{flex:1;resize:none;border:none;background:transparent;color:inherit;',
      'font:inherit;font-size:13px;line-height:1.45;outline:none;',
      'user-select:text;-webkit-user-select:text}',
    '.wdg-notes-ta::placeholder{opacity:.4}',
    '.wdg-notes-hint{font-size:10.5px;opacity:.45;text-align:right;margin-top:4px}',

    '.w2048-top{display:flex;align-items:stretch;justify-content:space-between;gap:8px;margin-bottom:8px}',
    '.w2048-score{display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'background:rgba(127,127,127,.14);border-radius:8px;padding:2px 10px;min-width:58px}',
    '.w2048-score span{font-size:9.5px;opacity:.6}',
    '.w2048-score b{font-size:14px}',
    '.w2048-new,.w2048-ov-btn{all:unset;cursor:pointer;font-size:11.5px;padding:6px 10px;',
      'border-radius:8px;background:rgba(127,127,127,.2)}',
    '.w2048-new:hover,.w2048-ov-btn:hover{background:rgba(127,127,127,.34)}',
    '.w2048-grid{flex:0 0 auto;aspect-ratio:1/1;display:grid;grid-template-columns:repeat(4,1fr);',
      'grid-template-rows:repeat(4,1fr);gap:6px;position:relative}',
    '.w2048-cell{border-radius:8px;background:rgba(127,127,127,.16);',
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px}',
    '.w2048-cell.t128,.w2048-cell.t256{font-size:19px}',
    '.w2048-cell.t512,.w2048-cell.t1024{font-size:17px}',
    '.w2048-cell.t2048,.w2048-cell.t4096,.w2048-cell.t8192,.w2048-cell.tbig{font-size:15px}',
    '.w2048-cell.t2{background:#eee4da;color:#776e65}',
    '.w2048-cell.t4{background:#ede0c8;color:#776e65}',
    '.w2048-cell.t8{background:#f2b179;color:#fff}',
    '.w2048-cell.t16{background:#f59563;color:#fff}',
    '.w2048-cell.t32{background:#f67c5f;color:#fff}',
    '.w2048-cell.t64{background:#f65e3b;color:#fff}',
    '.w2048-cell.t128{background:#edcf72;color:#fff}',
    '.w2048-cell.t256{background:#edcc61;color:#fff}',
    '.w2048-cell.t512{background:#edc850;color:#fff}',
    '.w2048-cell.t1024{background:#edc53f;color:#fff}',
    '.w2048-cell.t2048{background:#edc22e;color:#fff}',
    '.w2048-cell.t4096{background:#a78bfa;color:#fff}',
    '.w2048-cell.t8192{background:#8b5cf6;color:#fff}',
    '.w2048-cell.tbig{background:#3c3a32;color:#fff}',
    '.w2048-hint{font-size:10.5px;opacity:.5;text-align:center;margin-top:8px}',
    '.w2048-overlay{position:absolute;inset:0;border-radius:8px;background:rgba(15,17,21,.74);',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
      'font-weight:700;font-size:19px;opacity:0;pointer-events:none;transition:opacity .25s}',
    '.w2048-overlay.show{opacity:1;pointer-events:auto}',

    '.wmin-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
    '.wmin-mines,.wmin-time{font-variant-numeric:tabular-nums;background:rgba(0,0,0,.28);',
      'border-radius:7px;padding:3px 9px;font-weight:700;font-size:14px}',
    'html[data-theme="light"] .wmin-mines,html[data-theme="light"] .wmin-time{background:rgba(0,0,0,.1)}',
    '.wmin-face{all:unset;cursor:pointer;font-size:19px;line-height:1}',
    '.wmin-grid{flex:0 0 auto;display:grid;grid-template-columns:repeat(9,1fr);gap:2px}',
    '.wmin-c{aspect-ratio:1/1;cursor:pointer;border-radius:5px;background:rgba(127,127,127,.26);',
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}',
    '.wmin-c:hover:not(.open){background:rgba(127,127,127,.42)}',
    '.wmin-c.open{background:rgba(127,127,127,.1);cursor:default}',
    '.wmin-c.boom{background:#e5484d;color:#fff}',
    '.wmin-c.n1{color:#5b9dff}.wmin-c.n2{color:#4ade80}.wmin-c.n3{color:#f87171}',
    '.wmin-c.n4{color:#818cf8}.wmin-c.n5{color:#fbbf24}.wmin-c.n6{color:#22d3ee}',
    '.wmin-c.n7{color:#cbd5e1}.wmin-c.n8{color:#f0abfc}',
    'html[data-theme="light"] .wmin-c.n7{color:#64748b}',
    '.wmin-hint{font-size:10.5px;opacity:.5;text-align:center;margin-top:8px}'
  ].join('\n');
  (document.head || document.body).appendChild(st);
}

function init(){
  desktopEl = document.getElementById('desktop');
  layer = document.createElement('div');
  layer.id = 'hc-wdg-layer';
  document.body.appendChild(layer);

  injectStyles();

  if (desktopEl) desktopEl.addEventListener('contextmenu', handleCtx);
  document.addEventListener('contextmenu', handleCtx);

  widgets = loadAll();
  widgets.forEach(renderWidget);
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();

(function () {
'use strict';

const style = document.createElement('style');
style.textContent = `
  .sc-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);
    display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif}
  .sc-overlay.hidden{display:none}
  .sc-dialog{background:#1b1e24;border:1px solid #2e3440;border-radius:14px;padding:22px;
    min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,.55);color:#e8eaed}
  .sc-title{font-size:17px;font-weight:600;margin-bottom:4px}
  .sc-sub{font-size:12.5px;opacity:.6;margin-bottom:16px}
  .sc-actions{display:flex;flex-direction:column;gap:8px}
  .sc-btn{all:unset;cursor:pointer;padding:11px 14px;border-radius:10px;font-size:14px;
    border:1px solid #2e3440;transition:.15s;text-align:center;color:#e8eaed}
  .sc-btn:hover{background:rgba(255,255,255,.08)}
  .sc-btn.rec{border-color:#ef4444;color:#ef4444}
  .sc-cancel{font-size:12.5px;opacity:.6;text-align:center;margin-top:12px;cursor:pointer}
  .sc-stop{position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:2147483001;
    display:flex;align-items:center;gap:10px;padding:10px 20px;border-radius:999px;
    background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:14px;
    font-family:system-ui,sans-serif;box-shadow:0 8px 24px rgba(239,68,68,.45)}
  .sc-stop .dot{width:10px;height:10px;border-radius:50%;background:#fff}
  .sc-timer{font-variant-numeric:tabular-nums}
`;
document.head.appendChild(style);

function notify(title, text) {
  if (window.HENCORE && HENCORE.notify) HENCORE.notify(title, text);
  else console.log('[ScreenTool] ' + title + ': ' + text);
}

function pad(n) { return String(n).padStart(2, '0'); }

function fileName(ext) {
  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
  return (ext === 'png' ? 'Скриншот ' : 'Запись экрана ') + stamp + '.' + ext;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}

let overlay = null;

function openChooser() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'sc-overlay';
  overlay.innerHTML =
    '<div class="sc-dialog">' +
      '<div class="sc-title">Захват экрана</div>' +
      '<div class="sc-sub">Ctrl+S &middot; что сделать?</div>' +
      '<div class="sc-actions">' +
        '<button class="sc-btn" data-act="shot">Сделать скриншот</button>' +
        '<button class="sc-btn rec" data-act="rec">Записать видео экрана</button>' +
      '</div>' +
      '<div class="sc-cancel">Отмена (Esc)</div>' +
    '</div>';

  overlay.querySelector('[data-act="shot"]').addEventListener('click', function () {
    closeChooser();
    takeScreenshot();
  });
  overlay.querySelector('[data-act="rec"]').addEventListener('click', function () {
    closeChooser();
    startRecording();
  });
  overlay.querySelector('.sc-cancel').addEventListener('click', closeChooser);
  overlay.addEventListener('pointerdown', function (e) {
    if (e.target === overlay) closeChooser();
  });

  document.body.appendChild(overlay);
}

function closeChooser() {
  if (overlay) { overlay.remove(); overlay = null; }
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeChooser();
});

document.addEventListener('keydown', function (e) {
  const key = (e.key || '').toLowerCase();
  const isS = key === 's' || key === 'ы';    
  if ((e.ctrlKey || e.metaKey) && isS && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    openChooser();
  }
}, true);

async function takeScreenshot() {
  let stream;
  try {
     
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    });
  } catch (e) {
    notify('Скриншот', 'Захват отменён или не разрешён.');
    return;
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  await new Promise(function (res) { video.onloadedmetadata = res; });
  await video.play();
   
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  stream.getTracks().forEach(function (t) { t.stop(); });

  canvas.toBlob(function (blob) {
    if (blob) {
      downloadBlob(blob, fileName('png'));
      notify('Скриншот', 'Скриншот сохранён: ' + fileName('png'));
    } else {
      notify('Скриншот', 'Не удалось создать изображение.');
    }
  }, 'image/png');
}

let recorder = null;
let chunks = [];
let stopBtn = null;
let timerInt = null;

async function startRecording() {
  let stream;
  try {
     
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: { echoCancellation: false, noiseSuppression: false }
    });
  } catch (e) {
    notify('Запись экрана', 'Захват отменён или не разрешён.');
    return;
  }

  stream.getVideoTracks()[0].addEventListener('ended', stopRecording);

  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(function (m) { return MediaRecorder.isTypeSupported(m); }) || '';

  recorder = new MediaRecorder(stream, mime
    ? { mimeType: mime, videoBitsPerSecond: 8000000 }
    : undefined);
  chunks = [];

  recorder.ondataavailable = function (e) {
    if (e.data && e.data.size) chunks.push(e.data);
  };

  recorder.onstop = function () {
    stream.getTracks().forEach(function (t) { t.stop(); });
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    downloadBlob(blob, fileName('webm'));
    notify('Запись экрана', 'Видео сохранено: ' + fileName('webm'));
    cleanupRecording();
  };

  recorder.start(1000);
  showStopBar();
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function showStopBar() {
  const start = Date.now();
  stopBtn = document.createElement('button');
  stopBtn.className = 'sc-stop';
  stopBtn.title = 'Остановить запись (или Esc)';
  stopBtn.innerHTML = '<span class="dot"></span><span>Запись идёт</span><span class="sc-timer">00:00</span>';

  const timerEl = stopBtn.querySelector('.sc-timer');
  timerInt = setInterval(function () {
    const s = Math.floor((Date.now() - start) / 1000);
    timerEl.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }, 500);

  stopBtn.addEventListener('click', stopRecording);
  document.body.appendChild(stopBtn);

  document.addEventListener('keydown', scEscStop, true);
}

function scEscStop(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stopRecording();
  }
}

function cleanupRecording() {
  clearInterval(timerInt);
  if (stopBtn) { stopBtn.remove(); stopBtn = null; }
  document.removeEventListener('keydown', scEscStop, true);
  recorder = null;
  chunks = [];
}

window.ScreenTool = {
  open: openChooser,           
  screenshot: takeScreenshot,  
  record: startRecording,      
  stop: stopRecording          
};

})();
 
(function initTaskbarScroll(){
  const bar = document.getElementById('taskitems');
  if (!bar) return;

  const st = document.createElement('style');
  st.textContent = [
    '#taskitems{overflow-x:auto !important;overflow-y:hidden !important;',
      'scrollbar-width:none !important;-ms-overflow-style:none !important;',
      'flex:1 1 auto !important;min-width:0 !important}',
    '#taskitems::-webkit-scrollbar{display:none !important;width:0;height:0}',
    '#taskitems .task-item{flex:0 0 auto}',
    '.hc-tb-arrow{all:unset;box-sizing:border-box;display:none;align-items:center;justify-content:center;',
      'width:20px;min-width:20px;height:100%;cursor:pointer;color:var(--hc-text,#e8eaed);',
      'flex:0 0 auto;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}',
    '.hc-tb-arrow.show{display:flex}',
    '.hc-tb-arrow:hover{background:var(--hc-hover,rgba(255,255,255,.12))}',
    '.hc-tb-arrow:active{background:var(--hc-hover,rgba(255,255,255,.2))}',
    '.hc-tb-arrow svg{display:block;pointer-events:none}'
  ].join('\n');
  (document.head || document.body).appendChild(st);

  const CHEV_L = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  const CHEV_R = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';

  function makeArrow(dir){
    const b = document.createElement('button');
    b.className = 'hc-tb-arrow';
    b.innerHTML = dir < 0 ? CHEV_L : CHEV_R;
    b.title = dir < 0 ? 'Прокрутить влево' : 'Прокрутить вправо';
    b.setAttribute('aria-label', b.title);

    let t1 = null, t2 = null;
    const step = function(){ bar.scrollBy({ left: dir * 200, behavior: 'auto' }); };
    b.addEventListener('pointerdown', function(e){
      e.preventDefault();
      step();
      t1 = setTimeout(function(){ t2 = setInterval(step, 130); }, 400);
    });
    function stop(){ clearTimeout(t1); clearInterval(t2); t1 = t2 = null; }
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function(ev){
      b.addEventListener(ev, stop);
    });
    return b;
  }

  const leftBtn = makeArrow(-1);
  const rightBtn = makeArrow(1);
  bar.parentNode.insertBefore(leftBtn, bar);
  bar.parentNode.insertBefore(rightBtn, bar.nextSibling);

  function syncArrows(){
    const max = bar.scrollWidth - bar.clientWidth;
    const over = max > 2;
    leftBtn.classList.toggle('show', over && bar.scrollLeft > 2);
    rightBtn.classList.toggle('show', over && bar.scrollLeft < max - 2);
  }
  bar.addEventListener('scroll', syncArrows, { passive: true });
  window.addEventListener('resize', syncArrows);
  new MutationObserver(syncArrows).observe(bar, { childList: true });
  requestAnimationFrame(syncArrows);

  bar.addEventListener('wheel', function(e){
    if (bar.scrollWidth <= bar.clientWidth) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    bar.scrollLeft += d;
  }, { passive: false });

  function scrollBtnIntoView(btn){
    if (!btn) return;
    requestAnimationFrame(function(){
      const b = btn.getBoundingClientRect();
      const c = bar.getBoundingClientRect();
      if (b.left < c.left) bar.scrollBy({ left: b.left - c.left - 8, behavior: 'smooth' });
      else if (b.right > c.right) bar.scrollBy({ left: b.right - c.right + 8, behavior: 'smooth' });
    });
  }

  if (typeof focusWin === 'function'){
    const _focusWin = focusWin;
    focusWin = function(win){
      _focusWin.apply(this, arguments);
      if (win && win.taskBtn && !win.minimized) scrollBtnIntoView(win.taskBtn);
    };
  }
  if (typeof renderTaskbar === 'function'){
    const _renderTaskbar = renderTaskbar;
    renderTaskbar = function(){
      _renderTaskbar.apply(this, arguments);
      requestAnimationFrame(function(){
        syncArrows();
        if (activeWin && activeWin.taskBtn && !activeWin.minimized) scrollBtnIntoView(activeWin.taskBtn);
      });
    };
  }
})();
'use strict';

(function greetingOnLogin(){

  function getGreeting(h){
    if (h >= 5  && h < 12) return 'Доброе утро, Администратор';
    if (h >= 12 && h < 18) return 'Добрый день, Администратор';
    if (h >= 18 && h < 23) return 'Добрый вечер, Администратор';
    return 'Доброй ночи, Администратор';   
  }

  function tryNotify(attempt){
    if (window.HENCORE && typeof window.HENCORE.notify === 'function'){
      const hour = new Date().getHours();
      window.HENCORE.notify('Система', getGreeting(hour) + '!');
    } else if (attempt < 50){

      setTimeout(function(){ tryNotify(attempt + 1); }, 100);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tryNotify(0); });
  } else {
    tryNotify(0);
  }
})();

'use strict';

(function () {

  if (typeof buildSettingsUI !== 'function' || typeof HENCORE === 'undefined') {
    console.warn('[LockScreen] Ядро HENCORE OS не найдено — аддон отключён. Подключите файл после CoreOS.js');
    return;
  }

  var LOCK_KEY   = 'hencore_os_lock_v1';
  var DEF_LOCK   = { method: 'off', pin: '', pass: '', showNotifs: true, maxNotifs: 3, idleMin: 0 };
  var METHODS    = ['off', 'swipe', 'pin', 'pass'];
  var METHOD_TXT = { off: 'Отключено', swipe: 'Кнопка (без пароля)', pin: 'PIN-код', pass: 'Пароль' };

  var lockCfg = (function () {
    try {
      var raw = JSON.parse(localStorage.getItem(LOCK_KEY));
      if (raw && typeof raw === 'object') return Object.assign({}, DEF_LOCK, raw);
    } catch (e) {}
    return Object.assign({}, DEF_LOCK);
  })();

  function saveLock() {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(lockCfg)); } catch (e) {}
  }

  function hashSecret(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'h' + h.toString(36) + '_' + s.length.toString(36);
  }

  function hasSecret() {
    if (lockCfg.method === 'pin')  return !!lockCfg.pin;
    if (lockCfg.method === 'pass') return !!lockCfg.pass;
    return true;
  }

  (function injectLockStyles() {
    var st = document.createElement('style');
    st.textContent = [
      '#hc-lock{position:fixed;inset:0;z-index:999999;display:none;flex-direction:column;',
        'align-items:center;justify-content:center;gap:14px;color:#fff;',
        'background-size:cover;background-position:center;',
        'font-family:inherit;user-select:none;-webkit-user-select:none;}',
      '#hc-lock.open{display:flex}',
      '#hc-lock::before{content:"";position:absolute;inset:0;',
        'background:rgba(8,10,14,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
      '#hc-lock > *{position:relative;z-index:1}',
      '#hc-lock .lc-clock{font-size:64px;font-weight:600;letter-spacing:2px;line-height:1;',
        'text-shadow:0 2px 18px rgba(0,0,0,.6)}',
      '#hc-lock .lc-date{font-size:15px;opacity:.85;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
      '#hc-lock .lc-hello{font-size:14px;opacity:.7;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
      '#hc-lock .lc-card{width:290px;max-width:90vw;padding:16px;border-radius:16px;',
        'background:rgba(18,21,26,.72);border:1px solid rgba(255,255,255,.16);',
        'box-shadow:0 16px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px;',
        'align-items:center}',
      '#hc-lock .lc-dots{display:flex;gap:9px;height:12px;align-items:center}',
      '#hc-lock .lc-dots i{width:10px;height:10px;border-radius:50%;',
        'background:rgba(255,255,255,.28);transition:all .15s}',
      '#hc-lock .lc-dots i.f{background:var(--accent,#4cc2ff);transform:scale(1.15)}',
      '#hc-lock .lc-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:230px}',
      '#hc-lock .lc-key{all:unset;cursor:pointer;text-align:center;font-size:19px;padding:11px 0;',
        'border-radius:12px;background:rgba(255,255,255,.1);transition:background .12s}',
      '#hc-lock .lc-key:hover{background:rgba(255,255,255,.2)}',
      '#hc-lock .lc-key:active{background:rgba(255,255,255,.32)}',
      '#hc-lock .lc-key.ghost{font-size:14px}',
      '#hc-lock .lc-pass{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);',
        'background:rgba(255,255,255,.1);color:#fff;font-size:14px;outline:none;text-align:center}',
      '#hc-lock .lc-pass::placeholder{color:rgba(255,255,255,.5)}',
      '#hc-lock .lc-btn{all:unset;cursor:pointer;font-size:13.5px;padding:9px 16px;border-radius:10px;',
        'background:rgba(255,255,255,.14)}',
      '#hc-lock .lc-btn:hover{background:rgba(255,255,255,.24)}',
      '#hc-lock .lc-btn.accent{background:var(--accent,#4cc2ff);color:#0b0e13;font-weight:600}',
      '#hc-lock .lc-err{font-size:12.5px;color:#ff8a8a;min-height:16px;text-align:center}',
      '#hc-lock .lc-notifs{width:290px;max-width:90vw;display:flex;flex-direction:column;gap:6px;',
        'max-height:34vh;overflow-y:auto}',
      '#hc-lock .lc-notif{padding:9px 12px;border-radius:12px;background:rgba(18,21,26,.72);',
        'border:1px solid rgba(255,255,255,.14);text-shadow:0 1px 6px rgba(0,0,0,.5)}',
      '#hc-lock .lc-notif .t{font-size:12.5px;font-weight:600}',
      '#hc-lock .lc-notif .x{font-size:12px;opacity:.8;word-break:break-word}',
      '#hc-lock .lc-notif .w{font-size:10.5px;opacity:.55;margin-top:2px}',
      '#hc-lock .lc-shake{animation:lc-shake .4s}',
      '@keyframes lc-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}',
        '40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}',
      'html[data-theme="light"] #hc-lock::before{background:rgba(240,242,246,.5)}',
      'html[data-theme="light"] #hc-lock .lc-card{background:rgba(250,250,252,.8);color:#202124;',
        'border-color:rgba(0,0,0,.12)}',
      'html[data-theme="light"] #hc-lock .lc-clock,',
      'html[data-theme="light"] #hc-lock .lc-date,',
      'html[data-theme="light"] #hc-lock .lc-hello{color:#202124;text-shadow:0 1px 8px rgba(255,255,255,.6)}',
      'html[data-theme="light"] #hc-lock .lc-key{background:rgba(0,0,0,.08)}',
      'html[data-theme="light"] #hc-lock .lc-key:hover{background:rgba(0,0,0,.16)}',
      'html[data-theme="light"] #hc-lock .lc-pass{background:rgba(0,0,0,.06);color:#202124;',
        'border-color:rgba(0,0,0,.25)}',
      'html[data-theme="light"] #hc-lock .lc-notif{background:rgba(250,250,252,.82);color:#202124;',
        'border-color:rgba(0,0,0,.12)}',
      '/* раздел в настройках */',
      '.lc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}',
      '.lc-row label{font-size:12.5px}'
    ].join('\n');
    (document.head || document.body).appendChild(st);
  })();

  var lockEl = null;
  var lockOpen = false;

  function ensureLockEl() {
    if (lockEl) return lockEl;
    lockEl = document.createElement('div');
    lockEl.id = 'hc-lock';
    lockEl.setAttribute('role', 'dialog');
    lockEl.setAttribute('aria-label', 'Экран блокировки');
    document.body.appendChild(lockEl);
    return lockEl;
  }

  function lockWallpaper() {
    try {
      var w = settings.wallpaper, url;
      if (typeof w === 'string' && w.indexOf('c:') === 0) {
        url = customUrlCache[w.slice(2)] || WALLPAPERS[0];
      } else {
        url = WALLPAPERS[Number(w) || 0] || WALLPAPERS[0];
      }
      ensureLockEl().style.backgroundImage = 'url("' + url + '")';
    } catch (e) {}
  }

  function greeting() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12)  return 'Доброе утро, Администратор';
    if (h >= 12 && h < 18) return 'Добрый день, Администратор';
    if (h >= 18 && h < 23) return 'Добрый вечер, Администратор';
    return 'Доброй ночи, Администратор';
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function tickClock() {
    if (!lockOpen || !lockEl) return;
    var d = new Date();
    var c = lockEl.querySelector('.lc-clock');
    var t = lockEl.querySelector('.lc-date');
    if (c) c.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (t) t.textContent = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  }
  setInterval(tickClock, 1000);

  function renderLockNotifs() {
    if (!lockEl) return;
    var box = lockEl.querySelector('.lc-notifs');
    if (!box) return;
    box.innerHTML = '';
    if (!lockCfg.showNotifs) return;
    var list = [];
    try {
      if (typeof notifications !== 'undefined' && Array.isArray(notifications)) {
        list = notifications.slice(0, lockCfg.maxNotifs > 0 ? lockCfg.maxNotifs : 10);
      }
    } catch (e) {}
    if (!list.length) return;
    list.forEach(function (n) {
      var d = document.createElement('div');
      d.className = 'lc-notif';
      var t = new Date(n.t);
      d.innerHTML =
        '<div class="t"></div>' +
        '<div class="x"></div>' +
        '<div class="w">' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + '</div>';
      d.querySelector('.t').textContent = n.title || 'Уведомление';
      d.querySelector('.x').textContent = n.text || '';
      box.appendChild(d);
    });
  }

  function secretInput(method) {
    if (method === 'pin')  return lockCfg.pin;
    if (method === 'pass') return lockCfg.pass;
    return '';
  }

  function buildUnlockUI() {
    var el = ensureLockEl();
    var card = el.querySelector('.lc-card');
    if (card) card.remove();

    card = document.createElement('div');
    card.className = 'lc-card';

    var err = document.createElement('div');
    err.className = 'lc-err';

    if (lockCfg.method === 'pin' && hasSecret()) {
      var dots = document.createElement('div');
      dots.className = 'lc-dots';
      for (var i = 0; i < lockCfg.pin.length; i++) dots.appendChild(document.createElement('i'));
      var pad_ = document.createElement('div');
      pad_.className = 'lc-keypad';
      var keys = ['1','2','3','4','5','6','7','8','9','⌫','0','→'];
      var entered = '';
      var dotEls = dots.querySelectorAll('i');
      function paint() {
        for (var i = 0; i < dotEls.length; i++) dotEls[i].classList.toggle('f', i < entered.length);
      }
      function submit() {
        if (hashSecret(entered) === lockCfg.pin) unlock(true);
        else { fail(err, dots); entered = ''; paint(); }
      }
      keys.forEach(function (k) {
        var b = document.createElement('button');
        b.className = 'lc-key' + (k.length > 1 ? ' ghost' : '');
        b.textContent = k;
        b.addEventListener('click', function () {
          if (k === '⌫') { entered = entered.slice(0, -1); paint(); return; }
          if (k === '→') { submit(); return; }
          if (entered.length >= lockCfg.pin.length) return;
          entered += k;
          paint();
          err.textContent = '';
          if (entered.length === lockCfg.pin.length) setTimeout(submit, 120);
        });
        pad_.appendChild(b);
      });
      card.appendChild(dots);
      card.appendChild(pad_);
    } else if (lockCfg.method === 'pass' && hasSecret()) {
      var inp = document.createElement('input');
      inp.className = 'lc-pass';
      inp.type = 'password';
      inp.placeholder = 'Введите пароль';
      inp.autocomplete = 'off';
      var ok = document.createElement('button');
      ok.className = 'lc-btn accent';
      ok.textContent = 'Войти';
      ok.addEventListener('click', function () {
        if (hashSecret(inp.value) === lockCfg.pass) unlock(true);
        else fail(err, card);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') ok.click();
      });
      card.appendChild(inp);
      card.appendChild(ok);
      setTimeout(function () { inp.focus(); }, 50);
    } else {
       
      var b = document.createElement('button');
      b.className = 'lc-btn accent';
      b.textContent = 'Разблокировать';
      b.addEventListener('click', function () { unlock(false); });
      card.appendChild(b);
      if (lockCfg.method !== 'swipe' && !hasSecret()) {
        err.textContent = METHOD_TXT[lockCfg.method] + ' не задан — задайте его в Настройках.';
      }
    }

    card.appendChild(err);
    el.appendChild(card);
  }

  function fail(errEl, shakeTarget) {
    if (errEl) errEl.textContent = 'Неверно. Попробуйте ещё раз.';
    if (shakeTarget) {
      shakeTarget.classList.remove('lc-shake');
      void shakeTarget.offsetWidth;
      shakeTarget.classList.add('lc-shake');
    }
  }

  function showLock() {
    if (lockOpen) return;
    var el = ensureLockEl();
    lockWallpaper();

    el.innerHTML =
      '<div class="lc-clock"></div>' +
      '<div class="lc-date"></div>' +
      '<div class="lc-hello"></div>' +
      '<div class="lc-notifs"></div>';

    el.querySelector('.lc-hello').textContent = greeting();
    buildUnlockUI();
    renderLockNotifs();

    try { closeAllPops(); } catch (e) {}
    try { if (typeof toggleStartMenu === 'function') toggleStartMenu(false); } catch (e) {}

    el.classList.add('open');
    lockOpen = true;
    lastActivity = Date.now();
    tickClock();
  }

  function unlock() {
    if (!lockOpen || !lockEl) return;
    lockEl.classList.remove('open');
    lockEl.innerHTML = '';
    lockOpen = false;
    lastActivity = Date.now();
  }

  HENCORE.lock = function () { showLock(); };

  var lastActivity = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'pointermove'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastActivity = Date.now(); }, { passive: true });
  });

  setInterval(function () {
    if (!lockOpen || lockCfg.idleMin <= 0) return;
    if (Date.now() - lastActivity >= lockCfg.idleMin * 60000) showLock();
  }, 15000);

  window.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (lockCfg.method !== 'off' && typeof desktop !== 'undefined') showLock();
    }, 700);
  });

  function buildLockSection(root) {

    root.insertAdjacentHTML('beforeend',
      '<div class="st-section" id="lc-section"><h3>Экран блокировки</h3>' +

        '<div class="lc-row"><label>Способ входа:</label>' +
          '<div class="seg" id="lc-method">' +
            '<button data-v="off">Отключено</button>' +
            '<button data-v="swipe">Кнопка</button>' +
            '<button data-v="pin">PIN-код</button>' +
            '<button data-v="pass">Пароль</button>' +
          '</div>' +
        '</div>' +

        '<div class="lc-row" id="lc-secret-row">' +
          '<label id="lc-secret-lbl">PIN-код:</label>' +
          '<input type="password" id="lc-secret-inp" placeholder="4–8 символов" style="width:130px">' +
          '<button class="st-btn" id="lc-secret-save">Сохранить</button>' +
        '</div>' +

        '<div class="lc-row"><label>Уведомления на экране:</label>' +
          '<div class="seg" id="lc-notifs">' +
            '<button data-v="1">Показывать</button>' +
            '<button data-v="0">Скрывать</button>' +
          '</div>' +
          '<label>Сколько:</label>' +
          '<select id="lc-notifs-count">' +
            '<option value="1">1</option><option value="3">3</option>' +
            '<option value="5">5</option><option value="10">Все</option>' +
          '</select>' +
        '</div>' +

        '<div class="lc-row"><label>Автоблокировка при простое:</label>' +
          '<select id="lc-idle">' +
            '<option value="0">Выключена</option><option value="1">1 мин</option>' +
            '<option value="5">5 мин</option><option value="10">10 мин</option>' +
            '<option value="30">30 мин</option>' +
          '</select>' +
        '</div>' +

        '<div class="st-row">' +
          '<button class="st-btn accent" id="lc-now">Заблокировать сейчас</button>' +
        '</div>' +
        '<div class="st-hint">PIN и пароль хранятся только в этом браузере. ' +
          'Блокировка также включается при запуске системы и по вызову HENCORE.lock().</div>' +
      '</div>'
    );

    var $ = function (sel) { return root.querySelector(sel); };

    function refreshSecretRow() {
      var isPin  = lockCfg.method === 'pin';
      var isPass = lockCfg.method === 'pass';
      var row = $('#lc-secret-row');
      row.style.display = (isPin || isPass) ? '' : 'none';
      $('#lc-secret-lbl').textContent = isPin ? 'Новый PIN (4–8 цифр):' : 'Новый пароль:';
      var inp = $('#lc-secret-inp');
      inp.value = '';
      inp.placeholder = isPin ? '4–8 цифр' : 'минимум 4 символа';
    }

    var seg = $('#lc-method');
    seg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === lockCfg.method);
      b.addEventListener('click', function () {
        lockCfg.method = b.dataset.v;
        saveLock();
        seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        refreshSecretRow();
        if (lockCfg.method !== 'off' && !hasSecret() && lockCfg.method !== 'swipe') {
          HENCORE.notify('Экран блокировки', 'Задайте ' +
            (lockCfg.method === 'pin' ? 'PIN-код' : 'пароль') + ' ниже — иначе вход будет без защиты.');
        }
      });
    });

    $('#lc-secret-save').addEventListener('click', function () {
      var v = $('#lc-secret-inp').value;
      if (lockCfg.method === 'pin') {
        if (!/^\d{4,8}$/.test(v)) { HENCORE.notify('Экран блокировки', 'PIN — это от 4 до 8 цифр.'); return; }
        lockCfg.pin = hashSecret(v);
      } else if (lockCfg.method === 'pass') {
        if (v.length < 4) { HENCORE.notify('Экран блокировки', 'Пароль — минимум 4 символа.'); return; }
        lockCfg.pass = hashSecret(v);
      }
      saveLock();
      $('#lc-secret-inp').value = '';
      HENCORE.notify('Экран блокировки', 'Способ входа обновлён: ' + METHOD_TXT[lockCfg.method] + '.');
    });
    $('#lc-secret-inp').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#lc-secret-save').click();
    });

    var segN = $('#lc-notifs');
    segN.querySelectorAll('button').forEach(function (b) {
      var on = (lockCfg.showNotifs ? '1' : '0') === b.dataset.v;
      b.classList.toggle('on', on);
      b.addEventListener('click', function () {
        lockCfg.showNotifs = b.dataset.v === '1';
        saveLock();
        segN.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    var cnt = $('#lc-notifs-count');
    cnt.value = String(lockCfg.maxNotifs);
    cnt.addEventListener('change', function () {
      lockCfg.maxNotifs = Number(cnt.value) || 1;
      saveLock();
    });

    var idle = $('#lc-idle');
    idle.value = String(lockCfg.idleMin);
    idle.addEventListener('change', function () {
      lockCfg.idleMin = Number(idle.value) || 0;
      saveLock();
    });

    $('#lc-now').addEventListener('click', function () {
      if (lockCfg.method === 'off') {
        HENCORE.notify('Экран блокировки', 'Сначала выберите способ входа выше.');
        return;
      }
      if (!hasSecret() && lockCfg.method !== 'swipe') {
        HENCORE.notify('Экран блокировки', 'Сначала задайте ' +
          (lockCfg.method === 'pin' ? 'PIN-код' : 'пароль') + '.');
        return;
      }
      showLock();
    });

    refreshSecretRow();
  }

  var origBuildSettingsUI = buildSettingsUI;
  buildSettingsUI = function (root) {
    origBuildSettingsUI(root);
    try { buildLockSection(root); } catch (e) { console.warn('[LockScreen] раздел настроек:', e); }
  };

  console.log('[LockScreen] Экран блокировки включён');

})();

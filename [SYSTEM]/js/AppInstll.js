(function () {

  var DB_NAME = 'hencore_installed_apps';
  var STORE   = 'apps';
  var FLAG    = '__hcInstalled';   

  var installerUrl  = null;   
  var urlCache      = {};     
  var recordsCache  = {};     

  var INSTALLER_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect x="6" y="16" width="52" height="40" rx="7" fill="#4cc2ff"/>' +
    '<rect x="6" y="16" width="52" height="13" rx="7" fill="#2f9ed6"/>' +
    '<path d="M32 32v15m0 0l-8-8m8 8l8-8" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
  );

  var dbPromise = null;
  function openDb(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject){
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function(){ rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = function(){ resolve(rq.result); };
      rq.onerror   = function(){ reject(rq.error); };
    });
    return dbPromise;
  }

  function dbReq(store, method){
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject){
      var rq = store[method].apply(store, args);
      rq.onsuccess = function(){ resolve(rq.result); };
      rq.onerror   = function(){ reject(rq.error); };
    });
  }

  function genId(){
    return 'app' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fileToStorableBlob(file){
    if (file.arrayBuffer) {
      return file.arrayBuffer().then(function (buf){
        return new Blob([buf], { type: 'text/html' });
      });
    }
    return new Promise(function (resolve, reject){
      var r = new FileReader();
      r.onload  = function(){ resolve(new Blob([r.result], { type: 'text/html' })); };
      r.onerror = function(){ reject(r.error || new Error('Ошибка чтения файла')); };
      r.readAsArrayBuffer(file);
    });
  }

  function blobToDataUrl(blob){
    return new Promise(function (resolve, reject){
      var r = new FileReader();
      r.onload  = function(){ resolve(r.result); };
      r.onerror = function(){ reject(r.error || new Error('Ошибка чтения файла')); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl){
    var comma = dataUrl.indexOf(',');
    if (comma < 0) return new Blob([dataUrl], { type: 'text/html' });
    var head = dataUrl.slice(0, comma);
    var body = dataUrl.slice(comma + 1);
    var m    = head.match(/^data:([^;]*)(;base64)?$/);
    var mime = (m && m[1]) || 'text/html';
    if (m && m[2]){
      var raw = atob(body);
      var arr = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    try { return new Blob([decodeURIComponent(body)], { type: mime }); }
    catch (e){ return new Blob([body], { type: mime }); }
  }

  function addAppFromRecord(rec){
    recordsCache[rec.id] = rec;
    var path = rec.path;
    if (rec.mode === 'idb'){
      if (!urlCache[rec.id]){
        var blob = rec.blob || (rec.content != null ? new Blob([rec.content], { type: 'text/html' }) : null);
        if (blob) urlCache[rec.id] = URL.createObjectURL(blob);
      }
      path = urlCache[rec.id] || rec.path || '';
    }
    var app = {
      name:    rec.name,
      path:    path,
      icon:    rec.icon || '',
      desc:    rec.desc || '',
      license: rec.license || '',
      author:  rec.author || ''
    };
    app[FLAG] = rec.id;
    APPS.push(app);
    return app;
  }

  function registerInstallerApp(){
    if (APPS.some(function (a){ return a && a[FLAG] === 'installer'; })) return;
    installerUrl = URL.createObjectURL(new Blob([buildInstallerHtml()], { type: 'text/html' }));
    var entry = { name: 'Установщик', path: installerUrl, icon: INSTALLER_ICON };
    entry[FLAG] = 'installer';
    APPS.push(entry);
  }

  function refreshMenus(){
    try { if (typeof buildStartMenu === 'function') buildStartMenu(''); } catch (e){}
    try { if (typeof renderTaskbar  === 'function') renderTaskbar();   } catch (e){}
    try {
      if (typeof buildDesktop === 'function' && typeof desktopApps !== 'undefined') buildDesktop();
    } catch (e){}
  }

  function listPayload(){
    return Object.keys(recordsCache).map(function (id){
      var r = recordsCache[id];
      return {
        id: id,
        name: r.name,
        mode: r.mode,
        icon: r.icon || '',
        desc: r.desc || '',
        license: r.license || '',
        author: r.author || '',
        added: r.added
      };
    });
  }

  function reply(src, action, data){
    var msg = { __hcInstall: true, action: action };
    if (data) for (var k in data) msg[k] = data[k];
    try { src.postMessage(msg, '*'); } catch (e){}
  }

  function fail(src, msg){ reply(src, 'installResult', { ok: false, error: msg }); }

  async function handleInstall(src, d){
    try {
      var name    = String(d.name || '').trim();
      var mode    = d.mode === 'idb' ? 'idb' : 'path';
      var path    = String(d.path || '').trim();
      var icon    = d.icon || '';
      var desc    = String(d.desc || '').trim();
      var license = String(d.license || '').trim();
      var author  = String(d.author || '').trim();
      var editId  = d.editId || null;

      if (!name) return fail(src, 'Укажите название приложения.');

      var sysDup = APPS.some(function (a){
        return a && a.name === name && (!a[FLAG] || a[FLAG] === 'installer');
      });
      if (sysDup) return fail(src, 'Приложение с таким названием уже существует. Выберите другое.');

      /* ---------- РЕДАКТИРОВАНИЕ существующего приложения ---------- */
      if (editId && recordsCache[editId]){
        var sameName = APPS.some(function (a){
          return a && a[FLAG] && a[FLAG] !== 'installer' && a.name === name && a[FLAG] !== editId;
        });
        if (sameName) return fail(src, 'Приложение с таким названием уже установлено. Выберите другое.');

        if (mode === 'idb' && !d.file && !recordsCache[editId].blob){
          return fail(src, 'Файл этого приложения не сохранён — выберите HTML-файл заново.');
        }
        if (mode === 'path' && !path){
          return fail(src, 'Укажите путь к HTML-файлу.');
        }

        var rec = recordsCache[editId];
        rec.name    = name;
        rec.desc    = desc;
        rec.license = license;
        rec.author  = author;

        if (mode === 'idb'){
          rec.mode = 'idb';
          if (d.file){
            rec.path = null;
            rec.blob = await fileToStorableBlob(d.file);
          }
        } else {
          rec.mode = 'path';
          rec.path = path;
          rec.blob = null;
        }
        rec.icon = icon;

        var db = await openDb();
        await dbReq(db.transaction(STORE, 'readwrite').objectStore(STORE), 'put', rec);

        /* обновляем запись в APPS на месте */
        for (var i = 0; i < APPS.length; i++){
          if (APPS[i] && APPS[i][FLAG] === editId){
            if (rec.mode === 'idb' && urlCache[editId]){
              URL.revokeObjectURL(urlCache[editId]);
              delete urlCache[editId];
            }
            var newPath = rec.path;
            if (rec.mode === 'idb'){
              if (!urlCache[editId] && rec.blob) urlCache[editId] = URL.createObjectURL(rec.blob);
              newPath = urlCache[editId] || '';
            }
            APPS[i].name    = rec.name;
            APPS[i].path    = newPath;
            APPS[i].icon    = rec.icon || '';
            APPS[i].desc    = rec.desc || '';
            APPS[i].license = rec.license || '';
            APPS[i].author  = rec.author || '';
            break;
          }
        }

        refreshMenus();
        HENCORE.notify('Установщик', 'Приложение "' + name + '" обновлено.');
        reply(src, 'installResult', { ok: true, apps: listPayload() });
        return;
      }

      /* ---------- Обычная установка нового приложения ---------- */
      if (mode === 'idb'){
        var f = d.file;
        if (!f || typeof f.name !== 'string'){
          return fail(src, 'Выберите HTML-файл для установки.');
        }
        if (!(f.type === 'text/html' || /\.(html?|htm)$/i.test(f.name))){
          return fail(src, 'Это не HTML-файл. Выберите файл с расширением .htm или .html.');
        }
      } else {
        if (!path) return fail(src, 'Укажите путь к HTML-файлу.');
      }

      var old = APPS.filter(function (a){
        return a && a[FLAG] && a[FLAG] !== 'installer' && a.name === name;
      })[0];
      if (old) uninstallInternal(old[FLAG]);

      var rec2 = {
        id:      genId(),
        name:    name,
        mode:    mode,
        path:    mode === 'path' ? path : null,
        blob:    null,
        icon:    icon,
        desc:    desc,
        license: license,
        author:  author,
        added:   Date.now()
      };

      if (mode === 'idb'){
        try {
          rec2.blob = await fileToStorableBlob(d.file);
        } catch (err){
          return fail(src, 'Не удалось прочитать файл: ' + ((err && err.message) || err));
        }
      }

      var db2 = await openDb();
      var store2 = db2.transaction(STORE, 'readwrite').objectStore(STORE);
      await dbReq(store2, 'put', rec2);

      addAppFromRecord(rec2);
      refreshMenus();
      HENCORE.notify('Установщик', 'Приложение "' + name + '" установлено.');
      reply(src, 'installResult', { ok: true, apps: listPayload() });
    } catch (err){
      fail(src, 'Ошибка установки: ' + ((err && err.message) || err));
    }
  }

  function uninstallInternal(id){
    var rec = recordsCache[id];

    var idx = -1;
    for (var i = 0; i < APPS.length; i++){
      if (APPS[i] && APPS[i][FLAG] === id){ idx = i; break; }
    }
    if (idx >= 0) APPS.splice(idx, 1);

    try {
      openWins.slice().forEach(function (w){
        if (w.app && w.app[FLAG] === id) closeWin(w);
      });
    } catch (e){}

    try {
      if (rec && typeof pinnedApps !== 'undefined'){
        pinnedApps = pinnedApps.filter(function (n){ return n !== rec.name; });
        savePinned();
      }
    } catch (e){}

    try {
      if (rec && typeof desktopApps !== 'undefined'){
        if (!desktopApps) desktopApps = loadDesktopApps();
        desktopApps = desktopApps.filter(function (n){ return n !== rec.name; });
        saveDesktopApps();
      }
    } catch (e){}

    if (urlCache[id]){ URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
    delete recordsCache[id];

    openDb().then(function (db){
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    }).catch(function (){});

    refreshMenus();
  }

  function handleRemove(src, id){
    if (recordsCache[id]){
      var name = recordsCache[id].name;
      uninstallInternal(id);
      HENCORE.notify('Установщик', 'Приложение "' + name + '" удалено.');
    }
    reply(src, 'removeResult', { ok: true, apps: listPayload() });
  }

  /* ---------- ЭКСПОРТ приложения в JSON ---------- */
  async function handleExport(src, id){
    try {
      var rec = recordsCache[id];
      if (!rec) return reply(src, 'exportResult', { ok: false, error: 'Приложение не найдено.' });

      var data = {
        hencoreApp: 1,
        name:    rec.name,
        mode:    rec.mode,
        path:    rec.path || '',
        icon:    rec.icon || '',
        desc:    rec.desc || '',
        license: rec.license || '',
        author:  rec.author || '',
        added:   rec.added || null,
        content: null
      };

      if (rec.mode === 'idb'){
        if (rec.content != null) data.content = rec.content;
        else if (rec.blob) data.content = await blobToDataUrl(rec.blob);
        if (!data.content){
          return reply(src, 'exportResult', { ok: false, error: 'Не удалось прочитать содержимое файла приложения.' });
        }
      }

      reply(src, 'exportResult', { ok: true, name: rec.name, json: JSON.stringify(data, null, 2) });
    } catch (err){
      reply(src, 'exportResult', { ok: false, error: 'Ошибка экспорта: ' + ((err && err.message) || err) });
    }
  }

  /* ---------- ИМПОРТ приложения из JSON ---------- */
  async function handleImport(src, raw){
    try {
      var data;
      try { data = JSON.parse(raw); }
      catch (e){ throw new Error('Некорректный JSON.'); }

      if (!data || data.hencoreApp !== 1) throw new Error('Это не файл приложения HENCORE OS.');

      var name = String(data.name || '').trim();
      if (!name) throw new Error('В файле не указано название приложения.');

      if (APPS.some(function (a){ return a && a.name === name; })){
        throw new Error('Приложение с таким названием уже установлено. Удалите его или переименуйте импортируемое.');
      }

      var hasContent = typeof data.content === 'string' && data.content.length > 0;
      var mode = (data.mode === 'idb' && hasContent) ? 'idb' : 'path';
      var path = String(data.path || '').trim();

      if (mode === 'path' && !path){
        throw new Error('В файле нет ни сохранённого содержимого, ни пути к HTML-файлу.');
      }

      var rec = {
        id:      genId(),
        name:    name,
        mode:    mode,
        path:    mode === 'path' ? path : null,
        blob:    null,
        icon:    data.icon || '',
        desc:    data.desc || '',
        license: data.license || '',
        author:  data.author || '',
        added:   Date.now()
      };

      if (mode === 'idb'){
        rec.blob = data.content.slice(0, 5) === 'data:'
          ? dataUrlToBlob(data.content)
          : new Blob([data.content], { type: 'text/html' });
      }

      var db = await openDb();
      await dbReq(db.transaction(STORE, 'readwrite').objectStore(STORE), 'put', rec);

      addAppFromRecord(rec);
      refreshMenus();
      HENCORE.notify('Установщик', 'Приложение "' + name + '" импортировано.');
      reply(src, 'importResult', { ok: true, apps: listPayload() });
    } catch (err){
      reply(src, 'importResult', { ok: false, error: 'Ошибка импорта: ' + ((err && err.message) || err) });
    }
  }

  function findFrameBySource(source){
    if (!source) return null;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++){
      try { if (frames[i].contentWindow === source) return frames[i]; } catch (e){}
    }
    return null;
  }

  window.addEventListener('message', function (e){
    var d = e.data;
    if (!d || d.__hcInstall !== true) return;
    var frame = findFrameBySource(e.source);
    if (!frame || frame.src !== installerUrl) return;   

    if (d.action === 'list'){
      reply(e.source, 'list', { apps: listPayload() });
    } else if (d.action === 'install'){
      handleInstall(e.source, d);
    } else if (d.action === 'remove'){
      handleRemove(e.source, d.id);
    } else if (d.action === 'export'){
      handleExport(e.source, d.id);
    } else if (d.action === 'import'){
      handleImport(e.source, d.json);
    }
  });

  async function loadInstalled(){
    try {
      var db = await openDb();
      var store = db.transaction(STORE).objectStore(STORE);
      var items = await dbReq(store, 'getAll');
      (items || []).forEach(function (rec){
        var already = APPS.some(function (a){ return a && a[FLAG] === rec.id; });
        if (!already) addAppFromRecord(rec);
      });
      refreshMenus();
    } catch (e){}
  }

  registerInstallerApp();
  window.addEventListener('DOMContentLoaded', loadInstalled);
  if (document.readyState !== 'loading') loadInstalled();

  function buildInstallerHtml(){
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Установщик</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:#14171c;color:#e8eaed;padding:22px 26px;overflow-y:auto;
  }
  h1{font-size:20px;font-weight:600;margin-bottom:2px}
  .sub{color:#8b93a1;font-size:12px;margin-bottom:18px}
  h2{font-size:15px;font-weight:600;margin:22px 0 10px}
  .sec{margin-bottom:14px}
  label.fl{display:block;font-size:12px;color:#9aa3b0;margin-bottom:5px;letter-spacing:.2px}
  input[type=text], textarea{
    width:100%;padding:9px 12px;border-radius:9px;border:1px solid #2e3440;
    background:#1b1e24;color:#e8eaed;font-size:13px;outline:none;
    font-family:inherit;resize:vertical;
  }
  input[type=text]:focus, textarea:focus{border-color:#4cc2ff}
  .radios{display:flex;gap:18px;background:#1b1e24;border:1px solid #2e3440;
    border-radius:9px;padding:10px 14px}
  .radios label{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px}
  .radios input{accent-color:#4cc2ff;cursor:pointer}
  .hint{font-size:11px;color:#6b7482;margin-top:5px}
  input[type=file]{font-size:12px;color:#9aa3b0}
  input[type=file]::file-selector-button{
    background:#242933;color:#e8eaed;border:1px solid #2e3440;border-radius:7px;
    padding:6px 12px;margin-right:10px;cursor:pointer;font-size:12px;
  }
  input[type=file]::file-selector-button:hover{background:#2d3441}
  #icon-prev{width:42px;height:42px;border-radius:10px;margin-top:8px;display:none;
    object-fit:cover;background:#1b1e24;border:1px solid #2e3440}
  .icon-row{display:flex;align-items:center;gap:14px}
  button.main{
    width:100%;padding:11px;border:none;border-radius:10px;cursor:pointer;
    background:#4cc2ff;color:#0c1116;font-size:14px;font-weight:600;margin-top:6px;
  }
  button.main:hover{filter:brightness(1.1)}
  #edit-bar{
    display:none;align-items:center;gap:10px;background:#1d2b38;
    border:1px solid #2a4a63;border-radius:10px;padding:8px 12px;
    font-size:13px;margin-bottom:12px;
  }
  #edit-bar b{color:#4cc2ff}
  #btn-cancel-edit{
    margin-left:auto;background:none;border:1px solid #2e3440;color:#9aa3b0;
    border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer;
  }
  #btn-cancel-edit:hover{background:#242933}
  #status{min-height:18px;font-size:12px;margin-top:9px;color:#8b93a1;white-space:pre-wrap}
  #status.err{color:#ff7b72}
  #status.ok{color:#4ade80}
  .app-row{
    display:flex;align-items:center;gap:12px;background:#1b1e24;
    border:1px solid #2e3440;border-radius:10px;padding:9px 12px;margin-bottom:7px;
  }
  .app-row img{width:34px;height:34px;border-radius:8px;object-fit:cover;background:#242933;flex:0 0 34px}
  .app-row .letter{
    width:34px;height:34px;border-radius:8px;background:#242933;flex:0 0 34px;
    display:flex;align-items:center;justify-content:center;font-weight:700;color:#4cc2ff;
  }
  .app-info{flex:1;min-width:0}
  .app-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .app-mode{font-size:11px;color:#8b93a1}
  .app-meta{font-size:11px;color:#6b7482;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .btns{display:flex;gap:6px;flex:0 0 auto}
  .row-btn{
    background:#242933;border:1px solid #2e3440;color:#c6cdd8;border-radius:7px;
    padding:5px 10px;font-size:12px;cursor:pointer;
  }
  .row-btn:hover{background:#2d3441}
  .del{
    background:#242933;border:1px solid #3a2530;color:#ff7b72;border-radius:7px;
    padding:5px 10px;font-size:12px;cursor:pointer;flex:0 0 auto;
  }
  .del:hover{background:#2a1b21}
  .empty{color:#6b7482;font-size:12px;padding:6px 2px}
</style>
</head>
<body>
  <h1>Установщик приложений</h1>
  <div class="sub">Установите HTML-файл как приложение HENCORE OS</div>

  <div id="edit-bar">
    <span>Редактирование: <b id="edit-name"></b></span>
    <button id="btn-cancel-edit">Отмена</button>
  </div>

  <div class="sec">
    <label class="fl">Название приложения</label>
    <input type="text" id="i-name" placeholder="Например: Моё приложение" maxlength="40">
  </div>

  <div class="sec">
    <label class="fl">Источник файла</label>
    <div class="radios">
      <label><input type="radio" name="mode" value="path" checked> Путь к файлу</label>
      <label><input type="radio" name="mode" value="idb"> Сохранить в IndexedDB</label>
    </div>
    <div class="hint" id="mode-hint">Файл остаётся на диске — сохраняется только путь к нему.</div>
  </div>

  <div class="sec" id="sec-path">
    <label class="fl">Путь к HTML-файлу</label>
    <input type="text" id="i-path" placeholder="[SYSTEM]/Apps/myapp.htm или https://...">
  </div>

  <div class="sec" id="sec-idb" style="display:none">
    <label class="fl">HTML-файл</label>
    <input type="file" id="i-file" accept=".htm,.html,text/html">
    <div class="hint" id="file-hint">Копия файла будет сохранена в базу данных браузера — приложение заработает, даже если удалить оригинал с диска.</div>
  </div>

  <div class="sec">
    <label class="fl">Иконка (необязательно)</label>
    <div class="icon-row" id="iconpath-row" style="display:block">
      <input type="text" id="i-iconpath" placeholder="[SYSTEM]/Icons/my.png" style="margin-bottom:7px">
    </div>
    <div class="icon-row">
      <input type="file" id="i-icon" accept="image/*">
      <img id="icon-prev" alt="">
    </div>
    <div class="hint">В режиме IndexedDB иконку лучше загрузить файлом. Без иконки будет первая буква названия.</div>
  </div>

  <div class="sec">
    <label class="fl">Описание (необязательно)</label>
    <textarea id="i-desc" rows="3" maxlength="500" placeholder="Что делает это приложение"></textarea>
  </div>

  <div class="sec">
    <label class="fl">Автор (необязательно)</label>
    <input type="text" id="i-author" placeholder="Например: Ivan" maxlength="60">
  </div>

  <div class="sec">
    <label class="fl">Лицензия (необязательно)</label>
    <input type="text" id="i-license" placeholder="Например: MIT, freeware, проприетарная" maxlength="60">
  </div>

  <button class="main" id="btn-install">Установить</button>
  <div id="status"></div>

  <h2>Импорт приложения (.json)</h2>
  <div class="sec">
    <input type="file" id="i-import" accept=".json,application/json">
    <div class="hint">Файл, полученный через кнопку «Экспорт». Для приложений в IndexedDB вместе с настройками переносится и сам HTML-файл.</div>
  </div>

  <h2>Установленные приложения</h2>
  <div id="list"><div class="empty">Загрузка…</div></div>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var iconData = '';
  var pickedFile = null;
  var editingId = null;
  var radios = document.querySelectorAll('input[name=mode]');

  function status(msg, cls){
    var s = $('status');
    s.textContent = msg || '';
    s.className = cls || '';
  }

  function applyModeUi(idb){
    $('sec-path').style.display = idb ? 'none' : 'block';
    $('sec-idb').style.display  = idb ? 'block' : 'none';
    $('iconpath-row').style.display = idb ? 'none' : 'block';
    $('mode-hint').textContent = idb
      ? 'Копия файла будет сохранена в базу данных браузера — приложение заработает, даже если удалить оригинал с диска.'
      : 'Файл остаётся на диске — сохраняется только путь к нему.';
  }

  function setModeChecked(idb){
    radios.forEach(function (r){ r.checked = (r.value === 'idb') === idb; });
    applyModeUi(idb);
  }

  function fillEdit(a){
    editingId = a.id;
    $('i-name').value = a.name || '';
    $('i-desc').value = a.desc || '';
    $('i-author').value = a.author || '';
    $('i-license').value = a.license || '';

    iconData = (a.icon || '').slice(0, 5) === 'data:' ? a.icon : '';
    $('i-iconpath').value = iconData ? '' : (a.icon || '');
    if (iconData){
      $('icon-prev').src = iconData;
      $('icon-prev').style.display = 'block';
    } else {
      $('icon-prev').style.display = 'none';
    }

    setModeChecked(a.mode === 'idb');
    if (a.mode === 'idb'){
      pickedFile = null;
      $('i-file').value = '';
      $('file-hint').textContent = 'Файл уже сохранён. Выберите новый HTML-файл только если хотите заменить его.';
    }

    $('edit-bar').style.display = 'flex';
    $('edit-name').textContent = a.name;
    $('btn-install').textContent = 'Сохранить изменения';
    status('Режим редактирования приложения "' + a.name + '".');
    window.scrollTo(0, 0);
    $('i-name').focus();
  }

  function resetForm(){
    editingId = null;
    $('i-name').value = '';
    $('i-path').value = '';
    $('i-file').value = '';
    $('i-icon').value = '';
    $('i-iconpath').value = '';
    $('i-desc').value = '';
    $('i-author').value = '';
    $('i-license').value = '';
    iconData = '';
    pickedFile = null;
    $('icon-prev').style.display = 'none';
    $('file-hint').textContent = 'Копия файла будет сохранена в базу данных браузера — приложение заработает, даже если удалить оригинал с диска.';
    $('edit-bar').style.display = 'none';
    $('btn-install').textContent = 'Установить';
    setModeChecked(false);
  }

  function refreshList(apps){
    var box = $('list');
    box.innerHTML = '';
    if (!apps || !apps.length){
      box.innerHTML = '<div class="empty">Пока ничего не установлено.</div>';
      return;
    }
    apps.forEach(function (a){
      var row = document.createElement('div');
      row.className = 'app-row';
      var ic;
      if (a.icon){
        var img = document.createElement('img');
        img.src = a.icon;
        img.onerror = function(){
          var l = document.createElement('div');
          l.className = 'letter';
          l.textContent = (a.name || '?').charAt(0).toUpperCase();
          img.replaceWith(l);
        };
        ic = img;
      } else {
        ic = document.createElement('div');
        ic.className = 'letter';
        ic.textContent = (a.name || '?').charAt(0).toUpperCase();
      }
      var info = document.createElement('div');
      info.className = 'app-info';
      var nm = document.createElement('div');
      nm.className = 'app-name';
      nm.textContent = a.name;
      var md = document.createElement('div');
      md.className = 'app-mode';
      md.textContent = (a.mode === 'idb' ? 'IndexedDB' : 'Путь к файлу') +
        ' · ' + new Date(a.added).toLocaleDateString();
      info.appendChild(nm);
      info.appendChild(md);

      var bits = [];
      if (a.author) bits.push('Автор: ' + a.author);
      if (a.license) bits.push('Лицензия: ' + a.license);
      if (a.desc) bits.push(a.desc);
      if (bits.length){
        var meta = document.createElement('div');
        meta.className = 'app-meta';
        meta.textContent = bits.join(' · ');
        meta.title = a.desc || '';
        info.appendChild(meta);
      }

      var btns = document.createElement('div');
      btns.className = 'btns';

      var edit = document.createElement('button');
      edit.className = 'row-btn';
      edit.textContent = 'Изменить';
      edit.addEventListener('click', function(){ fillEdit(a); });

      var exp = document.createElement('button');
      exp.className = 'row-btn';
      exp.textContent = 'Экспорт';
      exp.addEventListener('click', function(){
        status('Подготовка экспорта…');
        window.parent.postMessage({ __hcInstall: true, action: 'export', id: a.id }, '*');
      });

      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'Удалить';
      del.addEventListener('click', function(){
        if (!confirm('Удалить приложение "' + a.name + '"?')) return;
        window.parent.postMessage({ __hcInstall: true, action: 'remove', id: a.id }, '*');
      });

      btns.appendChild(edit);
      btns.appendChild(exp);
      btns.appendChild(del);
      row.appendChild(ic);
      row.appendChild(info);
      row.appendChild(btns);
      box.appendChild(row);
    });
  }

  function requestList(){
    window.parent.postMessage({ __hcInstall: true, action: 'list' }, '*');
  }

  /* --- переключение режима --- */
  radios.forEach(function (r){
    r.addEventListener('change', function(){
      applyModeUi(r.value === 'idb' && r.checked);
    });
  });

  /* --- выбор html-файла --- */
  $('i-file').addEventListener('change', function(){
    pickedFile = this.files && this.files[0] ? this.files[0] : null;
    $('file-hint').textContent = pickedFile
      ? 'Выбрано: ' + pickedFile.name
      : (editingId
        ? 'Файл уже сохранён. Выберите новый HTML-файл только если хотите заменить его.'
        : 'Копия файла будет сохранена в базу данных браузера — приложение заработает, даже если удалить оригинал с диска.');
  });

  /* --- выбор иконки --- */
  $('i-icon').addEventListener('change', function(){
    var f = this.files && this.files[0];
    if (!f){
      iconData = '';
      $('icon-prev').style.display = 'none';
      return;
    }
    var r = new FileReader();
    r.onload = function(){
      iconData = r.result;
      $('icon-prev').src = iconData;
      $('icon-prev').style.display = 'block';
    };
    r.readAsDataURL(f);
  });

  /* --- импорт из JSON --- */
  $('i-import').addEventListener('change', function(){
    var f = this.files && this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function(){
      status('Импорт…');
      window.parent.postMessage({ __hcInstall: true, action: 'import', json: r.result }, '*');
      $('i-import').value = '';
    };
    r.readAsText(f, 'utf-8');
  });

  /* --- установка / сохранение изменений --- */
  $('btn-install').addEventListener('click', function(){
    var name = $('i-name').value.trim();
    var mode = 'path';
    radios.forEach(function (r){ if (r.checked) mode = r.value; });

    if (!name){ status('Укажите название приложения.', 'err'); return; }

    var msg = {
      __hcInstall: true,
      action: 'install',
      name: name,
      mode: mode,
      desc: $('i-desc').value.trim(),
      author: $('i-author').value.trim(),
      license: $('i-license').value.trim()
    };
    if (editingId) msg.editId = editingId;

    if (mode === 'idb'){
      if (pickedFile){
        msg.file = pickedFile;
      } else if (!editingId){
        status('Выберите HTML-файл для установки.', 'err');
        return;
      }
      msg.path = '';
      msg.icon = iconData || $('i-iconpath').value.trim();
    } else {
      var p = $('i-path').value.trim();
      if (!p){ status('Укажите путь к HTML-файлу.', 'err'); return; }
      msg.path = p;
      msg.icon = iconData || $('i-iconpath').value.trim();
    }

    status(editingId ? 'Сохранение…' : 'Установка…');
    window.parent.postMessage(msg, '*');
  });

  /* --- отмена редактирования --- */
  $('btn-cancel-edit').addEventListener('click', function(){
    resetForm();
    status('Редактирование отменено.');
  });

  /* --- ответы от ядра --- */
  window.addEventListener('message', function (e){
    var d = e.data;
    if (!d || d.__hcInstall !== true) return;

    if (d.action === 'list' || d.action === 'installResult' || d.action === 'removeResult' || d.action === 'importResult'){
      if (d.apps) refreshList(d.apps);

      if (d.action === 'installResult'){
        if (d.ok){
          status(editingId ? 'Изменения сохранены.' : 'Готово! Приложение установлено — найдите его в стартовом меню.', 'ok');
          resetForm();
        } else {
          status(d.error || 'Не удалось установить приложение.', 'err');
        }
      }

      if (d.action === 'importResult'){
        if (d.ok){
          status('Готово! Приложение импортировано.', 'ok');
        } else {
          status(d.error || 'Не удалось импортировать приложение.', 'err');
        }
      }
      return;
    }

    if (d.action === 'exportResult'){
      if (!d.ok){
        status(d.error || 'Не удалось экспортировать приложение.', 'err');
        return;
      }
      var fname = (d.name || 'app').replace(/[^\\wа-яёА-ЯЁ-]+/gi, '_') + '.hencore.json';
      var blob = new Blob([d.json], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fname;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function(){ URL.revokeObjectURL(link.href); }, 1000);
      status('Экспортировано: ' + fname, 'ok');
    }
  });

  requestList();
})();
<\/script>
</body>
</html>`;
  }

})();
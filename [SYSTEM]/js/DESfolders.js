
(function(){

  if (typeof showCtxMenu !== 'function' || typeof findFreeCell !== 'function' ||
      typeof HENCORE === 'undefined'){
    console.warn('[DesktopFolders] Ядро HENCORE OS не найдено — аддон отключён');
    return;
  }

  const FOLDERS_KEY       = 'hencore_os_folders_v1';
  const FOLDER_KEY_PREFIX = 'folder:';
  const DND_FOLDER_ITEM   = 'text/hencore-folder-item';

  let folders = (function(){
    try{
      const raw = JSON.parse(localStorage.getItem(FOLDERS_KEY));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    }catch(e){}
    return {};
  })();

  function saveFolders(){
    try{ localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); }catch(e){}
  }

  function folderIds(){ return Object.keys(folders); }

  function uniqueFolderName(base){
    const names = folderIds().map(function(id){ return folders[id].name; });
    if (names.indexOf(base) === -1) return base;
    for (let i = 2; ; i++){
      const n = base + ' (' + i + ')';
      if (names.indexOf(n) === -1) return n;
    }
  }

  const FOLDER_SVG =
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M4 11a4 4 0 0 1 4-4h11l4 5h17a4 4 0 0 1 4 4v2H4z" fill="#e8a020"/>' +
      '<rect x="4" y="16" width="40" height="21" rx="4" fill="#f7c645"/>' +
    '</svg>';

  (function injectStyles(){
    const st = document.createElement('style');
    st.textContent = [
      '#desktop .app-icon.hc-folder .ic{display:flex;align-items:center;justify-content:center;position:relative}',
      '#desktop .hc-folder-ic svg{width:44px;height:44px;display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}',
      '#desktop .hc-folder-badge{position:absolute;right:-2px;bottom:-2px;min-width:16px;height:16px;padding:0 4px;',
        'border-radius:8px;background:var(--accent,#4cc2ff);color:#fff;font-size:10px;line-height:16px;',
        'font-weight:700;text-align:center;pointer-events:none}',
      '#desktop .app-icon.hc-folder-hi{outline:2px dashed var(--accent,#4cc2ff);outline-offset:2px;',
        'border-radius:8px;background:rgba(76,194,255,.12)}',
      '.hc-rename-input{font:inherit;background:rgba(0,0,0,.35);color:#fff;border:1px solid var(--accent,#4cc2ff);',
        'border-radius:5px;padding:2px 4px;width:92px;font-size:12px;text-align:center;outline:none}',
      '.hc-folder-win{position:fixed;z-index:9000;width:380px;max-width:92vw;background:var(--hc-panel,#1b1e24);',
        'border:1px solid var(--hc-border,#2e3440);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);',
        'color:var(--hc-text,#e8eaed);display:flex;flex-direction:column;overflow:hidden}',
      '.hc-folder-win .hc-fw-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:move;',
        'user-select:none;-webkit-user-select:none;background:rgba(255,255,255,.04);',
        'border-bottom:1px solid var(--hc-border,#2e3440)}',
      '.hc-folder-win .hc-fw-ic svg{width:20px;height:20px;display:block}',
      '.hc-folder-win .hc-fw-title{flex:1;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hc-folder-win .hc-fw-close{all:unset;cursor:pointer;width:24px;height:24px;display:flex;',
        'align-items:center;justify-content:center;border-radius:6px;font-size:13px}',
      '.hc-folder-win .hc-fw-close:hover{background:var(--hc-hover,rgba(255,255,255,.12))}',
      '.hc-folder-win .hc-fw-body{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:10px;max-height:300px;overflow:auto}',
      '.hc-fw-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 2px;border-radius:8px;cursor:pointer;text-align:center}',
      '.hc-fw-item:hover{background:var(--hc-hover,rgba(255,255,255,.1))}',
      '.hc-fw-item .ic,.hc-fw-item .fallback{width:36px;height:36px;display:flex;align-items:center;justify-content:center}',
      '.hc-fw-item .ic img{width:34px;height:34px;object-fit:contain}',
      '.hc-fw-item .fallback{background:rgba(255,255,255,.12);border-radius:8px;font-weight:700;font-size:18px}',
      '.hc-fw-item span{font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hc-folder-win .hc-fw-empty{grid-column:1/-1;text-align:center;color:#9aa0a6;font-size:12px;padding:26px 8px}',
      '.hc-folder-win .hc-fw-foot{padding:6px 12px;font-size:11px;color:#9aa0a6;border-top:1px solid var(--hc-border,#2e3440)}',
      '.hc-props{width:320px}',
      '.hc-props .hc-fw-body{display:block;padding:12px 14px;max-height:none;overflow:visible}',
      '.hc-props-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:5px 0;',
        'border-bottom:1px dashed var(--hc-border,#2e3440)}',
      '.hc-props-row span{color:#9aa0a6}',
      '.hc-props-contents{margin-top:10px;font-size:12px;line-height:1.7;max-height:140px;overflow:auto}'
    ].join('\n');
    (document.head || document.body).appendChild(st);
  })();

  function folderKeyOf(kind, id){
    return kind === 'folder' ? FOLDER_KEY_PREFIX + id : id;
  }

  function folderAt(x, y, selfEl){
    const nodes = desktop.querySelectorAll('.app-icon.hc-folder');
    for (let i = 0; i < nodes.length; i++){
      const n = nodes[i];
      if (n === selfEl) continue;
      const r = n.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return n.dataset.name;
    }
    return null;
  }

  function clearFolderHighlight(){
    desktop.querySelectorAll('.hc-folder-hi').forEach(function(f){
      f.classList.remove('hc-folder-hi');
    });
  }

  function bindMovable(el, kind, id){
    const key = folderKeyOf(kind, id);
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
      if (kind === 'app' || kind === 'folder'){
        const target = folderAt(e.clientX, e.clientY, el);
        desktop.querySelectorAll('.app-icon.hc-folder').forEach(function(f){
          f.classList.toggle('hc-folder-hi', !!target && f.dataset.name === target);
        });
      }
    });

    function finish(e){
      if (!dragging) return;
      dragging = false;
      el.classList.remove('hc-drag');
      desktop.classList.remove('hc-grid-on');
      clearFolderHighlight();
      if (!moved) return;

      if (kind === 'app' || kind === 'folder'){
        const target = folderAt(e.clientX, e.clientY, el);
        if (kind === 'app' && target){
          moveToFolder(key, target);
          return;
        }
        if (kind === 'folder' && target && target !== FOLDER_KEY_PREFIX + id){
          mergeFolders(id, target.slice(FOLDER_KEY_PREFIX.length));
          return;
        }
      }

      const r = el.getBoundingClientRect();
      const dr = desktop.getBoundingClientRect();
      const cell = snapToGrid(r.left + r.width / 2 - dr.left, r.top + r.height / 2 - dr.top);
      const free = findFreeCell(cell.c, cell.r, key);
      placeIconEl(el, free.c, free.r);
      const map = loadIconPos();
      map[key] = { c: free.c, r: free.r };
      saveIconPos(map);
    }

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);

  }

  function moveToFolder(appName, folderKey){
    const folderId = folderKey.slice(FOLDER_KEY_PREFIX.length);
    const folder = folders[folderId];
    if (!folder || folder.apps.indexOf(appName) !== -1) return;

    if (!desktopApps) desktopApps = loadDesktopApps();
    desktopApps = desktopApps.filter(function(n){ return n !== appName; });
    saveDesktopApps();

    const map = loadIconPos();
    delete map[appName];
    saveIconPos(map);

    folder.apps.push(appName);
    saveFolders();

    buildDesktop();
    refreshFolderWindows();
    HENCORE.notify('Папка', '«' + appName + '» перемещена в папку «' + folder.name + '»');
  }

  function takeOutOfFolder(folderId, name, cell){
    const folder = folders[folderId];
    if (!folder) return;
    folder.apps = folder.apps.filter(function(n){ return n !== name; });
    saveFolders();

    if (!desktopApps) desktopApps = loadDesktopApps();
    if (desktopApps.indexOf(name) === -1) desktopApps.push(name);
    saveDesktopApps();

    const map = loadIconPos();
    if (cell){
      const free = findFreeCell(cell.c, cell.r, name);
      map[name] = { c: free.c, r: free.r };
    } else {
      delete map[name];
    }
    saveIconPos(map);

    buildDesktop();
    refreshFolderWindows();
    HENCORE.notify('Папка', '«' + name + '» вернулась на рабочий стол');
  }

  function createFolder(){
    const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    folders[id] = { id: id, name: uniqueFolderName('Новая папка'), apps: [], created: Date.now() };
    saveFolders();

    const map = loadIconPos();
    delete map[FOLDER_KEY_PREFIX + id];
    const free = findFreeCell(0, 0, FOLDER_KEY_PREFIX + id);
    map[FOLDER_KEY_PREFIX + id] = { c: free.c, r: free.r };
    saveIconPos(map);

    buildDesktop();
    HENCORE.notify('Рабочий стол', 'Создана папка «' + folders[id].name + '» — перетаскивайте иконки прямо на неё.');
  }

  function deleteFolder(folderId){
    const f = folders[folderId];
    if (!f) return;
    if (!window.confirm('Удалить папку «' + f.name + '»?\nПриложения из неё вернутся на рабочий стол.')) return;

    if (!desktopApps) desktopApps = loadDesktopApps();
    f.apps.forEach(function(name){
      if (findAppByName(name) && desktopApps.indexOf(name) === -1) desktopApps.push(name);
    });
    delete folders[folderId];
    saveFolders();
    saveDesktopApps();

    const map = loadIconPos();
    delete map[FOLDER_KEY_PREFIX + folderId];
    saveIconPos(map);

    if (folderWins[folderId]){ folderWins[folderId].el.remove(); delete folderWins[folderId]; }

    buildDesktop();
    refreshFolderWindows();
    HENCORE.notify('Папка', 'Папка «' + f.name + '» удалена');
  }

  function mergeFolders(aId, bId){
    const A = folders[aId], B = folders[bId];
    if (!A || !B) return;
    A.apps.forEach(function(n){
      if (B.apps.indexOf(n) === -1) B.apps.push(n);
    });
    delete folders[aId];
    saveFolders();

    const map = loadIconPos();
    delete map[FOLDER_KEY_PREFIX + aId];
    saveIconPos(map);

    if (folderWins[aId]){ folderWins[aId].el.remove(); delete folderWins[aId]; }

    buildDesktop();
    refreshFolderWindows();
    HENCORE.notify('Папки', 'Содержимое «' + A.name + '» перемещено в «' + B.name + '»');
  }

  function renameFolder(folderId, span){
    const folder = folders[folderId];
    if (!folder || !span) return;
    const input = document.createElement('input');
    input.className = 'hc-rename-input';
    input.value = folder.name;
    input.maxLength = 60;
    span.style.display = 'none';
    span.parentNode.insertBefore(input, span);

    let done = false;
    function commit(){
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v && v !== folder.name){
        folder.name = v;
        saveFolders();
        buildDesktop();
        refreshFolderWindows();
      } else {
        input.remove();
        span.style.display = '';
      }
    }
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape'){
        done = true;
        input.remove();
        span.style.display = '';
      }
    });
    input.addEventListener('blur', commit);
    setTimeout(function(){ input.focus(); input.select(); }, 0);
  }

  function reorderIcons(){
    const map = loadIconPos();
    desktop.querySelectorAll('.app-icon').forEach(function(n){ delete map[n.dataset.name]; });
    saveIconPos(map);
    buildDesktop();
  }

  function makeFolderEl(folder){
    const d = document.createElement('div');
    d.className = 'app-icon hc-folder';
    d.dataset.name = FOLDER_KEY_PREFIX + folder.id;
    d.tabIndex = 0;

    const ic = document.createElement('div');
    ic.className = 'ic hc-folder-ic';
    ic.innerHTML = FOLDER_SVG + '<span class="hc-folder-badge">' + folder.apps.length + '</span>';

    const lbl = document.createElement('span');
    lbl.textContent = folder.name;

    d.appendChild(ic); d.appendChild(lbl);

    bindMovable(d, 'folder', folder.id);
    d.addEventListener('dblclick', function(){ openFolderWindow(folder.id); });
    d.addEventListener('keydown', function(e){ if (e.key === 'Enter') openFolderWindow(folder.id); });
    d.addEventListener('contextmenu', function(e){
      e.preventDefault();
      showCtxMenu(e.clientX, e.clientY, [
        { label: 'Открыть', action: function(){ openFolderWindow(folder.id); } },
        { label: 'Переименовать', action: function(){ renameFolder(folder.id, lbl); } },
        { label: 'Свойства', action: function(){ showFolderProperties(folder.id); } },
        { label: 'Удалить папку', action: function(){ deleteFolder(folder.id); } }
      ]);
    });
    return d;
  }

  let folderZ = 9000;
  const folderWins = {};

  function positionPanel(el, width){
    const w = Math.min(width, innerWidth - 20);
    el.style.left = Math.max(10, Math.round((innerWidth - w) / 2)) + 'px';
    el.style.top  = Math.max(10, Math.round((innerHeight - el.offsetHeight) / 2)) + 'px';
  }

  function makePanelDraggable(el, head){
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    head.addEventListener('pointerdown', function(e){
      if (e.target.closest('button')) return;
      on = true;
      sx = e.clientX; sy = e.clientY;
      ox = el.offsetLeft; oy = el.offsetTop;
      el.style.zIndex = String(++folderZ);
      try { head.setPointerCapture(e.pointerId); } catch(err){}
    });
    head.addEventListener('pointermove', function(e){
      if (!on) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      el.style.top  = Math.max(0, oy + e.clientY - sy) + 'px';
    });
    function stop(){ on = false; }
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
    el.addEventListener('pointerdown', function(){ el.style.zIndex = String(++folderZ); });
  }

  function makeFolderWindow(folderId){
    const el = document.createElement('div');
    el.className = 'hc-folder-win';
    el.style.zIndex = String(++folderZ);
    el.innerHTML =
      '<div class="hc-fw-head">' +
        '<span class="hc-fw-ic">' + FOLDER_SVG + '</span>' +
        '<span class="hc-fw-title"></span>' +
        '<button class="hc-fw-close" title="Закрыть">✕</button>' +
      '</div>' +
      '<div class="hc-fw-body"></div>' +
      '<div class="hc-fw-foot"></div>';

    const w = {
      folderId: folderId,
      el: el,
      title: el.querySelector('.hc-fw-title'),
      body:  el.querySelector('.hc-fw-body'),
      foot:  el.querySelector('.hc-fw-foot')
    };

    el.querySelector('.hc-fw-close').addEventListener('click', function(){ el.remove(); });
    makePanelDraggable(el, el.querySelector('.hc-fw-head'));

    document.body.appendChild(el);
    positionPanel(el, 380);
     
    const n = Object.keys(folderWins).length;
    el.style.left = Math.max(10, Number(el.style.left.replace('px','')) - 0 + n * 22) + 'px';
    el.style.top  = Math.max(10, Number(el.style.top.replace('px','')) - 0 + n * 22) + 'px';
    return w;
  }

  function openFolderWindow(folderId){
    const folder = folders[folderId];
    if (!folder) return;
    let w = folderWins[folderId];
    if (!w || !w.el.isConnected){
      w = folderWins[folderId] = makeFolderWindow(folderId);
    }
    w.el.style.zIndex = String(++folderZ);
    renderFolderWindow(w);
  }

  function renderFolderWindow(w){
    const folder = folders[w.folderId];
    if (!folder){ w.el.remove(); return; }
    w.title.textContent = folder.name;
    w.foot.textContent = folder.apps.length
      ? 'Приложений: ' + folder.apps.length
      : 'Папка пуста — перетащите иконку сюда или ПКМ по иконке → «Переместить в папку»';
    w.body.innerHTML = '';

    if (!folder.apps.length){
      const empty = document.createElement('div');
      empty.className = 'hc-fw-empty';
      empty.textContent = 'Перетащите иконку приложения сюда';
      w.body.appendChild(empty);
      return;
    }

    folder.apps.forEach(function(name){
      const app = findAppByName(name);
      if (!app) return;
      const item = document.createElement('div');
      item.className = 'hc-fw-item';
      item.draggable = true;
      item.title = name;

      const ic = document.createElement('div');
      if (isBuiltin(app)){
        ic.className = 'fallback';
        ic.textContent = '⚙';
      } else {
        ic.className = 'ic';
        const img = document.createElement('img');
        img.src = app.icon || '';
        img.onerror = function(){
          const fb = document.createElement('div');
          fb.className = 'fallback';
          fb.textContent = name.charAt(0).toUpperCase();
          img.replaceWith(fb);
        };
        ic.appendChild(img);
      }

      const lbl = document.createElement('span');
      lbl.textContent = name;
      item.appendChild(ic); item.appendChild(lbl);

      item.addEventListener('click', function(){ openApp(app); });
      item.addEventListener('contextmenu', function(e){
        e.preventDefault();
        e.stopPropagation();
        showCtxMenu(e.clientX, e.clientY, [
          { label: 'Открыть', action: function(){ openApp(app); } },
          { label: 'Убрать из папки', action: function(){ takeOutOfFolder(w.folderId, name); } }
        ]);
      });
      item.addEventListener('dragstart', function(e){
        if (e.dataTransfer){
          e.dataTransfer.setData(DND_FOLDER_ITEM, JSON.stringify({ f: w.folderId, n: name }));
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      w.body.appendChild(item);
    });
  }

  function refreshFolderWindows(){
    folderIds().forEach(function(id){
      const w = folderWins[id];
      if (w && w.el.isConnected) renderFolderWindow(w);
    });
  }

  function showFolderProperties(folderId){
    const folder = folders[folderId];
    if (!folder) return;

    const created = new Date(folder.created || Date.now());
    const pad = function(n){ return String(n).padStart(2, '0'); };
    const contents = folder.apps.length
      ? folder.apps.map(function(n){ return '• ' + escapeHtml(n); }).join('<br>')
      : '— пусто —';

    const el = document.createElement('div');
    el.className = 'hc-folder-win hc-props';
    el.style.zIndex = String(++folderZ);
    el.innerHTML =
      '<div class="hc-fw-head">' +
        '<span class="hc-fw-ic">' + FOLDER_SVG + '</span>' +
        '<span class="hc-fw-title">Свойства: ' + escapeHtml(folder.name) + '</span>' +
        '<button class="hc-fw-close" title="Закрыть">✕</button>' +
      '</div>' +
      '<div class="hc-fw-body">' +
        '<div class="hc-props-row"><span>Имя</span><b>' + escapeHtml(folder.name) + '</b></div>' +
        '<div class="hc-props-row"><span>Тип</span>Папка рабочего стола</div>' +
        '<div class="hc-props-row"><span>Создана</span>' +
          pad(created.getDate()) + '.' + pad(created.getMonth() + 1) + '.' + created.getFullYear() +
          ' ' + pad(created.getHours()) + ':' + pad(created.getMinutes()) + '</div>' +
        '<div class="hc-props-row"><span>Приложений</span>' + folder.apps.length + '</div>' +
        '<div class="hc-props-contents">' + contents + '</div>' +
      '</div>';

    document.body.appendChild(el);
    positionPanel(el, 320);
    el.querySelector('.hc-fw-close').addEventListener('click', function(){ el.remove(); });
    makePanelDraggable(el, el.querySelector('.hc-fw-head'));

    document.addEventListener('pointerdown', function onDown(e){
      if (!el.isConnected){ document.removeEventListener('pointerdown', onDown); return; }
      if (!el.contains(e.target)) el.remove();
    });
  }

  (function bindDesktopFolderDrop(){
    if (!desktop) return;
    let hover = false;

    function hasType(e, t){
      const types = e.dataTransfer.types;
      for (let i = 0; i < types.length; i++) if (types[i] === t) return true;
      return false;
    }

    desktop.addEventListener('dragover', function(e){
      if (!hasType(e, DND_FOLDER_ITEM)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!hover){ hover = true; desktop.classList.add('hc-drop'); }
    });
    desktop.addEventListener('dragleave', function(e){
      if (e.relatedTarget && desktop.contains(e.relatedTarget)) return;
      hover = false;
      desktop.classList.remove('hc-drop');
    });
    desktop.addEventListener('drop', function(e){
      const raw = e.dataTransfer.getData(DND_FOLDER_ITEM);
      if (!raw) return;
      e.preventDefault();
      hover = false;
      desktop.classList.remove('hc-drop');

      let data;
      try { data = JSON.parse(raw); } catch(err){ return; }
      const folder = folders[data.f];
      if (!folder || folder.apps.indexOf(data.n) === -1) return;

      const dr = desktop.getBoundingClientRect();
      const cell = snapToGrid(e.clientX - dr.left, e.clientY - dr.top);
      takeOutOfFolder(data.f, data.n, cell);
    });
  })();

  desktop.addEventListener('contextmenu', function(e){
    if (e.target.closest('.app-icon')) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'Создать папку', action: createFolder },
      { label: 'Упорядочить иконки', action: reorderIcons }
    ]);
  });

  function resolveCollisions(){
    if (!desktop) return;
    const nodes = Array.prototype.slice.call(desktop.querySelectorAll('.app-icon'));
    if (!nodes.length) return;
    const map = loadIconPos();
    const taken = {};
    nodes.forEach(function(n){
      const key = n.dataset.name;
      let c = Number(n.dataset.c) || 0, r = Number(n.dataset.r) || 0;
      if (taken[c + ',' + r]){
        const free = findFreeCell(c, r, key);
        placeIconEl(n, free.c, free.r);
        c = free.c; r = free.r;
      }
      taken[c + ',' + r] = true;
      map[key] = { c: c, r: r };
    });
    saveIconPos(map);
  }

  let rzTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(rzTimer);
    rzTimer = setTimeout(resolveCollisions, 150);
  });

  function buildDesktopFolders(){
    if (!desktop) return;
    if (!desktopApps) desktopApps = loadDesktopApps();
    desktop.innerHTML = '';

    const saved = loadIconPos();
    const rowsPerCol = maxGridRows();
    const usedKeys = {};

    function place(el, key, sugC, sugR){
      let cell = saved[key];
      if (!cell || typeof cell.c !== 'number' || typeof cell.r !== 'number' ||
          cell.c < 0 || cell.r < 0 ||
          cell.c >= maxGridCols() || cell.r >= maxGridRows() ||
          cellOccupied(cell.c, cell.r, key)){
        cell = findFreeCell(sugC, sugR, key);
      }
      placeIconEl(el, cell.c, cell.r);
      usedKeys[key] = { c: cell.c, r: cell.r };
      desktop.appendChild(el);
    }

    desktopApps.forEach(function(name, i){
      const app = findAppByName(name);
      if (!app) return;
      const el = makeIconEl(app);
      place(el, name, Math.floor(i / rowsPerCol), i % rowsPerCol);
      bindMovable(el, 'app', name);
      el.addEventListener('dblclick', function(){ openApp(app); });
      el.addEventListener('keydown', function(e){ if (e.key === 'Enter') openApp(app); });
      el.addEventListener('contextmenu', function(e){
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, [
          { label: 'Открыть', action: function(){ openApp(app); } },
          { label: 'Переместить в папку…', action: function(){
              const list = folderIds().map(function(id){
                return { label: '  ' + folders[id].name, action: function(){
                  moveToFolder(app.name, FOLDER_KEY_PREFIX + id);
                }};
              });
              if (!list.length) list.push({ label: 'Сначала создайте папку', action: function(){} });
              showCtxMenu(e.clientX, e.clientY, list);
          } },
          { label: 'Убрать с рабочего стола', action: function(){ removeAppFromDesktop(app); } }
        ]);
      });
    });

    folderIds().forEach(function(id, i){
      const folder = folders[id];
      if (!folder) return;
      const el = makeFolderEl(folder);
      const idx = desktopApps.length + i;
      place(el, FOLDER_KEY_PREFIX + id, Math.floor(idx / rowsPerCol), idx % rowsPerCol);
    });

    saveIconPos(usedKeys);
  }

  window.buildDesktop = buildDesktopFolders;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ buildDesktopFolders(); });
  } else {
    buildDesktopFolders();
  }

  console.log('[DesktopFolders] Папки на рабочем столе включены');
})();

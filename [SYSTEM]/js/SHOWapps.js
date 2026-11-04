
(function initShowDesktop(){
  if (!clockEl || !clockEl.parentNode) return;

  const btn = document.createElement('div');
  btn.className = 'hc-showdesk';
  btn.id = 'hc-showdesk';
  btn.title = 'Свернуть все окна';
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', 'Свернуть все окна');

  clockEl.parentNode.insertBefore(btn, clockEl.nextSibling);

  (function injectShowDeskStyles(){
    const st = document.createElement('style');
    st.textContent = [
'#hc-showdesk{flex:0 0 11px;width:11px;min-width:11px;align-self:stretch;cursor:pointer; right: -11px;',
        'position:relative;margin-left:auto;',
        'border-left:1px solid color-mix(in srgb, var(--border) 90%, white);',
        'transition:background .15s ease;-webkit-tap-highlight-color:transparent}',
      '#hc-showdesk:hover{background:var(--hc-hover,rgba(255,255,255,.14))}',
      '#hc-showdesk:active{background:var(--hc-hover,rgba(255,255,255,.2))}',

    ].join('\n');
    (document.head || document.body).appendChild(st);
  })();

  let deskMode = false;    
  let stash = [];          

  function updateInd(){
    btn.classList.toggle('hc-on', deskMode);
  }

  function showDesktopClick(){
    closeAllPops();
    hideCtxMenu();

    stash = stash.filter(function(w){ return openWins.indexOf(w) !== -1; });

    const visible = openWins.filter(function(w){ return !w.minimized; });

    if (visible.length){
       
      stash = visible;
      visible.forEach(function(w){ minimizeWin(w); });
      deskMode = true;
    } else {
       
      const list = stash.length ? stash.slice() : openWins.filter(function(w){ return w.minimized; });
      list.reverse().forEach(function(w){ restoreWin(w); });
      stash = [];
      deskMode = false;
    }
    updateInd();
  }

  btn.addEventListener('click', showDesktopClick);

  const _focusWin = focusWin;
  focusWin = function(win){
    if (deskMode){ deskMode = false; updateInd(); }
    _focusWin(win);
  };
})();
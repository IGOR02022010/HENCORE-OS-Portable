(function () {
'use strict';

if (window.HENCORE_WEATHER_WIDGET) return;
window.HENCORE_WEATHER_WIDGET = true;

var WSTORE      = 'hencore_os_weather_widgets_v1';
var TASKBAR_H   = 48;
var REFRESH_MS  = 10 * 60 * 1000;
var GEO_TIMEOUT = 9000;
var W = 264, H = 224;   // габариты как у обычных виджетов ядра

var WD_SHORT = ['вс','пн','вт','ср','чт','пт','сб'];

var widgets = [];
var layer = null;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function num(v){
  var n = typeof v === 'number' ? v : parseFloat(v);
  return (typeof n === 'number' && !isNaN(n)) ? n : null;
}
function fmtT(v){
  var n = num(v);
  if (n == null) return '—';
  return Math.round(n) + '°';
}

/* ---------- слой виджетов: используем общий слой ядра ---------- */

function getCoreLayer(){
  return document.getElementById('hc-wdg-layer');
}

function makeFallbackLayer(){
  var l = document.createElement('div');
  l.id = 'hc-wx-layer';
  // идентично слою ядра, чтобы виджет был «наравне» даже без него
  l.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:48px;pointer-events:none;z-index:3';
  document.body.appendChild(l);
  return l;
}

function waitForLayer(cb){
  var l = getCoreLayer();
  if (l){ cb(l); return; }
  var tries = 0;
  var iv = setInterval(function(){
    l = getCoreLayer();
    if (l){ clearInterval(iv); cb(l); }
    else if (++tries > 40){ clearInterval(iv); cb(makeFallbackLayer()); }
  }, 100);
}

function raiseWidget(w){
  if (!w.el || !layer) return;
  var max = 0;
  Array.prototype.forEach.call(layer.children, function(n){
    var z = parseInt(n.style.zIndex, 10);
    if (z > max) max = z;
  });
  w.el.style.zIndex = String(max + 1);
}

/* ---------- сеть ---------- */

function getJSON(url, timeout){
  timeout = timeout || 10000;
  var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  var opts = ctl ? { signal: ctl.signal } : {};
  var to = setTimeout(function(){ if (ctl) ctl.abort(); }, timeout);
  return fetch(url, opts).then(function(r){
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }).then(function(j){ clearTimeout(to); return j; },
          function(e){ clearTimeout(to); throw e; });
}

function trySequential(fns){
  var i = 0;
  function next(){
    if (i >= fns.length) return Promise.reject(new Error('all failed'));
    var f = fns[i++];
    return Promise.resolve().then(f).catch(function(){ return next(); });
  }
  return next();
}

/* ---------- хранилище ---------- */

function loadAll(){
  try{
    var r = JSON.parse(localStorage.getItem(WSTORE));
    if (Array.isArray(r)) return r;
  }catch(e){}
  return [];
}

function saveAll(){
  try{
    localStorage.setItem(WSTORE, JSON.stringify(widgets.map(function(w){
      return { id: w.id, type: 'weather', x: w.x, y: w.y, data: w.data };
    })));
  }catch(e){}
}

/* ---------- меню (как у ядра) ---------- */

var MARK = 'Добавить виджет: ';

function hookMenu(){
  if (typeof window.showCtxMenu !== 'function') return false;
  if (window.__hcwxHooked) return true;
  window.__hcwxHooked = true;
  var orig = window.showCtxMenu;
  window.showCtxMenu = function(x, y, items){
    try{
      if (Array.isArray(items) &&
          items.some(function(it){
            return it && typeof it.label === 'string' && it.label.indexOf(MARK) === 0;
          }) &&
          !items.some(function(it){
            return it && it.label === MARK + 'Погода';
          })){
        items = items.concat([{
          label: 'Добавить виджет: Погода',
          action: function(){ addWeatherWidget(x, y); }
        }]);
      }
    }catch(e){}
    return orig(x, y, items);
  };
  return true;
}

function hookWhenReady(delay){
  setTimeout(function(){
    if (!hookMenu()) hookWhenReady(500);
  }, delay);
}

function showMenu(x, y, items){
  if (typeof window.showCtxMenu === 'function'){
    window.showCtxMenu(x, y, items);
    return;
  }
  var m = document.createElement('div');
  m.style.cssText = 'position:fixed;z-index:3;min-width:190px;padding:6px;display:flex;flex-direction:column;gap:2px;background:var(--hc-panel,#1b1e24);border:1px solid var(--hc-border,#2e3440);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.5)';
  items.forEach(function(it){
    var b = document.createElement('button');
    b.textContent = it.label;
    b.style.cssText = 'all:unset;cursor:pointer;color:var(--hc-text,#e8eaed);font-size:13px;padding:7px 12px;border-radius:7px;white-space:nowrap';
    b.addEventListener('click', function(e){
      e.stopPropagation();
      m.remove();
      it.action();
    });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  var r = m.getBoundingClientRect();
  m.style.left = clamp(x, 4, innerWidth - r.width - 6) + 'px';
  m.style.top  = clamp(y, 4, innerHeight - r.height - 6) + 'px';
  m.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
  setTimeout(function(){
    document.addEventListener('pointerdown', function h(){
      m.remove();
      document.removeEventListener('pointerdown', h);
    });
  }, 0);
}

/* ---------- геолокация ---------- */

function geoPermission(){
  return new Promise(function(res, rej){
    if (!navigator.geolocation) return rej(new Error('no geo'));
    navigator.geolocation.getCurrentPosition(
      function(p){ res({ lat: p.coords.latitude, lon: p.coords.longitude, city: '' }); },
      function(){ rej(new Error('denied')); },
      { timeout: GEO_TIMEOUT, maximumAge: 10 * 60 * 1000 });
  });
}

function ipGeo(){
  return trySequential([
    function(){
      return getJSON('https://get.geojs.io/v1/ip/geo.json', 8000).then(function(j){
        if (!j || typeof j.latitude === 'undefined' || typeof j.longitude === 'undefined'){
          throw new Error('no ip geo');
        }
        return { lat: parseFloat(j.latitude), lon: parseFloat(j.longitude), city: j.city || j.region || '' };
      });
    },
    function(){
      return getJSON('https://ipwho.is/', 8000).then(function(j){
        if (!j || j.success === false || typeof j.latitude !== 'number') throw new Error('no ip geo');
        return { lat: j.latitude, lon: j.longitude, city: j.city || '' };
      });
    },
    function(){
      return getJSON('https://ipapi.co/json/', 8000).then(function(j){
        if (!j || typeof j.latitude === 'undefined') throw new Error('no ip geo');
        return { lat: parseFloat(j.latitude), lon: parseFloat(j.longitude), city: j.city || '' };
      });
    }
  ]);
}

function reverseCity(lat, lon){
  return getJSON('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
    lat + '&longitude=' + lon + '&localityLanguage=ru', 8000)
    .then(function(j){
      var c = j && (j.city || j.locality);
      if (!c) throw new Error('no city');
      return c;
    })
    .catch(function(){
      return getJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' +
        lat + '&lon=' + lon + '&accept-language=ru', 8000)
        .then(function(j){
          var a = (j && j.address) || {};
          return a.city || a.town || a.village || a.municipality || '';
        })
        .catch(function(){ return ''; });
    });
}

function geocodeCity(name){
  return getJSON('https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(name) + '&count=1&language=ru&format=json', 8000)
    .then(function(j){
      var r = j && j.results && j.results[0];
      if (!r) throw new Error('not found');
      return {
        lat: r.latitude,
        lon: r.longitude,
        city: r.name + ((r.admin1 && r.admin1 !== r.name) ? ', ' + r.admin1 : '')
      };
    })
    .catch(function(){
      return getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=' +
        encodeURIComponent(name), 8000)
        .then(function(arr){
          var r = arr && arr[0];
          if (!r) throw new Error('not found');
          return { lat: parseFloat(r.lat), lon: parseFloat(r.lon),
                   city: String(r.display_name || name).split(',')[0] };
        });
    });
}

function ensureGeo(w){
  if (typeof w.data.lat === 'number') return Promise.resolve();
  return geoPermission().catch(function(){ return ipGeo(); }).then(function(g){
    w.data.lat = g.lat;
    w.data.lon = g.lon;
    if (g.city) w.data.city = g.city;
    if (w.data.city){ saveAll(); return; }
    return reverseCity(g.lat, g.lon).then(function(c){
      w.data.city = c || '';
      saveAll();
    });
  });
}

/* ---------- погодные API ---------- */

function wmo(code){
  var m = {
    0:['Ясно','☀️'], 1:['Преимущественно ясно','🌤️'], 2:['Переменная облачность','⛅'],
    3:['Пасмурно','☁️'], 45:['Туман','🌫️'], 48:['Туман','🌫️'],
    51:['Морось','🌦️'], 53:['Морось','🌦️'], 55:['Морось','🌦️'],
    56:['Ледяная морось','🌧️'], 57:['Ледяная морось','🌧️'],
    61:['Небольшой дождь','🌦️'], 63:['Дождь','🌧️'], 65:['Сильный дождь','🌧️'],
    66:['Ледяной дождь','🌧️'], 67:['Ледяной дождь','🌧️'],
    71:['Небольшой снег','🌨️'], 73:['Снег','❄️'], 75:['Сильный снег','❄️'],
    77:['Снежные зёрна','🌨️'],
    80:['Ливень','🌦️'], 81:['Сильный ливень','🌧️'], 82:['Очень сильный ливень','⛈️'],
    85:['Снегопад','🌨️'], 86:['Снегопад','🌨️'],
    95:['Гроза','⛈️'], 96:['Гроза с градом','⛈️'], 99:['Гроза с градом','⛈️']
  };
  return m[code] || ['Облачно','⛅'];
}

function pmForecast(base, d){
  var url = base + '?latitude=' + d.lat + '&longitude=' + d.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&forecast_days=3&timezone=auto&wind_speed_unit=ms';
  return getJSON(url).then(function(j){
    if (!j || !j.current) throw new Error('bad data');
    var cur = j.current;
    var wm = wmo(typeof cur.weather_code === 'number' ? cur.weather_code : -1);
    var days = [];
    var daily = j.daily || {};
    if (Array.isArray(daily.time)){
      for (var i = 0; i < daily.time.length && i < 3; i++){
        var dwm = wmo(daily.weather_code ? daily.weather_code[i] : -1);
        days.push({
          date: daily.time[i],
          ico: dwm[1], desc: dwm[0],
          tmax: num(daily.temperature_2m_max ? daily.temperature_2m_max[i] : null),
          tmin: num(daily.temperature_2m_min ? daily.temperature_2m_min[i] : null)
        });
      }
    }
    return {
      cur: { t: num(cur.temperature_2m), feels: num(cur.apparent_temperature),
             hum: num(cur.relative_humidity_2m), wind: num(cur.wind_speed_10m),
             ico: wm[1], desc: wm[0] },
      days: days
    };
  });
}

var WTTR2WMO = {113:0,116:2,119:3,122:3,143:45,176:80,179:71,182:66,185:56,
  200:95,227:71,230:75,248:45,260:45,263:51,266:51,281:53,284:55,
  293:61,296:61,299:63,302:63,305:65,308:65,311:66,314:66,
  317:71,320:73,323:71,326:71,329:73,332:73,335:75,338:75,
  350:66,353:80,356:81,359:82,362:56,365:56,368:71,371:75,
  374:57,377:57,386:95,389:95,392:95,395:75};

function wttrWmo(code){
  code = parseInt(code, 10);
  if (isNaN(code)) return null;
  var w = WTTR2WMO[code];
  return (typeof w === 'number') ? wmo(w) : null;
}

function fetchWttr(d){
  var url = 'https://wttr.in/' + d.lat + ',' + d.lon + '?format=j1&lang=ru';
  return getJSON(url, 9000).then(function(j){
    if (!j || !j.current_condition || !j.current_condition.length || !j.weather || !j.weather.length){
      throw new Error('bad data');
    }
    var c = j.current_condition[0];
    var wm = wttrWmo(c.weatherCode);
    if (!wm){
      var ru = c.lang_ru && c.lang_ru[0] && c.lang_ru[0].value;
      var en = c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value;
      wm = ['Облачно', '⛅'];
    }
    var days = [];
    for (var i = 0; i < j.weather.length && i < 3; i++){
      var wd = j.weather[i];
      var dwm = wttrWmo(wd.weatherCode) || ['Облачно', '⛅'];
      days.push({
        date: wd.date,
        ico: dwm[1], desc: dwm[0],
        tmax: num(wd.maxtempC), tmin: num(wd.mintempC)
      });
    }
    return {
      cur: { t: num(c.temp_C), feels: num(c.FeelsLikeC),
             hum: num(c.humidity),
             wind: (num(c.windspeedKmph) != null ? num(c.windspeedKmph) / 3.6 : null),
             ico: wm[1], desc: wm[0] },
      days: days
    };
  });
}

var YR_SYMB = {
  clearsky: ['Ясно','☀️'],
  fair: ['Преимущественно ясно','🌤️'],
  partlycloudy: ['Переменная облачность','⛅'],
  cloudy: ['Пасмурно','☁️'],
  fog: ['Туман','🌫️'],
  lightrain: ['Небольшой дождь','🌦️'],
  rain: ['Дождь','🌧️'],
  heavyrain: ['Сильный дождь','🌧️'],
  lightrainshowers: ['Ливень','🌦️'],
  rainshowers: ['Ливень','🌧️'],
  heavyrainshowers: ['Сильный ливень','⛈️'],
  lightsnow: ['Небольшой снег','🌨️'],
  snow: ['Снег','❄️'],
  heavysnow: ['Сильный снег','❄️'],
  lightsnowshowers: ['Снегопад','🌨️'],
  snowshowers: ['Снегопад','🌨️'],
  heavysnowshowers: ['Сильный снегопад','❄️'],
  sleet: ['Мокрый снег','🌨️'],
  lightsleet: ['Мокрый снег','🌨️'],
  heavysleet: ['Мокрый снег','🌨️'],
  sleetshowers: ['Мокрый снег','🌨️'],
  lightsleetshowers: ['Мокрый снег','🌨️'],
  heavysleetshowers: ['Мокрый снег','🌨️'],
  lightrainshowersandthunder: ['Гроза с дождём','⛈️'],
  rainshowersandthunder: ['Гроза','⛈️'],
  heavyrainshowersandthunder: ['Гроза','⛈️'],
  lightrainandthunder: ['Гроза с дождём','⛈️'],
  rainandthunder: ['Гроза','⛈️'],
  heavyrainandthunder: ['Гроза','⛈️'],
  lightsnowandthunder: ['Гроза со снегом','⛈️'],
  snowandthunder: ['Гроза со снегом','⛈️'],
  heavysnowandthunder: ['Гроза со снегом','⛈️'],
  snowshowersandthunder: ['Снегопад с грозой','⛈️'],
  lightsnowshowersandthunder: ['Снегопад с грозой','⛈️'],
  heavysnowshowersandthunder: ['Снегопад с грозой','⛈️'],
  sleetandthunder: ['Гроза с мокрым снегом','⛈️'],
  sleetshowersandthunder: ['Гроза с мокрым снегом','⛈️'],
  heavysleetshowersandthunder: ['Гроза с мокрым снегом','⛈️']
};

function yrSymb(code){
  if (!code) return null;
  var b = String(code).replace(/_(day|night|polartwilight)$/, '');
  return YR_SYMB[b] || ['Погода', '⛅'];
}

function fetchYr(d){
  var url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' +
    d.lat.toFixed(4) + '&lon=' + d.lon.toFixed(4);
  return getJSON(url, 9000).then(function(j){
    var ts = j && j.properties && j.properties.timeseries;
    if (!Array.isArray(ts) || !ts.length) throw new Error('bad data');

    var now = Date.now();
    var byDay = {};
    var cur = null, curSym = '', nextSym = '';

    ts.forEach(function(e){
      var t = new Date(e.time);
      if (isNaN(t)) return;
      var det = (e.data && e.data.instant && e.data.instant.details) || {};
      if (t.getTime() <= now) cur = det;

      var sym = '';
      var h1 = e.data && e.data.next_1_hours;
      var h6 = e.data && e.data.next_6_hours;
      if (h1 && h1.summary && h1.summary.symbol_code) sym = h1.summary.symbol_code;
      else if (h6 && h6.summary && h6.summary.symbol_code) sym = h6.summary.symbol_code;

      if (!nextSym && sym && t.getTime() >= now) nextSym = sym;

      var key = e.time.slice(0, 10);
      var o = byDay[key] = byDay[key] || { tmax: -Infinity, tmin: Infinity, sym: '' };
      if (typeof det.air_temperature === 'number'){
        if (det.air_temperature > o.tmax) o.tmax = det.air_temperature;
        if (det.air_temperature < o.tmin) o.tmin = det.air_temperature;
      }
      if (sym && !o.sym) o.sym = sym;
    });

    if (!cur) cur = ts[0].data.instant.details || {};

    var keys = Object.keys(byDay).sort().slice(0, 3);
    var days = keys.map(function(k){
      var o = byDay[k];
      var sm = yrSymb(o.sym) || yrSymb(nextSym) || ['Погода', '⛅'];
      return { date: k, ico: sm[1], desc: sm[0],
        tmax: isFinite(o.tmax) ? o.tmax : null,
        tmin: isFinite(o.tmin) ? o.tmin : null };
    });

    var cm = yrSymb(nextSym) || (days[0] ? [days[0].desc, days[0].ico] : ['Погода', '⛅']);
    return {
      cur: { t: num(cur.air_temperature), feels: null,
             hum: num(cur.relative_humidity), wind: num(cur.wind_speed),
             ico: cm[1], desc: cm[0] },
      days: days
    };
  });
}

function fetchWeather(w){
  var d = w.data;
  return trySequential([
    function(){ return pmForecast('https://api.open-meteo.com/v1/forecast', d); },
    function(){ return pmForecast('https://previous-runs-api.open-meteo.com/v1/forecast', d); },
    function(){ return fetchWttr(d); },
    function(){ return fetchYr(d); }
  ]).then(function(norm){ w._wx = norm; });
}

/* ---------- отрисовка ---------- */

function renderWeather(w){
  var wx = w._wx;
  if (!wx || !wx.cur) return;
  var c = wx.cur;

  var meta = [];
  if (c.feels != null) meta.push('Ощущается ' + fmtT(c.feels));
  if (c.wind != null){
    meta.push('Ветер ' + String(Math.round(c.wind * 10) / 10).replace('.', ',') + ' м/с');
  }
  if (c.hum != null) meta.push('Влажность ' + Math.round(c.hum) + '%');

  var daysHtml = '';
  (wx.days || []).slice(0, 3).forEach(function(dd, i){
    var lbl;
    if (i === 0) lbl = 'Сегодня';
    else if (i === 1) lbl = 'Завтра';
    else {
      var dt = new Date(dd.date + 'T12:00:00');
      lbl = isNaN(dt.getTime()) ? '' : WD_SHORT[dt.getDay()];
    }
    daysHtml +=
      '<div class="hc-wx-day">' +
        '<span>' + esc(lbl) + '</span>' +
        '<span class="hc-wx-dico">' + dd.ico + '</span>' +
        '<span class="hc-wx-dt">' + fmtT(dd.tmax) + ' / ' + fmtT(dd.tmin) + '</span>' +
      '</div>';
  });

  w.body.innerHTML =
    '<div class="hc-wx-city" title="' + esc(w.data.city || 'Моё местоположение') + '">' +
      esc(w.data.city || 'Моё местоположение') + '</div>' +
    '<div class="hc-wx-main">' +
      '<div class="hc-wx-ico">' + (c.ico || '⛅') + '</div>' +
      '<div><div class="hc-wx-temp">' + fmtT(c.t) + '</div>' +
      '<div class="hc-wx-desc">' + esc(c.desc || 'Погода') + '</div></div>' +
    '</div>' +
    '<div class="hc-wx-meta">' + esc(meta.join(' · ')) + '</div>' +
    '<div class="hc-wx-days">' + daysHtml + '</div>';
}

function showStatus(w, text, withRetry){
  w.body.innerHTML =
    '<div class="hc-wx-status">' + esc(text) +
    (withRetry ? '<br><button class="hc-wx-retry">Повторить</button>' : '') +
    '</div>';
  if (withRetry){
    w.body.querySelector('.hc-wx-retry').addEventListener('click', function(e){
      e.stopPropagation();
      loadWeather(w);
    });
  }
}

function loadWeather(w){
  showStatus(w, 'Определяем местоположение…');
  setBusy(w, true);
  ensureGeo(w)
    .then(function(){
      showStatus(w, 'Загружаем погоду…');
      return fetchWeather(w);
    })
    .then(function(){ renderWeather(w); })
    .catch(function(){
      if (typeof w.data.lat === 'number'){
        showStatus(w, 'Не удалось получить данные о погоде.\nПроверьте подключение.', true);
      } else {
        showStatus(w, 'Не удалось определить местоположение.\nУкажите город вручную: правый клик по виджету.', true);
      }
    })
    .then(function(){ setBusy(w, false); });
}

function setBusy(w, on){
  var b = w.el && w.el.querySelector('.hc-wx-btn');
  if (b) b.classList.toggle('busy', !!on);
}

function refresh(w){
  if (typeof w.data.lat !== 'number'){ loadWeather(w); return; }
  setBusy(w, true);
  fetchWeather(w).then(function(){ renderWeather(w); })
    .catch(function(){ showStatus(w, 'Не удалось обновить погоду.', true); })
    .then(function(){ setBusy(w, false); });
}

function askCity(w){
  var name = prompt('Введите название города:', w.data.city || '');
  if (!name || !name.trim()) return;
  name = name.trim();
  showStatus(w, 'Ищем город «' + name + '»…');
  geocodeCity(name)
    .then(function(g){
      w.data.lat = g.lat;
      w.data.lon = g.lon;
      w.data.city = g.city;
      w.data.manual = true;
      saveAll();
      refresh(w);
    })
    .catch(function(){
      if (window.HENCORE && HENCORE.notify){
        HENCORE.notify('Погода', 'Город «' + name + '» не найден.');
      }
      if (typeof w.data.lat === 'number') renderWeather(w);
      else showStatus(w, 'Город не найден. Попробуйте другое название.', true);
    });
}

/* ---------- создание и жизненный цикл (как в ядре) ---------- */

function addWeatherWidget(px, py){
  var w = {
    id: 'wx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: 'weather',
    x: 0, y: 0,
    data: { lat: null, lon: null, city: '' }
  };
  w.x = clamp(px - W / 2, 6, Math.max(6, innerWidth - W - 6));
  w.y = clamp(py - 16, 6, Math.max(6, innerHeight - TASKBAR_H - H - 6));
  widgets.push(w);
  renderWidget(w);
  saveAll();
  loadWeather(w);
}

function renderWidget(w){
  var el = document.createElement('div');
  el.className = 'hc-wdg hc-wx';
  el.style.width = W + 'px';
  el.style.height = H + 'px';
  el.style.left = w.x + 'px';
  el.style.top = w.y + 'px';
  el.innerHTML =
    '<div class="hc-wdg-head">' +
      '<span class="hc-wdg-title">Погода</span>' +
      '<span class="hc-wx-hbtns">' +
        '<button class="hc-wx-btn hc-wdg-close" title="Обновить">⟳</button>' +
        '<button class="hc-wdg-close" title="Убрать виджет">&#10005;</button>' +
      '</span>' +
    '</div>' +
    '<div class="hc-wdg-body hc-wx-body"></div>';

  w.el = el;
  w.body = el.querySelector('.hc-wx-body');
  w.data = w.data || {};

  raiseWidget(w);
  el.addEventListener('pointerdown', function(){
    raiseWidget(w);
  });

  el.querySelector('.hc-wx-btn').addEventListener('click', function(e){
    e.stopPropagation();
    refresh(w);
  });
  el.querySelector('.hc-wdg-close[title="Убрать виджет"]').addEventListener('click', function(e){
    e.stopPropagation();
    removeWidget(w);
  });

  el.addEventListener('contextmenu', function(e){
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { label: 'Обновить', action: function(){ refresh(w); } },
      { label: 'Указать город вручную', action: function(){ askCity(w); } },
      { label: 'Определить местоположение заново', action: function(){
          w.data.lat = null; w.data.lon = null; w.data.manual = false;
          saveAll();
          loadWeather(w);
        } },
      { label: 'Убрать виджет', action: function(){ removeWidget(w); } }
    ]);
  });

  bindDrag(w);

  w._tmr = setInterval(function(){ refresh(w); }, REFRESH_MS);

  layer.appendChild(el);
}

function removeWidget(w){
  if (w._tmr){ clearInterval(w._tmr); w._tmr = null; }
  if (w.el) w.el.remove();
  var i = widgets.indexOf(w);
  if (i >= 0) widgets.splice(i, 1);
  saveAll();
}

function bindDrag(w){
  var head = w.el.querySelector('.hc-wdg-head');
  var sx = 0, sy = 0, ox = 0, oy = 0, drag = false;

  head.addEventListener('pointerdown', function(e){
    if (e.target.closest('button')) return;
    drag = true;
    head.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY;
    ox = w.x; oy = w.y;
    raiseWidget(w);
    e.preventDefault();
  });
  head.addEventListener('pointermove', function(e){
    if (!drag) return;
    w.x = clamp(ox + e.clientX - sx, 6, Math.max(6, innerWidth - w.el.offsetWidth - 6));
    w.y = clamp(oy + e.clientY - sy, 6, Math.max(6, innerHeight - TASKBAR_H - w.el.offsetHeight - 6));
    w.el.style.left = w.x + 'px';
    w.el.style.top  = w.y + 'px';
  });
  head.addEventListener('pointerup', function(){ if (drag){ drag = false; saveAll(); } });
  head.addEventListener('pointercancel', function(){ drag = false; });
}

/* ---------- стили: выровнены под карточки ядра ---------- */

function injectStyles(){
  var st = document.createElement('style');
  st.id = 'hc-wx-styles';
  st.textContent = [
    // запасной слой — точно такой же, как слой виджетов ядра
    '#hc-wx-layer{position:fixed;left:0;top:0;right:0;bottom:48px;pointer-events:none;z-index:3}',
    // базовая карточка — те же значения, что у .hc-wdg ядра
    '.hc-wdg.hc-wx{position:absolute;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;',
      'background:rgba(18,21,26,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);',
      'border:1px solid var(--hc-border,rgba(255,255,255,.14));border-radius:14px;',
      'box-shadow:0 14px 34px rgba(0,0,0,.45);color:var(--hc-text,#e8eaed);',
      'font-family:inherit;user-select:none;-webkit-user-select:none}',
    'html[data-theme="light"] .hc-wdg.hc-wx{background:rgba(250,250,252,.9);color:#202124;',
      'border-color:#d3d7de;box-shadow:0 10px 26px rgba(0,0,0,.18)}',
    // шапка — как в ядре
    '.hc-wx .hc-wdg-head{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:move;',
      'flex:0 0 auto;touch-action:none;border-bottom:1px solid var(--hc-border,rgba(255,255,255,.09))}',
    'html[data-theme="light"] .hc-wx .hc-wdg-head{border-bottom-color:#e3e6ec}',
    '.hc-wdg-title{font-size:12px;font-weight:600;opacity:.75;letter-spacing:.3px}',
    '.hc-wx-hbtns{display:flex;gap:2px;margin-left:auto}',
    '.hc-wx .hc-wdg-close,.hc-wx-btn{all:unset;cursor:pointer;width:22px;height:22px;',
      'display:flex;align-items:center;justify-content:center;border-radius:6px;',
      'font-size:14px;line-height:1}',
    '.hc-wx .hc-wdg-close:hover,.hc-wx-btn:hover{background:var(--hc-hover,rgba(255,255,255,.12))}',
    '.hc-wx-btn.busy{animation:hcwx-spin 1s linear infinite}',
    '@keyframes hcwx-spin{to{transform:rotate(360deg)}}',
    '.hc-wx-body{flex:1;padding:10px 12px 12px;overflow:auto}',
    '.hc-wx-city{font-weight:600;font-size:14px;margin-bottom:8px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hc-wx-main{display:flex;align-items:center;gap:10px;margin-bottom:6px}',
    '.hc-wx-ico{font-size:38px;line-height:1}',
    '.hc-wx-temp{font-size:30px;font-weight:700;line-height:1.05;',
      'font-variant-numeric:tabular-nums}',
    '.hc-wx-desc{font-size:12px;opacity:.75}',
    '.hc-wx-meta{font-size:11.5px;opacity:.7;line-height:1.5;margin-bottom:10px}',
    '.hc-wx-days{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '.hc-wx-day{display:flex;flex-direction:column;align-items:center;gap:3px;',
      'padding:7px 4px;border-radius:9px;',
      'background:var(--hc-hover,rgba(255,255,255,.06))}',
    'html[data-theme="light"] .hc-wx-day{background:rgba(0,0,0,.05)}',
    '.hc-wx-day span:first-child{font-size:10.5px;opacity:.7}',
    '.hc-wx-dico{font-size:19px}',
    '.hc-wx-dt{font-size:11.5px;font-variant-numeric:tabular-nums}',
    '.hc-wx-status{padding:26px 8px;text-align:center;opacity:.75;font-size:12.5px;',
      'white-space:pre-line;line-height:1.5}',
    '.hc-wx-retry{all:unset;cursor:pointer;display:inline-block;margin-top:8px;',
      'padding:5px 14px;border-radius:8px;background:var(--accent,#4cc2ff);',
      'color:#fff;font-size:12.5px}'
  ].join('\n');
  (document.head || document.body).appendChild(st);
}

/* ---------- инициализация ---------- */

function init(){
  injectStyles();
  waitForLayer(function(l){
    layer = l;
    loadAll().forEach(function(rec){
      var w = {
        id: rec.id, type: 'weather',
        x: typeof rec.x === 'number' ? rec.x : 40,
        y: typeof rec.y === 'number' ? rec.y : 40,
        data: (rec.data && typeof rec.data === 'object') ? rec.data : {}
      };
      widgets.push(w);
      renderWidget(w);
      loadWeather(w);
    });
    hookWhenReady(0);
  });
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();

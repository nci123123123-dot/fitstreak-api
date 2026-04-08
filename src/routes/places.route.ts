import { FastifyInstance } from 'fastify';

export async function placesRoutes(app: FastifyInstance) {
  // GET /places/staticmap — 카카오 Static Map 이미지 프록시
  app.get('/places/staticmap', async (request, reply) => {
    const { myLat, myLng, gymLat, gymLng, w, h } = request.query as {
      myLat: string; myLng: string; gymLat: string; gymLng: string;
      w?: string; h?: string;
    };
    if (!myLat || !myLng || !gymLat || !gymLng) {
      return reply.code(400).send({ error: 'myLat, myLng, gymLat, gymLng required' });
    }

    const width  = Math.min(parseInt(w ?? '640'), 640);
    const height = Math.min(parseInt(h ?? '300'), 400);

    // 두 마커가 모두 보이도록 중심점 계산
    const centerLat = (parseFloat(myLat) + parseFloat(gymLat)) / 2;
    const centerLng = (parseFloat(myLng) + parseFloat(gymLng)) / 2;

    const url = new URL('https://dapi.kakao.com/v2/maps/api/staticmap');
    url.searchParams.set('center', `${centerLng},${centerLat}`);
    url.searchParams.set('level',  '4');
    url.searchParams.set('w',      String(width));
    url.searchParams.set('h',      String(height));
    // 헬스장 마커 (빨강)
    url.searchParams.append('marker', `pos:${gymLng} ${gymLat}|color:red`);
    // 내 위치 마커 (파랑)
    url.searchParams.append('marker', `pos:${myLng} ${myLat}|color:blue`);

    const res = await fetch(url.toString(), {
      headers: { Authorization: 'KakaoAK e60a761729c6b740847a06d43cd87687' },
    });
    const buffer = await res.arrayBuffer();
    reply
      .header('Content-Type', res.headers.get('content-type') ?? 'image/png')
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(buffer));
  });

  // GET /map — GPS 인증 지도 (Leaflet + OSM, 도메인 인증 불필요)
  app.get('/map', async (request, reply) => {
    const { gymLat, gymLng, gymName } = request.query as {
      gymLat: string; gymLng: string; gymName?: string;
    };
    const gLat = parseFloat(gymLat);
    const gLng = parseFloat(gymLng);
    const name = (gymName ?? '내 헬스장').replace(/['"<>&]/g, '');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
@keyframes pulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(2.2);opacity:0}100%{transform:scale(1);opacity:0}}
.my-marker{position:relative;width:22px;height:22px}
.my-marker .ring{position:absolute;inset:0;border-radius:50%;animation:pulse 2s ease-out infinite}
.my-marker .dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.my-marker.ok .ring{background:rgba(48,209,88,.35)}
.my-marker.ok .dot{background:#30d158}
.my-marker.far .ring{background:rgba(255,69,58,.35)}
.my-marker.far .dot{background:#ff453a}
.my-marker.blue .ring{background:rgba(79,142,247,.35)}
.my-marker.blue .dot{background:#4f8ef7}
#waiting{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.78);color:#ccc;font-size:12px;padding:7px 16px;border-radius:20px;pointer-events:none;z-index:9999;white-space:nowrap}
</style>
</head>
<body>
<div id="map"></div>
<div id="waiting">📡 내 위치 확인 중...</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var gLat=${gLat}, gLng=${gLng};
var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([gLat,gLng],17);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);

function makeMyIcon(cls){
  return L.divIcon({
    html:'<div class="my-marker '+cls+'"><div class="ring"></div><div class="dot"></div></div>',
    iconSize:[22,22],iconAnchor:[11,11],className:''
  });
}

// 헬스장 마커
var gymIcon=L.divIcon({html:'<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">🏋️</div>',iconSize:[32,32],iconAnchor:[16,32],className:''});
L.marker([gLat,gLng],{icon:gymIcon}).addTo(map)
  .bindTooltip('${name}',{permanent:true,direction:'top',offset:[0,-34]});

// 300m 반경 원
var circle=L.circle([gLat,gLng],{radius:10,color:'#4f8ef7',weight:2,opacity:.9,fillColor:'#4f8ef7',fillOpacity:.15}).addTo(map);

var myMarker=null;
var firstUpdate=true;

function applyMsg(d){
  if(typeof d.lat!=='number'||typeof d.lng!=='number')return;
  var ok=!!d.ok;
  var cls=ok?'ok':'far';
  var color=ok?'#30d158':'#ff453a';
  circle.setStyle({color:color,fillColor:color});
  if(!myMarker){
    myMarker=L.marker([d.lat,d.lng],{icon:makeMyIcon(cls),zIndexOffset:1000}).addTo(map);
  } else {
    myMarker.setLatLng([d.lat,d.lng]);
    myMarker.setIcon(makeMyIcon(cls));
  }
  var w=document.getElementById('waiting');
  if(w)w.style.display='none';
  if(firstUpdate){
    firstUpdate=false;
    map.setView([d.lat,d.lng],17);
  } else {
    if(!map.getBounds().contains([d.lat,d.lng])) map.panTo([d.lat,d.lng]);
  }
}

function onMsg(e){try{applyMsg(JSON.parse(e.data));}catch(_){}}
window.addEventListener('message',onMsg);
document.addEventListener('message',onMsg);
</script>
</body>
</html>`;
    reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /gym-picker — 헬스장 등록용 지도 (Leaflet + 카카오 Places 검색, GPS 지도와 통합 스타일)
  app.get('/gym-picker', async (request, reply) => {
    const { initLat, initLng } = request.query as { initLat?: string; initLng?: string };
    const lat = parseFloat(initLat ?? '37.5665');
    const lng = parseFloat(initLng ?? '126.9780');
    const hasInit = !!(initLat && initLng);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;font-family:-apple-system,sans-serif;background:#1a1a2e}
#search-bar{position:fixed;top:0;left:0;right:0;z-index:1000;display:flex;gap:6px;padding:10px 12px;background:rgba(10,10,10,.97);border-bottom:1px solid #222}
#search-input{flex:1;background:#1c1c1e;border:1px solid #333;color:#fff;font-size:14px;padding:9px 12px;border-radius:10px;outline:none}
#search-input::placeholder{color:#555}
#search-btn{background:#4f8ef7;color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:14px;font-weight:700;white-space:nowrap;cursor:pointer}
#map{position:fixed;top:52px;left:0;right:0;bottom:72px}
#results{position:fixed;top:52px;left:0;right:0;z-index:999;background:#111;border-bottom:1px solid #222;max-height:250px;overflow-y:auto;display:none}
.ri{padding:13px 16px;border-bottom:1px solid #1c1c1e;cursor:pointer;-webkit-tap-highlight-color:rgba(255,255,255,.05)}
.rn{color:#fff;font-size:14px;font-weight:600}
.ra{color:#636366;font-size:12px;margin-top:3px}
#bottom-bar{position:fixed;bottom:0;left:0;right:0;background:rgba(10,10,10,.97);padding:10px 16px;border-top:1px solid #222;z-index:1000}
#place-label{color:#8e8e93;font-size:12px;text-align:center;margin-bottom:7px;min-height:16px}
#confirm-btn{width:100%;background:#4f8ef7;color:#fff;border:none;padding:14px;border-radius:13px;font-size:15px;font-weight:700;cursor:pointer}
#confirm-btn:disabled{background:#2a2a2a;color:#3a3a3c;cursor:default}
#my-btn{position:fixed;bottom:86px;right:14px;z-index:1001;width:42px;height:42px;background:#1c1c1e;border:1px solid #333;border-radius:21px;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
@keyframes pulse{0%{transform:scale(1);opacity:.8}50%{transform:scale(2.2);opacity:0}100%{transform:scale(1);opacity:0}}
.my-marker{position:relative;width:22px;height:22px}
.my-marker .ring{position:absolute;inset:0;border-radius:50%;animation:pulse 2s ease-out infinite}
.my-marker .dot{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.my-marker.blue .ring{background:rgba(79,142,247,.35)}
.my-marker.blue .dot{background:#4f8ef7}
</style>
</head>
<body>
<div id="search-bar">
  <input id="search-input" type="text" placeholder="헬스장 이름으로 검색" inputmode="search"/>
  <button id="search-btn" onclick="doSearch()">검색</button>
</div>
<div id="map"></div>
<div id="results"></div>
<button id="my-btn" onclick="goMyPos()" title="내 위치로">📍</button>
<div id="bottom-bar">
  <div id="place-label">헬스장을 검색해서 선택하세요</div>
  <button id="confirm-btn" disabled onclick="doConfirm()">이 위치로 등록</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var myLat=${lat}, myLng=${lng};
var selLat=null, selLng=null, selName=null;
var gymMarker=null, myMarker=null, gymCircle=null;

var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],17);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.control.zoom({position:'topright'}).addTo(map);

var gymIcon=L.divIcon({html:'<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">🏋️</div>',iconSize:[32,32],iconAnchor:[16,32],className:''});

function makeMyIcon(){
  return L.divIcon({html:'<div class="my-marker blue"><div class="ring"></div><div class="dot"></div></div>',iconSize:[22,22],iconAnchor:[11,11],className:''});
}

function setGymCircle(lat,lng){
  if(gymCircle)map.removeLayer(gymCircle);
  gymCircle=L.circle([lat,lng],{radius:10,color:'#4f8ef7',weight:2,opacity:.9,fillColor:'#4f8ef7',fillOpacity:.15}).addTo(map);
}

${hasInit ? `
gymMarker=L.marker([${lat},${lng}],{icon:gymIcon}).addTo(map)
  .bindTooltip('등록된 헬스장',{permanent:true,direction:'top',offset:[0,-34]});
setGymCircle(${lat},${lng});
selLat=${lat};selLng=${lng};selName='등록된 헬스장';
document.getElementById('confirm-btn').disabled=false;
document.getElementById('place-label').textContent='현재 등록된 위치 · 검색으로 변경 가능';
` : ''}

// React Native에서 postMessage로 내 위치 수신
var myFirstUpdate=true;
function onMyLocMsg(e){
  try{
    var d=JSON.parse(e.data);
    if(typeof d.myLat!=='number'||typeof d.myLng!=='number')return;
    myLat=d.myLat; myLng=d.myLng;
    if(myMarker) myMarker.setLatLng([myLat,myLng]);
    else{
      myMarker=L.marker([myLat,myLng],{icon:makeMyIcon(),zIndexOffset:1000}).addTo(map);
    }
    if(myFirstUpdate){
      myFirstUpdate=false;
      map.setView([myLat,myLng],17);
    }
  }catch(_){}
}
window.addEventListener('message',onMyLocMsg);
document.addEventListener('message',onMyLocMsg);

function doSearch(){
  var q=document.getElementById('search-input').value.trim();
  if(!q)return;
  var btn=document.getElementById('search-btn');
  btn.textContent='...';btn.disabled=true;
  var c=map.getCenter();
  fetch('/places/search?query='+encodeURIComponent(q)+'&lat='+c.lat+'&lng='+c.lng)
    .then(function(r){return r.json();})
    .then(function(data){btn.textContent='검색';btn.disabled=false;showResults(Array.isArray(data)?data:[]);})
    .catch(function(){btn.textContent='검색';btn.disabled=false;showResults([]);});
}

function showResults(data){
  var el=document.getElementById('results');
  el.innerHTML=data.length
    ? data.map(function(r,i){return '<div class="ri" onclick="pick('+i+')"><div class="rn">'+r.name+'</div><div class="ra">'+r.address+'</div></div>';}).join('')
    : '<div class="ri"><div class="rn" style="color:#636366">검색 결과가 없어요</div></div>';
  el._data=data;
  el.style.display='block';
}

function pick(i){
  var r=document.getElementById('results')._data[i];
  if(gymMarker)map.removeLayer(gymMarker);
  gymMarker=L.marker([r.lat,r.lng],{icon:gymIcon}).addTo(map)
    .bindTooltip(r.name,{permanent:true,direction:'top',offset:[0,-34]});
  setGymCircle(r.lat,r.lng);
  map.setView([r.lat,r.lng],17);
  selLat=r.lat;selLng=r.lng;selName=r.name;
  document.getElementById('confirm-btn').disabled=false;
  document.getElementById('place-label').textContent='📍 '+r.name;
  document.getElementById('results').style.display='none';
  document.getElementById('search-input').value=r.name;
}

function goMyPos(){
  map.setView([myLat,myLng],17);
  if(myMarker)myMarker.setLatLng([myLat,myLng]);
}

function doConfirm(){
  if(!selLat)return;
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({lat:selLat,lng:selLng,name:selName||'내 헬스장'}));
}

document.getElementById('search-input').addEventListener('keydown',function(e){if(e.key==='Enter')doSearch();});
document.getElementById('map').addEventListener('click',function(){document.getElementById('results').style.display='none';});
</script>
</body>
</html>`;
    reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/places/search', async (request, reply) => {
    const { query, lat, lng } = request.query as { query: string; lat: string; lng: string };

    if (!query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', query);
    url.searchParams.set('size', '15');
    if (lat && lng) {
      url.searchParams.set('y', lat);
      url.searchParams.set('x', lng);
      url.searchParams.set('radius', '5000');
    }

    const response = await fetch(url.toString(),
      { headers: { Authorization: 'KakaoAK e60a761729c6b740847a06d43cd87687' } }
    );

    const data = await response.json() as any;

    const GYM_CATEGORIES = ['스포츠', '헬스', '피트니스', '체육', '수영', '요가', '필라테스', '크로스핏', 'pt', '격투', '무술', '권투', '복싱', '태권도', '클라이밍'];

    return (data.documents ?? [])
      .filter((d: any) => {
        const cat = (d.category_name ?? '').toLowerCase();
        return GYM_CATEGORIES.some((kw) => cat.includes(kw));
      })
      .map((d: any) => ({
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
      }));
  });
}

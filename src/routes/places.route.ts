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

  // GET /map — 카카오맵 HTML 페이지 (WebView용, origin 인증 우회)
  app.get('/map', async (request, reply) => {
    const { gymLat, gymLng, gymName } = request.query as {
      gymLat: string; gymLng: string; gymName?: string;
    };
    const name = (gymName ?? '내 헬스장').replace(/['"<>]/g, '');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=ea5e3a3b4821d857665579e59aba0f7f"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body,#map{width:100%;height:100%}
</style>
</head>
<body>
<div id="map"></div>
<script>
var map,myOverlay,circle;
var gymPos=new kakao.maps.LatLng(${parseFloat(gymLat)},${parseFloat(gymLng)});
map=new kakao.maps.Map(document.getElementById('map'),{center:gymPos,level:2});
new kakao.maps.Marker({position:gymPos,map:map});
var lbl='<div style="background:#fff;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25);margin-bottom:4px">${name}</div>';
new kakao.maps.CustomOverlay({position:gymPos,content:lbl,yAnchor:2.6,map:map});
circle=new kakao.maps.Circle({center:gymPos,radius:300,strokeWeight:2,strokeColor:'#4f8ef7',strokeOpacity:.9,fillColor:'#4f8ef7',fillOpacity:.08,map:map});
var dot='<div style="width:18px;height:18px;background:#30d158;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(48,209,88,.35)"></div>';
myOverlay=new kakao.maps.CustomOverlay({content:dot,yAnchor:.5});
function onMsg(e){
  try{
    var d=JSON.parse(e.data);
    var p=new kakao.maps.LatLng(d.lat,d.lng);
    myOverlay.setPosition(p);myOverlay.setMap(map);
    var c=d.ok?'#30d158':'#ff453a';
    circle.setOptions({strokeColor:c,fillColor:c});
    var bounds=new kakao.maps.LatLngBounds();
    bounds.extend(gymPos);bounds.extend(p);
    map.setBounds(bounds,80);
  }catch(_){}
}
window.addEventListener('message',onMsg);
document.addEventListener('message',onMsg);
</script>
</body>
</html>`;
    reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /gym-picker — 헬스장 등록용 지도 HTML 페이지 (Leaflet + 카카오 Places 검색)
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
html,body{width:100%;height:100%;font-family:-apple-system,sans-serif}
#search-bar{position:fixed;top:0;left:0;right:0;z-index:1000;display:flex;gap:6px;padding:10px 12px;background:rgba(10,10,10,.97);border-bottom:1px solid #222}
#search-input{flex:1;background:#1c1c1e;border:1px solid #333;color:#fff;font-size:14px;padding:9px 12px;border-radius:10px;outline:none}
#search-input::placeholder{color:#555}
#search-btn{background:#4f8ef7;color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:14px;font-weight:700;white-space:nowrap}
#map{position:fixed;top:52px;left:0;right:0;bottom:72px}
#results{position:fixed;top:52px;left:0;right:0;z-index:999;background:#111;border-bottom:1px solid #222;max-height:250px;overflow-y:auto;display:none}
.ri{padding:13px 16px;border-bottom:1px solid #1c1c1e;cursor:pointer;-webkit-tap-highlight-color:rgba(255,255,255,.05)}
.rn{color:#fff;font-size:14px;font-weight:600}
.ra{color:#636366;font-size:12px;margin-top:3px}
#bottom-bar{position:fixed;bottom:0;left:0;right:0;background:rgba(10,10,10,.97);padding:10px 16px;border-top:1px solid #222}
#place-label{color:#8e8e93;font-size:12px;text-align:center;margin-bottom:7px;min-height:16px}
#confirm-btn{width:100%;background:#4f8ef7;color:#fff;border:none;padding:14px;border-radius:13px;font-size:15px;font-weight:700}
#confirm-btn:disabled{background:#2a2a2a;color:#3a3a3c}
#my-btn{position:fixed;bottom:86px;right:14px;z-index:1000;width:42px;height:42px;background:#1c1c1e;border:1px solid #333;border-radius:21px;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
</style>
</head>
<body>
<div id="search-bar">
  <input id="search-input" type="text" placeholder="헬스장 이름으로 검색"/>
  <button id="search-btn" onclick="doSearch()">검색</button>
</div>
<div id="map"></div>
<div id="results"></div>
<button id="my-btn" onclick="goMyPos()">📍</button>
<div id="bottom-bar">
  <div id="place-label">헬스장을 검색해서 선택하세요</div>
  <button id="confirm-btn" disabled onclick="doConfirm()">이 위치로 등록</button>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var myLat=${lat}, myLng=${lng};
var selLat=null, selLng=null, selName=null;
var marker=null;

var map=L.map('map',{zoomControl:true}).setView([${lat},${lng}],17);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);

var gymIcon=L.divIcon({html:'<div style="font-size:30px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🏋️</div>',iconSize:[32,32],iconAnchor:[16,32],className:''});

${hasInit ? `
marker=L.marker([${lat},${lng}],{icon:gymIcon}).addTo(map);
selLat=${lat};selLng=${lng};selName='등록된 헬스장';
document.getElementById('confirm-btn').disabled=false;
document.getElementById('place-label').textContent='현재 등록된 위치 · 검색으로 변경 가능';
` : ''}

function doSearch(){
  var q=document.getElementById('search-input').value.trim();
  if(!q)return;
  var btn=document.getElementById('search-btn');
  btn.textContent='...';btn.disabled=true;
  var c=map.getCenter();
  fetch('/places/search?query='+encodeURIComponent(q)+'&lat='+c.lat+'&lng='+c.lng)
    .then(function(r){return r.json();})
    .then(function(data){
      btn.textContent='검색';btn.disabled=false;
      showResults(Array.isArray(data)?data:[]);
    })
    .catch(function(){btn.textContent='검색';btn.disabled=false;showResults([]);});
}

function showResults(data){
  var el=document.getElementById('results');
  if(!data.length){
    el.innerHTML='<div class="ri"><div class="rn" style="color:#636366">검색 결과 없음</div></div>';
  } else {
    el.innerHTML=data.map(function(r,i){
      return '<div class="ri" onclick="pick('+i+')"><div class="rn">'+r.name+'</div><div class="ra">'+r.address+'</div></div>';
    }).join('');
  }
  el._data=data;
  el.style.display='block';
}

function pick(i){
  var r=document.getElementById('results')._data[i];
  if(marker)map.removeLayer(marker);
  marker=L.marker([r.lat,r.lng],{icon:gymIcon}).addTo(map);
  map.setView([r.lat,r.lng],17);
  selLat=r.lat;selLng=r.lng;selName=r.name;
  document.getElementById('confirm-btn').disabled=false;
  document.getElementById('place-label').textContent='📍 '+r.name+' · '+r.address;
  document.getElementById('results').style.display='none';
  document.getElementById('search-input').value=r.name;
}

function goMyPos(){map.setView([myLat,myLng],17);}

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

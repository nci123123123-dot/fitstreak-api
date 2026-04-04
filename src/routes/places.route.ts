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
map=new kakao.maps.Map(document.getElementById('map'),{center:gymPos,level:3});
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

    return (data.documents ?? [])
      .map((d: any) => ({
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
      }));
  });
}

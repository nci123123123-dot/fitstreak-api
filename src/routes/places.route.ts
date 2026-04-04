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

  app.get('/places/search', async (request, reply) => {
    const { query, lat, lng } = request.query as { query: string; lat: string; lng: string };

    if (!query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.searchParams.set('query', query);
    url.searchParams.set('size', '8');
    if (lat && lng) {
      url.searchParams.set('y', lat);
      url.searchParams.set('x', lng);
      url.searchParams.set('radius', '5000');
    }

    const response = await fetch(url.toString(),
      { headers: { Authorization: 'KakaoAK e60a761729c6b740847a06d43cd87687' } }
    );

    const data = await response.json() as any;

    const GYM_KEYWORDS = ['헬스', '피트니스', '스포츠시설', '스포츠클럽', 'gym', 'fitness', 'pt센터', '크로스핏', '필라테스'];

    return (data.documents ?? [])
      .filter((d: any) => {
        const cat = (d.category_name ?? '').toLowerCase();
        return GYM_KEYWORDS.some((kw) => cat.includes(kw));
      })
      .map((d: any) => ({
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
      }));
  });
}

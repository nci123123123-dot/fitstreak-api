import { FastifyInstance } from 'fastify';

export async function placesRoutes(app: FastifyInstance) {
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

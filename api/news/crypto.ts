export interface CryptoNewsArticle {
  id: string;
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  source: string;
  categories: string;
  publishedOn: number;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const lang = String(req.query?.lang || 'ES').toUpperCase() === 'EN' ? 'EN' : 'ES';

    const fetchFeed = async (l: string): Promise<CryptoNewsArticle[]> => {
      const r = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=${l}`, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) return [];
      const json = (await r.json()) as { Data?: Array<Record<string, any>> };
      const list = Array.isArray(json?.Data) ? json.Data : [];
      return list.slice(0, 18).map((item) => ({
        id: String(item.id || Math.random()),
        title: String(item.title || ''),
        body: String(item.body || '').replace(/<[^>]+>/g, '').slice(0, 220),
        url: String(item.url || item.guid || '#'),
        imageUrl: String(item.imageurl || '/banner-trading.jpg'),
        source: String(item.source_info?.name || item.source || 'Crypto News'),
        categories: String(item.categories || 'Crypto'),
        publishedOn: Number(item.published_on || Math.floor(Date.now() / 1000)),
      }));
    };

    let articles = await fetchFeed(lang);
    if (articles.length < 4) {
      const enArticles = await fetchFeed('EN');
      articles = [...articles, ...enArticles].slice(0, 18);
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ articles, updatedAt: Date.now() });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Error cargando noticias en vivo',
      articles: [],
    });
  }
}


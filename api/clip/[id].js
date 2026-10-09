// Vercel Serverless Function.
//
// A plain vercel.json rewrite cannot do this job: Vercel always injects
// x-forwarded-host carrying OUR domain, and Suno's backend validates that
// header against its own allowed hosts and answers 400 Bad Request. Issuing
// the upstream request ourselves is the only way to control what Suno sees.
//
// Only this ~1KB of JSON goes through the function. The audio is downloaded
// straight from cdn1.suno.ai by the browser, which serves
// Access-Control-Allow-Origin: * to any origin.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Suno's Cloudflare filters on User-Agent - a non-browser one (python-urllib)
// gets 403, so send a browser string.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
           'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!UUID.test(id || '')) {
    return res.status(400).json({ error: 'Invalid clip id' });
  }

  let upstream;
  try {
    upstream = await fetch(`https://studio-api-prod.suno.com/api/clip/${id}`, {
      headers: { accept: 'application/json', 'user-agent': UA },
    });
  } catch {
    return res.status(502).json({ error: 'Could not reach the Suno API' });
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: `Suno API ${upstream.status}` });
  }

  const data = await upstream.json();
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ title: data.title, video_url: data.video_url });
}

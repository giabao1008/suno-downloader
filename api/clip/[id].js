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
const SHORT_CODE = /^[A-Za-z0-9]{6,32}$/;

// Suno's Cloudflare filters on User-Agent - a non-browser one (python-urllib)
// gets 403, so send a browser string.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
           'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

// A share link (suno.com/s/XQ5W0B7rVsScQVlP) carries no song id - it 307s to
// /song/<uuid>. Only the redirect reveals the id, and the browser cannot read
// it because suno.com sends no CORS headers, so resolve it here.
async function resolveShortCode(code) {
  const r = await fetch(`https://suno.com/s/${code}`, {
    redirect: 'manual',
    headers: { 'user-agent': UA },
  });
  const match = (r.headers.get('location') || '').match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return match ? match[0] : null;
}

export default async function handler(req, res) {
  let id = req.query.id || '';

  if (!UUID.test(id)) {
    if (!SHORT_CODE.test(id)) {
      return res.status(400).json({ error: 'Invalid clip id' });
    }
    try {
      id = await resolveShortCode(id);
    } catch {
      return res.status(502).json({ error: 'Could not reach Suno to resolve that share link' });
    }
    if (!id) {
      return res.status(404).json({ error: 'That share link does not point to a song' });
    }
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

  // A private song reports video_url as "" and offers only the encrypted
  // media_urls stream, so there is nothing downloadable to hand back.
  if (!data.video_url) {
    return res.status(422).json({
      error: data.is_public === false
        ? `"${data.title}" is private - Suno serves only an encrypted stream for it`
        : `No downloadable audio for "${data.title}"`,
    });
  }

  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ title: data.title, video_url: data.video_url });
}

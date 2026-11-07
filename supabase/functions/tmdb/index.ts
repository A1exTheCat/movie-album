const TMDB_BASE = 'https://api.themoviedb.org/3';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const token = Deno.env.get('TMDB_API_READ_ACCESS_TOKEN');
  if (!token) return new Response('TMDB proxy is not configured', { status: 503, headers: corsHeaders });

  const path = new URL(request.url).searchParams.get('path');
  if (!path) return new Response('Missing TMDB path', { status: 400, headers: corsHeaders });

  let tmdbPath: URL;
  try {
    tmdbPath = new URL(`${TMDB_BASE}${path}`);
  } catch {
    return new Response('Invalid TMDB path', { status: 400, headers: corsHeaders });
  }

  const allowedRoute = tmdbPath.origin === new URL(TMDB_BASE).origin && (
    tmdbPath.pathname === '/3/search/movie' ||
    tmdbPath.pathname === '/3/genre/movie/list' ||
    /^\/3\/movie\/\d+$/.test(tmdbPath.pathname)
  );
  if (!allowedRoute) return new Response('TMDB route is not allowed', { status: 403, headers: corsHeaders });

  try {
    const upstream = await fetch(tmdbPath.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('TMDB is unavailable right now', { status: 502, headers: corsHeaders });
  }
});

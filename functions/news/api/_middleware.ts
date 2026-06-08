// CORS for /news/api/*. Unlike /personal/api, the newspaper is PUBLIC to read,
// so this middleware does NOT require auth — the write endpoint (generate.ts)
// enforces the API key itself.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
}

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  const response = await context.next()
  const corsed = new Response(response.body, response)
  for (const [k, v] of Object.entries(CORS_HEADERS)) corsed.headers.set(k, v)
  return corsed
}

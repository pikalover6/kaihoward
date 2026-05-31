export interface Env {
  API_KEY?: string
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
}

function extractApiKey(request: Request): string | null {
  const xApiKey = request.headers.get('X-API-Key')
  if (xApiKey) return xApiKey

  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)

  return null
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const configuredKey = context.env.API_KEY
  const provided = extractApiKey(context.request)
  const hasCloudflareAccess = Boolean(context.request.headers.get('Cf-Access-Jwt-Assertion'))

  if (!hasCloudflareAccess && (!configuredKey || provided !== configuredKey)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  const response = await context.next()
  const corsed = new Response(response.body, response)
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    corsed.headers.set(k, v)
  }
  return corsed
}

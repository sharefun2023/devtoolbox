// AI Cover Generator API — Cloudflare Pages Function
// Calls CF Workers AI (flux-1-schnell) to generate background images
// ENV VARS: CF_API_TOKEN, CF_ACCOUNT_ID (set via wrangler or CF Dashboard)

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { prompt, width = 1242, height = 1660 } = await request.json();

    const accountId = env.CF_ACCOUNT_ID || '65a42a8607fd2b131ed67b9477add080';
    const apiToken = env.CF_API_TOKEN;

    if (!apiToken) {
      return new Response(JSON.stringify({ error: 'API token not configured' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, width, height }),
      }
    );

    const result = await response.json();

    if (result.success && result.result) {
      const image = result.result.image || result.result;
      return new Response(JSON.stringify({ success: true, image }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Check for NSFW filter
    if (!result.success && result.errors) {
      const errMsg = JSON.stringify(result.errors);
      if (errMsg.includes('NSFW') || errMsg.includes('sensitive')) {
        return new Response(
          JSON.stringify({ success: false, error: 'NSFW_CONTENT', message: 'Prompt triggered content filter. Try different wording.' }),
          { headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: 'API_ERROR', message: errMsg }),
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'UNKNOWN', message: 'Generation failed' }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'EXCEPTION', message: err.message }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}

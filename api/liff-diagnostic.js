const ALLOWED_EVENTS = new Set([
  'LIFF_BOOTSTRAP_START',
  'LIFF_BOOTSTRAP_OK',
  'LIFF_BOOTSTRAP_ERROR',
  'LIFF_INIT_CATCH',
  'LIFF_SEND_ATTEMPT',
  'LIFF_SEND_ERROR'
]);

function cleanString(value, max = 500) {
  if (value == null) return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

function cleanObject(input) {
  const d = input && typeof input === 'object' ? input : {};
  return {
    event: ALLOWED_EVENTS.has(d.event) ? d.event : 'LIFF_DIAGNOSTIC',
    at: cleanString(d.at, 64),
    code: cleanString(d.code, 120),
    message: cleanString(d.message, 500),
    liffId: cleanString(d.liffId, 80),
    host: cleanString(d.host, 200),
    pathname: cleanString(d.pathname, 300),
    queryKeys: Array.isArray(d.queryKeys) ? d.queryKeys.map(v => cleanString(v, 80)).filter(Boolean).slice(0, 20) : [],
    referrerHost: cleanString(d.referrerHost, 200),
    referrerPath: cleanString(d.referrerPath, 300),
    inClient: typeof d.inClient === 'boolean' ? d.inClient : null,
    loggedIn: typeof d.loggedIn === 'boolean' ? d.loggedIn : null,
    contextType: cleanString(d.contextType, 40),
    viewType: cleanString(d.viewType, 40),
    sendMessagesAvailable: typeof d.sendMessagesAvailable === 'boolean' ? d.sendMessagesAvailable : null,
    sdkVersion: cleanString(d.sdkVersion, 80),
    lineVersion: cleanString(d.lineVersion, 80),
    userAgent: cleanString(d.userAgent, 500),
    visibilityState: cleanString(d.visibilityState, 40),
    online: typeof d.online === 'boolean' ? d.online : null,
    screen: cleanString(d.screen, 80),
    stage: cleanString(d.stage, 80)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 32 * 1024) {
    return res.status(413).json({ ok: false, error: 'PAYLOAD_TOO_LARGE' });
  }

  const record = cleanObject(req.body);
  const requestMeta = {
    ipCountry: cleanString(req.headers['x-vercel-ip-country'], 8),
    requestId: cleanString(req.headers['x-vercel-id'], 160)
  };

  // This is intentionally one structured line so it is easy to search in Vercel Runtime Logs.
  console.log(record.event, JSON.stringify({ ...record, ...requestMeta }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}

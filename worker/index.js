const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_COOKIE = 'ls_support_session';
const MESSAGE_LIMIT = 600;
const IMAGE_LIMIT_BYTES = 4 * 1024 * 1024;
const FILE_LIMIT_BYTES = 10 * 1024 * 1024;
const VISITOR_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const encoder = new TextEncoder();

let cachedSecret = '';
let cachedHmacKey;

class HttpError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class DiscordError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const getHmacKey = (secret) => {
  if (!cachedHmacKey || cachedSecret !== secret) {
    cachedSecret = secret;
    cachedHmacKey = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
  return cachedHmacKey;
};

const digest = async (env, ...parts) => {
  const key = await getHmacKey(env.SECURITY_HASH_SECRET);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join('\u001f')));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const randomCode = (length = 4) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
};

const makeTicketId = () => `LS-${Date.now().toString(36).slice(-4)}-${randomCode(4)}`.toUpperCase();

const browserFromUserAgent = (userAgent) => {
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/OPR\//i.test(userAgent)) return 'Opera';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return 'Safari';
  return 'Browser';
};

const makeVisitorId = (browser) => `${browser.toUpperCase().slice(0, 8)}-${randomCode(4)}`;

const parseCookies = (header = '') => Object.fromEntries(
  String(header || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [part, ''];
    return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
  })
);

const getAllowedOrigin = (request, env) => {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const sameOrigin = new URL(request.url).origin;
  const configured = String(env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const matchesConfiguredOrigin = configured.some((allowedOrigin) => {
    if (allowedOrigin === origin) return true;
    if (allowedOrigin === 'https://*.github.io') return /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin);
    return false;
  });
  if (origin !== sameOrigin && !matchesConfiguredOrigin) throw new HttpError(403, 'Request origin rejected.');
  return origin;
};

const createRequestContext = async (request, env) => {
  if (!env.SECURITY_HASH_SECRET || env.SECURITY_HASH_SECRET.length < 32) {
    throw new HttpError(503, 'Support is not configured.');
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  let session = cookies[SESSION_COOKIE];
  let setCookie = null;
  if (!session || session.length < 32) {
    session = randomToken();
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    setCookie = `${SESSION_COOKIE}=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/api${secure}`;
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return {
    env,
    request,
    setCookie,
    browser: browserFromUserAgent(userAgent),
    ipHash: await digest(env, 'ip', ip),
    userAgentHash: await digest(env, 'ua', userAgent),
    sessionHash: await digest(env, 'session', session)
  };
};

const jsonResponse = (context, data, status = 200) => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  let origin = null;
  try { origin = getAllowedOrigin(context.request, context.env); } catch {}
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('vary', 'Origin');
  }
  if (context.setCookie) headers.append('set-cookie', context.setCookie);
  return new Response(JSON.stringify(data), { status, headers });
};

const optionsResponse = (context) => {
  const origin = getAllowedOrigin(context.request, context.env);
  const headers = new Headers({
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, X-Device-ID, X-Visitor-ID, X-Visitor-Token, X-Ticket-ID, X-Ticket-Token',
    'access-control-max-age': '86400'
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('vary', 'Origin');
  }
  return new Response(null, { status: 204, headers });
};

const audit = async (context, type, details = {}) => {
  await context.env.DB.prepare(
    'INSERT INTO security_events (type, created_at, ip_hash, user_agent_hash, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(type, new Date().toISOString(), context.ipHash, context.userAgentHash, JSON.stringify(details)).run();
};

const consumeRateLimit = async (env, key, limit, windowSeconds) => {
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare('SELECT window_started, count FROM rate_limits WHERE key = ?').bind(key).first();
  if (!existing || existing.window_started <= now - windowSeconds) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_started, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_started = excluded.window_started, count = 1'
    ).bind(key, now).run();
    return true;
  }
  const result = await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ? RETURNING count').bind(key).first();
  return Number(result?.count || limit + 1) <= limit;
};

const enforceRateLimits = async (context, deviceHash, messageRequest) => {
  const generalAllowed = await consumeRateLimit(context.env, `general:${context.ipHash}`, 120, 600);
  if (!generalAllowed) {
    await audit(context, 'general_rate_limit');
    throw new HttpError(429, 'Too many requests. Wait a few minutes and try again.');
  }
  if (!messageRequest) return;
  const [ipAllowed, deviceAllowed] = await Promise.all([
    consumeRateLimit(context.env, `message-ip:${context.ipHash}`, 12, 600),
    consumeRateLimit(context.env, `message-device:${deviceHash}`, 12, 600)
  ]);
  if (!ipAllowed || !deviceAllowed) {
    await audit(context, 'message_rate_limit', { deviceHash });
    throw new HttpError(429, 'Too many messages. Wait a few minutes and try again.');
  }
};

const validateDeviceId = (value) => {
  const deviceId = String(value || '').trim();
  if (deviceId.length < 16 || deviceId.length > 128) throw new HttpError(400, 'Invalid support session.');
  return deviceId;
};

const publicVisitor = (session) => ({
  id: session.id,
  browser: session.browser,
  pingDisabled: Boolean(session.ping_disabled),
  expiresAt: session.expires_at
});

const activeRestriction = async (env, identity) => env.DB.prepare(
  `SELECT * FROM support_restrictions
   WHERE (
     (kind = 'ban' AND (device_hash = ? OR (ip_hash = ? AND user_agent_hash = ?)))
     OR (kind = 'timeout' AND visitor_id = ? AND expires_at > ?)
   )
   ORDER BY CASE kind WHEN 'ban' THEN 0 ELSE 1 END, created_at DESC
   LIMIT 1`
).bind(
  identity.device_hash,
  identity.ip_hash,
  identity.user_agent_hash,
  identity.id || '',
  new Date().toISOString()
).first();

const enforceRestriction = async (env, identity, action = 'write') => {
  const restriction = await activeRestriction(env, identity);
  if (!restriction) return;
  if (restriction.kind === 'ban') throw new HttpError(403, 'Support access has been permanently blocked.');
  if (action === 'write' || action === 'create') {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(restriction.expires_at) - Date.now()) / 1000));
    throw new HttpError(429, 'Support access is temporarily paused.', { retryAfter, expiresAt: restriction.expires_at });
  }
};

const createVisitorSession = async (context, deviceId) => {
  const now = new Date();
  const nowIso = now.toISOString();
  const deviceHash = await digest(context.env, 'device', deviceId);
  const suppliedId = String(context.request.headers.get('x-visitor-id') || '').toUpperCase();
  const suppliedToken = context.request.headers.get('x-visitor-token') || '';

  if (suppliedId && suppliedToken) {
    const session = await context.env.DB.prepare('SELECT * FROM visitor_sessions WHERE id = ?').bind(suppliedId).first();
    const tokenMatches = session && await digest(context.env, 'visitor-token', suppliedToken) === session.token_hash;
    if (tokenMatches && session.expires_at > nowIso) {
      if (session.device_hash !== deviceHash || session.ip_hash !== context.ipHash || session.user_agent_hash !== context.userAgentHash) {
        const retryAfter = Math.max(1, Math.ceil((Date.parse(session.expires_at) - Date.now()) / 1000));
        await audit(context, 'visitor_fingerprint_mismatch', { visitorId: session.id, retryAfter });
        throw new HttpError(429, 'This visitor ID is locked because the device or network changed.', { retryAfter, expiresAt: session.expires_at });
      }
      await context.env.DB.prepare('UPDATE visitor_sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso, session.id).run();
      return { visitor: publicVisitor(session) };
    }
  }

  const active = await context.env.DB.prepare(
    'SELECT * FROM visitor_sessions WHERE device_hash = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
  ).bind(deviceHash, nowIso).first();
  if (active) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(active.expires_at) - Date.now()) / 1000));
    await audit(context, 'visitor_credentials_missing', { visitorId: active.id, retryAfter });
    throw new HttpError(429, 'This device already has a visitor ID. Wait for it to expire before starting another session.', {
      retryAfter,
      expiresAt: active.expires_at
    });
  }

  await enforceRestriction(context.env, {
    id: '',
    device_hash: deviceHash,
    ip_hash: context.ipHash,
    user_agent_hash: context.userAgentHash
  }, 'create');

  const visitorId = makeVisitorId(context.browser);
  const visitorToken = randomToken();
  const expiresAt = new Date(now.getTime() + VISITOR_LIFETIME_MS).toISOString();
  await context.env.DB.prepare(
    'INSERT INTO visitor_sessions (id, token_hash, device_hash, session_hash, ip_hash, user_agent_hash, browser, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    visitorId,
    await digest(context.env, 'visitor-token', visitorToken),
    deviceHash,
    context.sessionHash,
    context.ipHash,
    context.userAgentHash,
    context.browser,
    nowIso,
    expiresAt,
    nowIso
  ).run();
  await audit(context, 'visitor_session_created', { visitorId, deviceHash });
  return { visitor: { id: visitorId, browser: context.browser, expiresAt }, visitorToken };
};

const authenticateVisitor = async (context, deviceId) => {
  const visitorId = String(context.request.headers.get('x-visitor-id') || '').toUpperCase();
  const visitorToken = context.request.headers.get('x-visitor-token') || '';
  const session = visitorId ? await context.env.DB.prepare('SELECT * FROM visitor_sessions WHERE id = ?').bind(visitorId).first() : null;
  const validToken = session && visitorToken && await digest(context.env, 'visitor-token', visitorToken) === session.token_hash;
  if (!validToken || session.expires_at <= new Date().toISOString()) throw new HttpError(401, 'Your visitor ID expired. Refresh the page for a new one.');

  const deviceHash = await digest(context.env, 'device', deviceId);
  if (session.device_hash !== deviceHash || session.ip_hash !== context.ipHash || session.user_agent_hash !== context.userAgentHash) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(session.expires_at) - Date.now()) / 1000));
    await audit(context, 'visitor_fingerprint_mismatch', { visitorId, retryAfter });
    throw new HttpError(429, 'This visitor ID is locked because the device or network changed.', { retryAfter, expiresAt: session.expires_at });
  }
  await context.env.DB.prepare('UPDATE visitor_sessions SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), visitorId).run();
  return { session, deviceHash };
};

const discordRequest = async (env, path, options = {}) => {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_TICKET_CHANNEL_ID) throw new HttpError(503, 'Discord support is not configured.');
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bot ${env.DISCORD_BOT_TOKEN}`);
  headers.set('user-agent', 'DiscordBot (https://liquid-star.liquidstarvoxiom.workers.dev, 1.0)');
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(`${env.DISCORD_API_URL || DISCORD_API}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const responseText = await response.text();
  let data = {};
  try { data = responseText ? JSON.parse(responseText) : {}; } catch {}
  if (!response.ok) {
    const message = data.message || responseText.slice(0, 300) || 'Discord request failed.';
    throw new DiscordError(response.status, `${path}: ${message}`, data.code);
  }
  return data;
};

const ticketIntro = (visitor) => [
  `# ${visitor.id}`,
  `**${visitor.browser} support ticket**`,
  '',
  'Reply normally to talk to the website visitor.',
  'Type `ls.help` for commands.'
].join('\n');

const forumTagId = (channel, name) => (channel.available_tags || [])
  .find((tag) => String(tag.name || '').toLowerCase() === name.toLowerCase())?.id;

const updateForumTags = async (env, threadOrId, addNames = [], removeNames = []) => {
  const thread = typeof threadOrId === 'string'
    ? await discordRequest(env, `/channels/${threadOrId}`)
    : threadOrId;
  if (!thread?.parent_id) return;
  const parent = await discordRequest(env, `/channels/${thread.parent_id}`);
  if (parent.type !== 15 && parent.type !== 16) return;
  const tags = new Set(thread.applied_tags || []);
  removeNames.forEach((name) => {
    const id = forumTagId(parent, name);
    if (id) tags.delete(id);
  });
  addNames.forEach((name) => {
    const id = forumTagId(parent, name);
    if (id) tags.add(id);
  });
  const nextTags = [...tags].slice(0, 5);
  const currentTags = [...(thread.applied_tags || [])];
  if (nextTags.length === currentTags.length && nextTags.every((id) => currentTags.includes(id))) return;
  await discordRequest(env, `/channels/${thread.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ applied_tags: nextTags })
  });
};

const createDiscordThread = async (env, ticketId, visitor) => {
  const channel = await discordRequest(env, `/channels/${env.DISCORD_TICKET_CHANNEL_ID}`);
  const name = `${visitor.browser.toLowerCase()}-${visitor.id.toLowerCase()}`.slice(0, 100);
  const common = { name, auto_archive_duration: 1440 };
  if (channel.type === 15 || channel.type === 16) {
    const unresolvedTag = forumTagId(channel, 'unresolved');
    const pinglessTag = visitor.ping_disabled ? forumTagId(channel, 'pingless') : null;
    const initialTags = [unresolvedTag, pinglessTag].filter(Boolean);
    const thread = await discordRequest(env, `/channels/${channel.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({
        ...common,
        ...(initialTags.length ? { applied_tags: initialTags } : {}),
        message: { content: ticketIntro(visitor), allowed_mentions: { parse: [] } }
      })
    });
    return thread.id;
  }
  if (channel.type === 0 || channel.type === 5) {
    const thread = await discordRequest(env, `/channels/${channel.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({ ...common, type: 11 })
    });
    await discordRequest(env, `/channels/${thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: ticketIntro(visitor), allowed_mentions: { parse: [] } })
    });
    return thread.id;
  }
  throw new HttpError(503, 'Discord ticket destination must be a Forum or text channel.');
};

const decodeAttachment = (attachment) => {
  if (!attachment) return null;
  const type = String(attachment.type || 'application/octet-stream').toLowerCase();
  const encoded = String(attachment.data || '').replace(/^data:[^;]+;base64,/, '');
  if (!encoded) throw new HttpError(400, 'The selected file could not be read.');
  let bytes;
  try {
    const binary = atob(encoded);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'The selected file could not be read.');
  }
  if (bytes.byteLength > FILE_LIMIT_BYTES) throw new HttpError(413, 'Files must be smaller than 10 MB.');
  const originalName = String(attachment.name || 'upload').replace(/[^a-z0-9._-]/gi, '-').slice(0, 80) || 'upload';
  return {
    blob: new Blob([bytes], { type }),
    name: originalName,
    type,
    size: bytes.byteLength,
    isImage: ALLOWED_IMAGE_TYPES.has(type)
  };
};

const sendDiscordMessage = async (env, threadId, message, attachment) => {
  let body;
  if (attachment) {
    body = new FormData();
    body.set('payload_json', JSON.stringify({ content: message || '', allowed_mentions: { parse: [] } }));
    body.set('files[0]', attachment.blob, attachment.name);
  } else {
    body = JSON.stringify({ content: message, allowed_mentions: { parse: [] } });
  }
  const sent = await discordRequest(env, `/channels/${threadId}/messages`, { method: 'POST', body });
  const uploaded = sent.attachments?.[0];
  return {
    attachmentUrl: uploaded?.url || null,
    attachmentName: uploaded?.filename || attachment?.name || null,
    attachmentType: uploaded?.content_type || attachment?.type || null
  };
};

const insertMessage = (env, ticketId, message) => env.DB.prepare(
  `INSERT INTO messages
   (id, ticket_id, author, content, image_url, attachment_name, attachment_type, staff_name, staff_role, staff_avatar_url, staff_role_color, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     attachment_name = COALESCE(excluded.attachment_name, messages.attachment_name),
     attachment_type = COALESCE(excluded.attachment_type, messages.attachment_type),
     staff_name = COALESCE(excluded.staff_name, messages.staff_name),
     staff_role = COALESCE(excluded.staff_role, messages.staff_role),
     staff_avatar_url = COALESCE(excluded.staff_avatar_url, messages.staff_avatar_url),
     staff_role_color = COALESCE(excluded.staff_role_color, messages.staff_role_color)`
).bind(
  message.id,
  ticketId,
  message.author,
  message.content || '',
  message.attachmentUrl || message.imageUrl || null,
  message.attachmentName || null,
  message.attachmentType || null,
  message.staffName || null,
  message.staffRole || null,
  message.staffAvatarUrl || null,
  message.staffRoleColor || null,
  message.createdAt
).run();

const closeTicket = async (env, ticketId, reason) => {
  const closedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    "UPDATE tickets SET status = 'closed', close_reason = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'"
  ).bind(reason, closedAt, closedAt, ticketId).run();
  if (result.meta.changes) {
    await insertMessage(env, ticketId, {
      id: `system-closed-${closedAt}`,
      author: 'system',
      content: 'This ticket was closed by the support team.',
      createdAt: closedAt
    });
  }
};

const getTicket = (env, ticketId) => env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(ticketId).first();

const publicTicket = async (env, ticketId) => {
  const ticket = await getTicket(env, ticketId);
  if (!ticket) return null;
  const result = await env.DB.prepare(
    `SELECT id, author, content, image_url AS attachmentUrl, attachment_name AS attachmentName,
            attachment_type AS attachmentType, staff_name AS staffName, staff_role AS staffRole,
            staff_avatar_url AS staffAvatarUrl, staff_role_color AS staffRoleColor, created_at AS createdAt
     FROM messages WHERE ticket_id = ? ORDER BY created_at, id`
  ).bind(ticketId).all();
  return {
    id: ticket.id,
    status: ticket.status,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    closedAt: ticket.closed_at || null,
    allowFiles: Boolean(ticket.allow_files),
    pingDisabled: Boolean(ticket.ping_disabled),
    messages: result.results || []
  };
};

const authenticateTicket = async (context, ticketId, deviceId, visitor) => {
  const ticket = await getTicket(context.env, ticketId);
  const accessToken = context.request.headers.get('x-ticket-token') || '';
  if (!ticket || !accessToken || await digest(context.env, 'ticket-token', accessToken) !== ticket.token_hash) {
    await audit(context, 'ticket_auth_failed', { ticketId });
    return null;
  }
  const deviceHash = await digest(context.env, 'device', deviceId);
  if (deviceHash !== ticket.device_hash || (ticket.visitor_id && ticket.visitor_id !== visitor.id)) {
    await audit(context, 'ticket_identity_mismatch', { ticketId, visitorId: visitor.id });
    return null;
  }
  return ticket;
};

const lockDiscordThread = async (env, threadId) => {
  await discordRequest(env, `/channels/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify({ locked: true, archived: true })
  }).catch(() => null);
};

const commandWasProcessed = async (env, messageId) => Boolean(
  await env.DB.prepare('SELECT message_id FROM processed_discord_messages WHERE message_id = ?').bind(messageId).first()
);

const markCommandProcessed = (env, messageId, ticketId, command) => env.DB.prepare(
  'INSERT OR IGNORE INTO processed_discord_messages (message_id, ticket_id, command, created_at) VALUES (?, ?, ?, ?)'
).bind(messageId, ticketId, command, new Date().toISOString()).run();

const sendBotText = (env, threadId, content, users = []) => discordRequest(env, `/channels/${threadId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    content,
    allowed_mentions: { parse: [], users }
  })
});

const sendHelpMessage = (env, threadId) => sendBotText(env, threadId, [
  '# Ticket help',
  'Reply normally to message the visitor.',
  '`ls.close` — close and archive this ticket.',
  '`ls.timeout 30` — block support access for 30 minutes.',
  '`ls.ban` / `ls.unban` — permanently block or restore support access.',
  '`ls.allowfile` — allow attachments up to 10 MB.',
  '`ls.blockfile` — disable file attachments again.',
  '`ls.pingless` — disable the visitor’s Call admins button.',
  '`ls.help` — show this guide.'
].join('\n'));

const removeBan = (env, ticket) => env.DB.prepare(
  "DELETE FROM support_restrictions WHERE kind = 'ban' AND (device_hash = ? OR (ip_hash = ? AND user_agent_hash = ?))"
).bind(ticket.device_hash, ticket.ip_hash, ticket.user_agent_hash).run();

const addRestriction = async (env, ticket, kind, expiresAt = null) => {
  if (kind === 'ban') await removeBan(env, ticket);
  else await env.DB.prepare("DELETE FROM support_restrictions WHERE kind = 'timeout' AND visitor_id = ?").bind(ticket.visitor_id || '').run();
  await env.DB.prepare(
    'INSERT INTO support_restrictions (visitor_id, device_hash, ip_hash, user_agent_hash, kind, expires_at, created_at, created_by_ticket) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    ticket.visitor_id || '', ticket.device_hash, ticket.ip_hash, ticket.user_agent_hash,
    kind, expiresAt, new Date().toISOString(), ticket.id
  ).run();
};

const addTicketNotice = (env, ticketId, content) => insertMessage(env, ticketId, {
  id: `system-command-${crypto.randomUUID()}`,
  author: 'system',
  content,
  createdAt: new Date().toISOString()
});

const processStaffCommand = async (env, ticket, command) => {
  if (command === 'ls.help') {
    await sendHelpMessage(env, ticket.thread_id);
    return false;
  }
  if (command === 'ls.close') return true;
  if (command === 'ls.ban') {
    await addRestriction(env, ticket, 'ban');
    await addTicketNotice(env, ticket.id, 'Support access was blocked by staff.');
    await updateForumTags(env, ticket.thread_id, ['banned', 'unresolved'], ['archived']);
    await sendBotText(env, ticket.thread_id, 'Visitor banned from the website ticket tool. Use `ls.unban` to reverse this.');
    return false;
  }
  if (command === 'ls.unban') {
    await removeBan(env, ticket);
    await addTicketNotice(env, ticket.id, 'Support access was restored by staff.');
    await updateForumTags(env, ticket.thread_id, ['unresolved'], ['banned', 'archived']);
    await sendBotText(env, ticket.thread_id, 'Visitor support access restored.');
    return false;
  }
  if (command === 'ls.allowfile') {
    await env.DB.prepare('UPDATE tickets SET allow_files = 1 WHERE id = ?').bind(ticket.id).run();
    await addTicketNotice(env, ticket.id, 'Staff enabled file uploads up to 10 MB for this ticket.');
    await sendBotText(env, ticket.thread_id, 'File uploads up to 10 MB are now enabled for this ticket.');
    return false;
  }
  if (command === 'ls.blockfile') {
    await env.DB.prepare('UPDATE tickets SET allow_files = 0 WHERE id = ?').bind(ticket.id).run();
    await addTicketNotice(env, ticket.id, 'Staff disabled file uploads for this ticket.');
    await sendBotText(env, ticket.thread_id, 'File uploads are disabled for this ticket.');
    return false;
  }
  if (command === 'ls.pingless') {
    await env.DB.batch([
      env.DB.prepare('UPDATE tickets SET ping_disabled = 1 WHERE id = ?').bind(ticket.id),
      env.DB.prepare('UPDATE visitor_sessions SET ping_disabled = 1 WHERE id = ?').bind(ticket.visitor_id || '')
    ]);
    await addTicketNotice(env, ticket.id, 'The Call admins button was disabled for this ticket.');
    await updateForumTags(env, ticket.thread_id, ['pingless', 'unresolved'], ['archived']);
    await sendBotText(env, ticket.thread_id, 'Admin calls disabled for this ticket.');
    return false;
  }
  const timeoutMatch = command.match(/^ls\.timeout\s+(\d{1,5})$/);
  if (timeoutMatch) {
    const minutes = Number(timeoutMatch[1]);
    if (minutes < 1 || minutes > 10080) {
      await sendBotText(env, ticket.thread_id, 'Timeout must be between 1 and 10080 minutes.');
      return false;
    }
    const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();
    await addRestriction(env, ticket, 'timeout', expiresAt);
    await addTicketNotice(env, ticket.id, `Support access was paused for ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    await sendBotText(env, ticket.thread_id, `Visitor timed out for ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    return false;
  }
  return null;
};

const staffProfile = (discordMessage, guildId, roles) => {
  const roleIds = new Set(discordMessage.member?.roles || []);
  const role = roles.filter((candidate) => roleIds.has(candidate.id) && candidate.name !== '@everyone')
    .sort((left, right) => right.position - left.position)[0];
  const author = discordMessage.author || {};
  const guildAvatar = discordMessage.member?.avatar;
  const avatarHash = guildAvatar || author.avatar;
  const avatarBase = guildAvatar
    ? `https://cdn.discordapp.com/guilds/${guildId}/users/${author.id}/avatars`
    : `https://cdn.discordapp.com/avatars/${author.id}`;
  const extension = String(avatarHash || '').startsWith('a_') ? 'gif' : 'png';
  return {
    staffName: discordMessage.member?.nick || author.global_name || author.username || 'Staff',
    staffRole: role?.name || 'Staff',
    staffAvatarUrl: avatarHash ? `${avatarBase}/${avatarHash}.${extension}?size=128` : null,
    staffRoleColor: role?.color ? `#${Number(role.color).toString(16).padStart(6, '0')}` : '#d8b56d'
  };
};

const syncDiscordTicket = async (env, ticket) => {
  if (ticket.status !== 'open') return ticket;
  let thread;
  try {
    thread = await discordRequest(env, `/channels/${ticket.thread_id}`);
  } catch (error) {
    if (error instanceof DiscordError && error.status === 404) {
      await closeTicket(env, ticket.id, 'thread_deleted');
      return getTicket(env, ticket.id);
    }
    throw error;
  }
  if (thread.thread_metadata?.locked) {
    await closeTicket(env, ticket.id, 'thread_locked');
    return getTicket(env, ticket.id);
  }

  await updateForumTags(env, thread, ticket.ping_disabled ? ['unresolved', 'pingless'] : ['unresolved'], ['archived']).catch(() => null);

  const discordMessages = await discordRequest(env, `/channels/${ticket.thread_id}/messages?limit=100`);
  const roles = thread.guild_id ? await discordRequest(env, `/guilds/${thread.guild_id}/roles`).catch(() => []) : [];
  const orderedMessages = [...discordMessages].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  let closeRequested = false;
  for (const discordMessage of orderedMessages) {
    if (discordMessage.author?.bot) continue;
    const command = String(discordMessage.content || '').trim().toLowerCase();
    if (command.startsWith('ls.')) {
      const processed = await commandWasProcessed(env, discordMessage.id);
      if (processed) {
        if (command === 'ls.close') closeRequested = true;
        continue;
      }
      const shouldClose = await processStaffCommand(env, ticket, command);
      if (shouldClose !== null) {
        await markCommandProcessed(env, discordMessage.id, ticket.id, command);
        closeRequested ||= shouldClose;
        continue;
      }
    }
    if (command.startsWith('!') && await commandWasProcessed(env, discordMessage.id)) continue;
    const content = String(discordMessage.content || '').trim().slice(0, 2000);
    const attachments = discordMessage.attachments || [];
    if (!content && !attachments.length) continue;
    const attachment = attachments[0];
    await insertMessage(env, ticket.id, {
      id: `discord-${discordMessage.id}`,
      author: 'staff',
      content,
      attachmentUrl: attachment?.url || null,
      attachmentName: attachment?.filename || null,
      attachmentType: attachment?.content_type || null,
      ...staffProfile(discordMessage, thread.guild_id, roles),
      createdAt: discordMessage.timestamp
    });
  }
  if (closeRequested) {
    await closeTicket(env, ticket.id, 'staff_command');
    await updateForumTags(env, ticket.thread_id, ['archived'], ['unresolved']).catch(() => null);
    await lockDiscordThread(env, ticket.thread_id);
  }
  return getTicket(env, ticket.id);
};

const ensureThreadOpen = async (env, ticket) => {
  const thread = await discordRequest(env, `/channels/${ticket.thread_id}`);
  if (thread.thread_metadata?.locked) {
    await closeTicket(env, ticket.id, 'thread_locked');
    throw new HttpError(409, 'This ticket is closed.');
  }
  if (thread.thread_metadata?.archived) {
    await discordRequest(env, `/channels/${ticket.thread_id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) });
  }
};

const validateMessageBody = async (request) => {
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid request.'); }
  const message = String(body.message || '').trim();
  const deviceId = validateDeviceId(body.deviceId);
  const company = String(body.company || '');
  const attachment = decodeAttachment(body.attachment || body.image);
  if ((!message && !attachment) || message.length > MESSAGE_LIMIT || company.length > 200) {
    throw new HttpError(400, 'Enter a message or attach a file. Messages can be up to 600 characters.');
  }
  return { message, deviceId, company, attachment };
};

const createTicket = async (context, payload, visitor, deviceHash) => {
  if (payload.attachment && (!payload.attachment.isImage || payload.attachment.size > IMAGE_LIMIT_BYTES)) {
    throw new HttpError(403, 'Open the ticket first, then ask staff to enable file uploads with ls.allowfile.');
  }
  const existing = await context.env.DB.prepare(
    "SELECT id FROM tickets WHERE (device_hash = ? OR (ip_hash = ? AND user_agent_hash = ?)) AND status = 'open' LIMIT 1"
  ).bind(deviceHash, context.ipHash, context.userAgentHash).first();
  if (existing) {
    await audit(context, 'duplicate_open_ticket', { deviceHash, visitorId: visitor.id });
    throw new HttpError(409, 'This visitor already has an active ticket. Restore its saved ticket session.');
  }

  const ticketId = makeTicketId();
  const accessToken = randomToken();
  const threadId = await createDiscordThread(context.env, ticketId, visitor);
  const now = new Date().toISOString();
  let delivered;
  try {
    delivered = await sendDiscordMessage(context.env, threadId, payload.message, payload.attachment);
    await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO tickets (id, thread_id, visitor_id, status, token_hash, device_hash, session_hash, ip_hash, user_agent_hash, allow_files, ping_disabled, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?, ?)"
      ).bind(
        ticketId,
        threadId,
        visitor.id,
        await digest(context.env, 'ticket-token', accessToken),
        deviceHash,
        context.sessionHash,
        context.ipHash,
        context.userAgentHash,
        Number(Boolean(visitor.ping_disabled)),
        now,
        now
      ),
      context.env.DB.prepare(
        "INSERT INTO messages (id, ticket_id, author, content, image_url, attachment_name, attachment_type, created_at) VALUES (?, ?, 'visitor', ?, ?, ?, ?, ?)"
      ).bind(
        `visitor-${crypto.randomUUID()}`, ticketId, payload.message, delivered.attachmentUrl,
        delivered.attachmentName, delivered.attachmentType, now
      ),
      context.env.DB.prepare(
        "INSERT INTO messages (id, ticket_id, author, content, image_url, created_at) VALUES (?, ?, 'system', ?, NULL, ?)"
      ).bind(
        `system-opened-${crypto.randomUUID()}`,
        ticketId,
        'Your ticket reached Discord. Staff will reply as soon as possible. You can leave this page and return later.',
        new Date(Date.now() + 1).toISOString()
      )
    ]);
  } catch (error) {
    await lockDiscordThread(context.env, threadId);
    if (/unique/i.test(error.message)) throw new HttpError(409, 'This visitor already has an active ticket.');
    throw error;
  }
  await audit(context, 'ticket_created', { ticketId, deviceHash, visitorId: visitor.id });
  return { ticket: await publicTicket(context.env, ticketId), accessToken };
};

const appendVisitorMessage = async (context, ticket, payload) => {
  ticket = await syncDiscordTicket(context.env, ticket);
  if (ticket.status !== 'open') throw new HttpError(409, 'This ticket is closed.', { ticket: await publicTicket(context.env, ticket.id) });
  if (payload.attachment && (!payload.attachment.isImage || payload.attachment.size > IMAGE_LIMIT_BYTES) && !ticket.allow_files) {
    throw new HttpError(403, 'Staff must use ls.allowfile before you can send this file.');
  }
  await ensureThreadOpen(context.env, ticket);
  const delivered = await sendDiscordMessage(context.env, ticket.thread_id, payload.message, payload.attachment);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO messages (id, ticket_id, author, content, image_url, attachment_name, attachment_type, created_at) VALUES (?, ?, 'visitor', ?, ?, ?, ?, ?)"
    ).bind(
      `visitor-${crypto.randomUUID()}`, ticket.id, payload.message, delivered.attachmentUrl,
      delivered.attachmentName, delivered.attachmentType, now
    ),
    context.env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(now, ticket.id)
  ]);
  await audit(context, 'ticket_message', { ticketId: ticket.id });
  return { ticket: await publicTicket(context.env, ticket.id) };
};

const resolveAdminIds = async (env, threadId) => {
  const configured = String(env.DISCORD_ADMIN_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (configured.length) return configured.slice(0, 10);
  const thread = await discordRequest(env, `/channels/${threadId}`);
  if (!thread.guild_id) return [];
  const names = String(env.DISCORD_ADMIN_USERNAMES || 'codemeteor,lolua').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const ids = [];
  for (const name of names) {
    const members = await discordRequest(env, `/guilds/${thread.guild_id}/members/search?query=${encodeURIComponent(name)}&limit=10`).catch(() => []);
    const member = members.find((candidate) => [candidate.user?.username, candidate.user?.global_name, candidate.nick]
      .filter(Boolean).some((value) => String(value).toLowerCase() === name));
    if (member?.user?.id) ids.push(member.user.id);
  }
  return [...new Set(ids)];
};

const callAdmins = async (context, ticket, visitor) => {
  if (ticket.ping_disabled) throw new HttpError(403, 'Admin calls were disabled for this ticket.');
  const adminIds = await resolveAdminIds(context.env, ticket.thread_id);
  if (!adminIds.length) throw new HttpError(503, 'Admin mentions are not configured. Please use Discord directly.');
  const allowed = await consumeRateLimit(context.env, `admin-ping:${visitor.id}`, 1, 3600);
  if (!allowed) throw new HttpError(429, 'Admins can only be called once per hour.', { retryAfter: 3600 });
  await ensureThreadOpen(context.env, ticket);
  await sendBotText(
    context.env,
    ticket.thread_id,
    `${adminIds.map((id) => `<@${id}>`).join(' ')} — ${visitor.id} requested an admin.`,
    adminIds
  );
  await addTicketNotice(context.env, ticket.id, 'Admins were called. Please allow them time to respond.');
  await audit(context, 'admins_called', { ticketId: ticket.id, visitorId: visitor.id });
  return { ticket: await publicTicket(context.env, ticket.id), retryAfter: 3600 };
};

const syncOpenTickets = async (env) => {
  const result = await env.DB.prepare("SELECT * FROM tickets WHERE status = 'open' ORDER BY updated_at LIMIT 100").all();
  for (const ticket of result.results || []) {
    await syncDiscordTicket(env, ticket).catch((error) => console.error('Scheduled ticket sync failed', ticket.id, error?.message || error));
  }
};

const cleanup = async (env) => {
  const closedDays = Number(env.CLOSED_TICKET_RETENTION_DAYS || 30);
  const auditDays = Number(env.AUDIT_RETENTION_DAYS || 30);
  const closedCutoff = new Date(Date.now() - closedDays * 86400000).toISOString();
  const auditCutoff = new Date(Date.now() - auditDays * 86400000).toISOString();
  const rateCutoff = Math.floor(Date.now() / 1000) - 86400;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tickets WHERE status = 'closed' AND closed_at < ?").bind(closedCutoff),
    env.DB.prepare('DELETE FROM security_events WHERE created_at < ?').bind(auditCutoff),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_started < ?').bind(rateCutoff),
    env.DB.prepare('DELETE FROM visitor_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM processed_discord_messages WHERE created_at < ?').bind(auditCutoff),
    env.DB.prepare("DELETE FROM support_restrictions WHERE kind = 'timeout' AND expires_at < ?").bind(now)
  ]);
};

const discordHealth = async (env) => {
  const result = { authenticated: false, channelAccess: false, adminMentionsReady: false, forumTagsReady: false, bot: null };
  try {
    const bot = await discordRequest(env, '/users/@me');
    result.authenticated = true;
    result.bot = `${bot.username}${bot.discriminator && bot.discriminator !== '0' ? `#${bot.discriminator}` : ''}`;
  } catch { return result; }
  try {
    const channel = await discordRequest(env, `/channels/${env.DISCORD_TICKET_CHANNEL_ID}`);
    result.channelAccess = true;
    result.forumTagsReady = ['archived', 'unresolved', 'pingless', 'banned'].every((name) => Boolean(forumTagId(channel, name)));
    result.adminMentionsReady = (await resolveAdminIds(env, env.DISCORD_TICKET_CHANNEL_ID)).length > 0;
  } catch {}
  return result;
};

const handleApi = async (request, env, executionContext) => {
  const context = await createRequestContext(request, env);
  getAllowedOrigin(request, env);
  if (request.method === 'OPTIONS') return optionsResponse(context);
  executionContext.waitUntil(cleanup(env));
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const discord = await discordHealth(env);
    return jsonResponse(context, { status: 'ok', mode: 'cloudflare-worker', discordReady: discord.authenticated && discord.channelAccess, discord });
  }

  if (request.method === 'POST' && url.pathname === '/api/visitor-session') {
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid request.'); }
    const deviceId = validateDeviceId(body.deviceId);
    await enforceRateLimits(context, await digest(env, 'device', deviceId), false);
    return jsonResponse(context, await createVisitorSession(context, deviceId));
  }

  const ticketMatch = url.pathname.match(/^\/api\/tickets\/([A-Z0-9-]+)$/i);
  if (request.method === 'GET' && ticketMatch) {
    const deviceId = validateDeviceId(request.headers.get('x-device-id'));
    const { session: visitor, deviceHash } = await authenticateVisitor(context, deviceId);
    await enforceRestriction(env, visitor, 'read');
    await enforceRateLimits(context, deviceHash, false);
    let ticket = await authenticateTicket(context, ticketMatch[1].toUpperCase(), deviceId, visitor);
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    ticket = await syncDiscordTicket(env, ticket);
    return jsonResponse(context, { ticket: await publicTicket(env, ticket.id) });
  }

  if (request.method === 'POST' && url.pathname === '/api/tickets/messages') {
    const payload = await validateMessageBody(request);
    const { session: visitor, deviceHash } = await authenticateVisitor(context, payload.deviceId);
    await enforceRestriction(env, visitor, 'write');
    await enforceRateLimits(context, deviceHash, true);
    if (payload.company) {
      await audit(context, 'honeypot');
      return jsonResponse(context, { accepted: true }, 202);
    }
    const requestedTicketId = String(request.headers.get('x-ticket-id') || '').toUpperCase();
    if (!requestedTicketId) return jsonResponse(context, await createTicket(context, payload, visitor, deviceHash), 201);
    const ticket = await authenticateTicket(context, requestedTicketId, payload.deviceId, visitor);
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    return jsonResponse(context, await appendVisitorMessage(context, ticket, payload));
  }

  if (request.method === 'POST' && url.pathname === '/api/tickets/ping') {
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid request.'); }
    const deviceId = validateDeviceId(body.deviceId);
    const { session: visitor, deviceHash } = await authenticateVisitor(context, deviceId);
    await enforceRestriction(env, visitor, 'write');
    await enforceRateLimits(context, deviceHash, false);
    const requestedTicketId = String(request.headers.get('x-ticket-id') || '').toUpperCase();
    if (!requestedTicketId) throw new HttpError(409, 'Open a ticket before calling admins.');
    let ticket = await authenticateTicket(context, requestedTicketId, deviceId, visitor);
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    ticket = await syncDiscordTicket(env, ticket);
    if (ticket.status !== 'open') throw new HttpError(409, 'This ticket is closed.');
    return jsonResponse(context, await callAdmins(context, ticket, visitor));
  }

  throw new HttpError(404, 'Not found.');
};

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, executionContext);
    } catch (error) {
      let context;
      try { context = await createRequestContext(request, env); } catch { context = { request, env, setCookie: null }; }
      if (error instanceof HttpError) return jsonResponse(context, { error: error.message, ...error.data }, error.status);
      if (error instanceof DiscordError) {
        console.error('Discord API error', error.status, error.code, error.message);
        return jsonResponse(context, { error: 'The message did not reach Discord. Please use the Discord button instead.' }, 503);
      }
      console.error('Support Worker error', error?.message || error);
      return jsonResponse(context, { error: 'Support is temporarily unavailable. Please use Discord for now.' }, 500);
    }
  },
  async scheduled(controller, env, executionContext) {
    executionContext.waitUntil(Promise.all([syncOpenTickets(env), cleanup(env)]));
  }
};

// api/checkkey.js
// GET /api/checkkey?key=XXXX-XXXX-XXXX-XXXX&hwid=YYYY
// Called by the Lua script to validate a key

import {
    getKey,
    saveKey,
    signResponse,
    checkRateLimit,
    isHWIDBanned,
} from '../lib/db.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, CORS);
        res.end();
        return;
    }

    // Block browser access
    const ua = req.headers['user-agent'] || '';
    const isBrowser = ua.includes('Mozilla') || ua.includes('Chrome') || ua.includes('Safari');
    if (isBrowser) {
        res.writeHead(403, { 'Content-Type': 'text/plain', ...CORS });
        res.end('Access denied');
        return;
    }

    const ip   = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const key  = (req.query.key  || '').trim().toUpperCase();
    const hwid = (req.query.hwid || '').trim();

    if (!key || !hwid) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify(signResponse({ valid: false, reason: 'missing_params' })));
        return;
    }

    // Rate limit: 10 checks per minute per IP
    const allowed = await checkRateLimit(ip, 'checkkey', 10, 60);
    if (!allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify(signResponse({ valid: false, reason: 'rate_limited' })));
        return;
    }

    try {
        // Check HWID ban
        if (await isHWIDBanned(hwid)) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify(signResponse({ valid: false, reason: 'hwid_banned' })));
            return;
        }

        const data = await getKey(key);

        if (!data) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify(signResponse({ valid: false, reason: 'invalid_key' })));
            return;
        }

        if (data.banned) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify(signResponse({ valid: false, reason: 'key_banned' })));
            return;
        }

        const now = Date.now();

        // First use: bind HWID and set expiry
        if (!data.hwid) {
            const hours   = data.duration !== null ? data.duration : null;
            data.hwid     = hwid;
            data.expires  = hours !== null ? now + hours * 60 * 60 * 1000 : null;
            data.usedAt   = now;
            await saveKey(key, data);
        } else {
            // HWID mismatch
            if (data.hwid !== hwid) {
                res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
                res.end(JSON.stringify(signResponse({ valid: false, reason: 'hwid_mismatch' })));
                return;
            }
        }

        // Check expiry (lifetime keys have null expires)
        if (data.expires && now > data.expires) {
            res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
            res.end(JSON.stringify(signResponse({ valid: false, reason: 'key_expired' })));
            return;
        }

        // All good
        const expiresIn = data.expires ? Math.max(0, Math.floor((data.expires - now) / 1000 / 60)) : null;
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify(signResponse({
            valid:     true,
            type:      data.type,
            expires:   data.expires,
            expiresIn: expiresIn,
            lifetime:  data.expires === null,
        })));

    } catch (err) {
        console.error('Checkkey error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify(signResponse({ valid: false, reason: 'server_error' })));
    }
}

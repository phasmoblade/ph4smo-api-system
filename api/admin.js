// api/admin.js
// Admin API — all actions require ?secret=ADMIN_SECRET
// Actions:
//   GET  /api/admin?action=list&secret=X           — list all keys
//   GET  /api/admin?action=genkey&type=12h&secret=X — generate key
//   GET  /api/admin?action=ban&key=X&secret=X       — ban key
//   GET  /api/admin?action=unban&key=X&secret=X     — unban key
//   GET  /api/admin?action=delete&key=X&secret=X    — delete key
//   GET  /api/admin?action=banhwid&hwid=X&secret=X  — ban HWID
//   GET  /api/admin?action=unbanhwid&hwid=X&secret=X— unban HWID
//   GET  /api/admin?action=stats&secret=X           — stats

import {
    verifyAdminSecret,
    createKey,
    getAllKeys,
    banKey,
    unbanKey,
    deleteKey,
    banHWID,
    unbanHWID,
    getAllBannedHWIDs,
} from '../lib/db.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, CORS);
        res.end();
        return;
    }

    const secret = req.query.secret || '';
    if (!verifyAdminSecret(secret)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
    }

    const action = req.query.action || '';

    try {
        switch (action) {

            case 'list': {
                const keys = await getAllKeys();
                const now  = Date.now();
                const formatted = keys.map(k => ({
                    key:       k.key,
                    type:      k.type,
                    hwid:      k.hwid || 'not used',
                    banned:    k.banned,
                    expires:   k.expires ? new Date(k.expires).toISOString() : 'not activated',
                    expired:   k.expires ? now > k.expires : false,
                    createdAt: new Date(k.createdAt).toISOString(),
                    usedAt:    k.usedAt ? new Date(k.usedAt).toISOString() : 'never',
                }));
                json(res, 200, { count: formatted.length, keys: formatted });
                break;
            }

            case 'genkey': {
                const type = req.query.type === '24h' ? '24h' : '12h';
                const key  = await createKey(type);
                json(res, 200, { success: true, key, type });
                break;
            }

            case 'ban': {
                const key = (req.query.key || '').trim().toUpperCase();
                if (!key) { json(res, 400, { error: 'Missing key' }); return; }
                const ok = await banKey(key);
                json(res, 200, { success: ok, key });
                break;
            }

            case 'unban': {
                const key = (req.query.key || '').trim().toUpperCase();
                if (!key) { json(res, 400, { error: 'Missing key' }); return; }
                const ok = await unbanKey(key);
                json(res, 200, { success: ok, key });
                break;
            }

            case 'delete': {
                const key = (req.query.key || '').trim().toUpperCase();
                if (!key) { json(res, 400, { error: 'Missing key' }); return; }
                await deleteKey(key);
                json(res, 200, { success: true, key });
                break;
            }

            case 'banhwid': {
                const hwid = (req.query.hwid || '').trim();
                if (!hwid) { json(res, 400, { error: 'Missing hwid' }); return; }
                await banHWID(hwid);
                json(res, 200, { success: true, hwid });
                break;
            }

            case 'unbanhwid': {
                const hwid = (req.query.hwid || '').trim();
                if (!hwid) { json(res, 400, { error: 'Missing hwid' }); return; }
                await unbanHWID(hwid);
                json(res, 200, { success: true, hwid });
                break;
            }

            case 'stats': {
                const keys    = await getAllKeys();
                const now     = Date.now();
                const active  = keys.filter(k => !k.banned && k.expires && now < k.expires).length;
                const expired = keys.filter(k => k.expires && now > k.expires).length;
                const unused  = keys.filter(k => !k.hwid).length;
                const banned  = keys.filter(k => k.banned).length;
                const hwids   = await getAllBannedHWIDs();
                json(res, 200, {
                    total:        keys.length,
                    active,
                    expired,
                    unused,
                    banned,
                    bannedHWIDs:  hwids.length,
                });
                break;
            }

            default:
                json(res, 400, { error: 'Unknown action' });
        }
    } catch (err) {
        console.error('Admin error:', err);
        json(res, 500, { error: 'Internal server error' });
    }
}

// api/unblock.js
// GET /api/unblock?secret=YOUR_SECRET - Unblock your IP (for testing)

import { kv } from '@vercel/kv';

const UNBLOCK_SECRET = process.env.UNBLOCK_SECRET || 'ph4smo_dev_secret_123';

export default async function handler(req, res) {
    const secret = req.query.secret;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';

    if (secret !== UNBLOCK_SECRET) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Invalid secret');
        return;
    }

    try {
        // Delete block
        await kv.del(`bypass:blocked:${ip}`);
        
        // Delete pending session
        await kv.del(`pending:${ip}`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unblocked - ph4smo.club</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#000;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px;text-align:center;max-width:400px}
h1{font-size:2rem;margin-bottom:16px;color:#22c55e}p{color:#999;line-height:1.6;margin-bottom:16px}a{color:#fff;text-decoration:none;background:rgba(255,255,255,.1);padding:12px 24px;border-radius:8px;display:inline-block;margin-top:16px}</style></head>
<body><div class="card"><h1>✓ Unblocked</h1>
<p>Your IP has been unblocked.</p>
<p style="font-family:monospace;font-size:0.9rem;color:#666;">${ip}</p>
<a href="/get-key">← Back to key generation</a></div></body></html>`);
    } catch (err) {
        console.error('Unblock error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error unblocking IP');
    }
}

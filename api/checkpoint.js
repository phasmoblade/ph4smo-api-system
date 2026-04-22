// api/checkpoint.js
// Multi-checkpoint system: 12h = 1 checkpoint, 24h = 2 checkpoints
// GET /api/checkpoint?type=12h|24h - Start checkpoint flow
// Uses work.ink for monetization + hCaptcha protection

import {
    createCheckpointToken,
    getCheckpointToken,
    updateCheckpointToken,
    deleteCheckpointToken,
    createKey,
    checkRateLimit,
} from '../lib/db.js';

const WORKINK_LINKS = {
    '12h': 'https://work.ink/2wGI/ph4smoclub-check-1-12h',
    '24h_step1': 'https://work.ink/2wGI/ph4smoclub-check1',
    '24h_step2': 'https://work.ink/2wGI/ph4smoclub-check-2'
};

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

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const type = req.query.type === '24h' ? '24h' : '12h';
    const step = parseInt(req.query.step) || 1;

    // Rate limit
    const allowed = await checkRateLimit(ip, 'checkpoint', 10, 60);
    if (!allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return;
    }

    try {
        const referer = req.headers.referer || req.headers.referrer || '';
        const isFromWorkInk = referer.includes('work.ink');
        const isFromOurSite = referer.includes('ph4smoapi.vercel.app') || referer.includes('localhost');

        // ── Starting new checkpoint flow ──
        if (!isFromWorkInk) {
            // Check if request comes from our get-key page (hCaptcha passed)
            if (!isFromOurSite) {
                res.writeHead(403, { 'Content-Type': 'text/html', ...CORS });
                res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied - ph4smo.club</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#000;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px;text-align:center;max-width:400px}
h1{font-size:2rem;margin-bottom:16px}p{color:#999;line-height:1.6;margin-bottom:16px}a{color:#fff;text-decoration:none}</style></head>
<body><div class="card"><h1>ph4smo.club</h1>
<p>Direct access not allowed.</p>
<p><a href="/get-key">← Go to key generation page</a></p></div></body></html>`);
                return;
            }

            const tokenKey = `pending:${ip}`;
            const existingSession = await getCheckpointToken(tokenKey);

            // If session exists, delete it and create new one (allow retry)
            if (existingSession) {
                await deleteCheckpointToken(tokenKey);
            }

            // New session - create and redirect to work.ink
            const session = {
                step: 1,
                keyType: type,
                ip,
                createdAt: Date.now(),
                completedSteps: []
            };
            await createCheckpointToken(1, type, ip, session);

            // Redirect to work.ink (choose link based on type)
            const workinkUrl = type === '24h' ? WORKINK_LINKS['24h_step1'] : WORKINK_LINKS['12h'];
            res.writeHead(302, { Location: workinkUrl, ...CORS });
            res.end();
            return;
        }

        // ── Returning from work.ink ──
        const tokenKey = `pending:${ip}`;
        const session = await getCheckpointToken(tokenKey);

        if (!session) {
            res.writeHead(302, {
                Location: `/get-key?error=session_expired`,
                ...CORS
            });
            res.end();
            return;
        }

        // Mark current step as completed
        if (!session.completedSteps) session.completedSteps = [];
        if (!session.completedSteps.includes(session.step)) {
            session.completedSteps.push(session.step);
        }

        const totalSteps = session.keyType === '24h' ? 2 : 1;
        const currentStep = session.completedSteps.length;

        // Check if more steps needed
        if (currentStep < totalSteps) {
            // Update session for next step
            session.step = currentStep + 1;
            await updateCheckpointToken(tokenKey, session);

            // Redirect to work.ink for step 2 (only for 24h)
            res.writeHead(302, {
                Location: WORKINK_LINKS['24h_step2'],
                ...CORS
            });
            res.end();
            return;
        }

        // All steps completed - generate key
        await deleteCheckpointToken(tokenKey);
        const key = await createKey(session.keyType);

        res.writeHead(302, {
            Location: `/checkpoint?success=1&key=${key}&type=${session.keyType}`,
            ...CORS
        });
        res.end();

    } catch (err) {
        console.error('Checkpoint error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
}

// api/checkpoint.js
// Multi-checkpoint system: 12h = 1 checkpoint, 24h = 2 checkpoints
// GET /api/checkpoint?type=12h|24h - Start checkpoint flow
// Uses work.ink for monetization

import {
    createCheckpointToken,
    getCheckpointToken,
    updateCheckpointToken,
    deleteCheckpointToken,
    createKey,
    checkRateLimit,
} from '../lib/db.js';

const WORKINK_LINK_ID = process.env.WORKINK_LINK_ID || 'YOUR_LINK_ID';

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

        // ── Starting new checkpoint flow ──
        if (!isFromWorkInk) {
            // Create or get existing checkpoint session
            const tokenKey = `pending:${ip}`;
            let session = await getCheckpointToken(tokenKey);

            if (!session) {
                // New session
                session = {
                    step: 1,
                    keyType: type,
                    ip,
                    createdAt: Date.now(),
                    completedSteps: []
                };
                await createCheckpointToken(1, type, ip, session);
            }

            // Redirect to work.ink
            const workinkUrl = `https://work.ink/${WORKINK_LINK_ID}/ph4smoclub-key`;
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

            // Redirect to next checkpoint
            res.writeHead(302, {
                Location: `/checkpoint/${currentStep + 1}?type=${session.keyType}`,
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

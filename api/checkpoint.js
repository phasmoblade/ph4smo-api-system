// api/checkpoint.js
// GET /api/checkpoint?type=12h - Start checkpoint flow with work.ink
// GET /api/checkpoint?session=xxx - Verify completion and generate key
// Uses work.ink API for monetization

import {
    createCheckpointToken,
    getCheckpointToken,
    deleteCheckpointToken,
    createKey,
    checkRateLimit,
} from '../lib/db.js';

// work.ink Configuration
// WORKINK_LINK_ID: Your work.ink link ID (e.g., "2w6I" from https://work.ink/2w6I/...)
const WORKINK_LINK_ID = process.env.WORKINK_LINK_ID || 'YOUR_LINK_ID';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Get work.ink override token
async function getWorkInkToken(destinationUrl) {
    const response = await fetch(
        `https://work.ink/_api/v2/override?destination=${encodeURIComponent(destinationUrl)}`
    );

    if (!response.ok) {
        throw new Error(`work.ink API error: ${response.status}`);
    }

    const data = await response.json();
    return data.sr; // Returns the "sr" token
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, CORS);
        res.end();
        return;
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const type = req.query.type === '24h' ? '24h' : '12h';

    // Rate limit: 10 checkpoint requests per minute per IP
    const allowed = await checkRateLimit(ip, 'checkpoint', 10, 60);
    if (!allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Too many requests. Wait a minute.' }));
        return;
    }

    try {
        // Check if user is returning from work.ink (has completed tasks)
        const referer = req.headers.referer || req.headers.referrer || '';
        const isFromWorkInk = referer.includes('work.ink');

        // ── Start new checkpoint flow ──
        if (!isFromWorkInk) {
            // Store pending key request in Redis with IP as key
            await createCheckpointToken(1, type, ip, { timestamp: Date.now() });

            // Redirect to work.ink
            const workinkUrl = `https://work.ink/${WORKINK_LINK_ID}/ph4smoclub-key`;
            
            res.writeHead(302, { Location: workinkUrl, ...CORS });
            res.end();
            return;
        }

        // ── User returned from work.ink - generate key ──
        // Check if there's a pending request for this IP
        const pendingRequest = await getCheckpointToken(`pending:${ip}`);
        if (!pendingRequest) {
            res.writeHead(302, {
                Location: `/get-key?error=no_pending_request`,
                ...CORS
            });
            res.end();
            return;
        }

        // Delete the pending request
        await deleteCheckpointToken(`pending:${ip}`);

        // Generate key
        const key = await createKey(pendingRequest.keyType);
        
        res.writeHead(302, {
            Location: `/checkpoint?success=1&key=${key}&type=${pendingRequest.keyType}`,
            ...CORS
        });
        res.end();

    } catch (err) {
        console.error('Checkpoint error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
}

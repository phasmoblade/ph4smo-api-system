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
    const workinkToken = req.query.token || null;

    // Rate limit: 10 checkpoint requests per minute per IP
    const allowed = await checkRateLimit(ip, 'checkpoint', 10, 60);
    if (!allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Too many requests. Wait a minute.' }));
        return;
    }

    try {
        // ── Start new checkpoint flow ──
        if (!workinkToken) {
            // Get base URL from request
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const baseUrl = `${protocol}://${host}`;
            
            // Create checkpoint token for verification later
            const checkpointToken = await createCheckpointToken(1, type, ip);

            // Build destination URL with {TOKEN} placeholder
            const destinationUrl = `${baseUrl}/api/checkpoint?type=${type}&token={TOKEN}&ctoken=${checkpointToken}`;
            
            // Get work.ink override token
            const srToken = await getWorkInkToken(destinationUrl);
            
            // Build work.ink link with sr parameter
            const workinkUrl = `https://work.ink/${WORKINK_LINK_ID}?sr=${srToken}`;
            
            res.writeHead(302, { Location: workinkUrl, ...CORS });
            res.end();
            return;
        }

        // ── Verify completion and generate key ──
        const checkpointToken = req.query.ctoken || null;
        if (!checkpointToken) {
            res.writeHead(302, {
                Location: `/get-key?error=missing_token&type=${type}`,
                ...CORS
            });
            res.end();
            return;
        }

        // Validate checkpoint token
        const tokenData = await getCheckpointToken(checkpointToken);
        if (!tokenData) {
            res.writeHead(302, {
                Location: `/get-key?error=token_expired&type=${type}`,
                ...CORS
            });
            res.end();
            return;
        }

        // Consume the token (one-time use)
        await deleteCheckpointToken(checkpointToken);

        // Generate key
        const key = await createKey(type);
        
        res.writeHead(302, {
            Location: `/checkpoint?success=1&key=${key}&type=${type}`,
            ...CORS
        });
        res.end();

    } catch (err) {
        console.error('Checkpoint error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
}

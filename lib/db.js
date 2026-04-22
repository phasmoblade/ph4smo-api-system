// lib/db.js — Vercel KV wrapper
// Vercel KV is Redis-based. Set env vars in Vercel dashboard:
// KV_REST_API_URL, KV_REST_API_TOKEN

import { kv as vercelKv } from '@vercel/kv';
import crypto from 'crypto';

export const kv = vercelKv;

const ADMIN_SECRET = process.env.admin_secret || process.env.ADMIN_SECRET || 'change_this_secret';
const HMAC_SECRET  = process.env.HMAC_SECRET  || 'change_this_hmac_secret';

// ─── Key helpers ────────────────────────────────────────────

export function generateKeyString() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segments = [5, 5, 5, 5];
    return segments.map(len =>
        Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    ).join('-');
}

export function generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

export function signResponse(data) {
    const str = JSON.stringify(data);
    const sig = crypto.createHmac('sha256', HMAC_SECRET).update(str).digest('hex');
    return { ...data, _sig: sig };
}

export function verifyAdminSecret(secret) {
    return secret === ADMIN_SECRET;
}

// ─── Key operations ─────────────────────────────────────────

// Parse duration string to hours
function parseDuration(type) {
    const map = {
        '12h': 12,
        '24h': 24,
        '3d': 72,
        '7d': 168,
        '14d': 336,
        '30d': 720,
        '90d': 2160,
        '180d': 4320,
        '365d': 8760,
        'lifetime': null
    };
    return map[type] !== undefined ? map[type] : 12;
}

// key:{keyString} → { hwid, expires, type, banned, premium, createdAt }
export async function createKey(type, isPremium = false) {
    const key    = generateKeyString();
    const hours  = parseDuration(type);
    const now    = Date.now();
    const data   = {
        type,
        hwid:      null,
        expires:   null,       // set when first used
        banned:    false,
        premium:   isPremium,
        createdAt: now,
        usedAt:    null,
        duration:  hours,      // store duration for later use
    };
    await kv.set(`key:${key}`, JSON.stringify(data));
    // Add to key list
    await kv.lpush('keys:all', key);
    return key;
}

export async function getKey(keyString) {
    const raw = await kv.get(`key:${keyString}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function saveKey(keyString, data) {
    await kv.set(`key:${keyString}`, JSON.stringify(data));
}

export async function getAllKeys() {
    const keys = await kv.lrange('keys:all', 0, -1);
    if (!keys || keys.length === 0) return [];
    const result = [];
    for (const k of keys) {
        const data = await getKey(k);
        if (data) result.push({ key: k, ...data });
    }
    return result;
}

export async function banKey(keyString) {
    const data = await getKey(keyString);
    if (!data) return false;
    data.banned = true;
    await saveKey(keyString, data);
    return true;
}

export async function unbanKey(keyString) {
    const data = await getKey(keyString);
    if (!data) return false;
    data.banned = false;
    await saveKey(keyString, data);
    return true;
}

export async function deleteKey(keyString) {
    await kv.del(`key:${keyString}`);
    // Remove from list
    await kv.lrem('keys:all', 0, keyString);
    return true;
}

// ─── Checkpoint token operations ────────────────────────────

// token:{token} → { step, keyType, ip, createdAt, metadata }
export async function createCheckpointToken(step, keyType, ip, metadata = {}) {
    const token = `pending:${ip}`;
    const data  = { step, keyType, ip, createdAt: Date.now(), ...metadata };
    // Token expires in 10 minutes
    await kv.set(token, JSON.stringify(data), { ex: 600 });
    return token;
}

export async function getCheckpointToken(token) {
    const raw = await kv.get(token);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function updateCheckpointToken(token, data) {
    // Update with same expiry (10 minutes)
    await kv.set(token, JSON.stringify(data), { ex: 600 });
}

export async function deleteCheckpointToken(token) {
    await kv.del(token);
}

// ─── Rate limiting ───────────────────────────────────────────

export async function checkRateLimit(ip, action, maxRequests = 5, windowSec = 60) {
    const rkey = `rl:${action}:${ip}`;
    const count = await kv.incr(rkey);
    if (count === 1) await kv.expire(rkey, windowSec);
    return count <= maxRequests;
}

// ─── Anti-bypass / IP block ──────────────────────────────────

export async function isIPBlocked(ip) {
    const data = await kv.get(`bypass:blocked:${ip}`);
    if (!data) return { blocked: false };
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return { blocked: true, unlocksAt: parsed.unlocksAt };
}

export async function blockIP(ip, durationSec = 7200) {
    const unlocksAt = Date.now() + durationSec * 1000;
    await kv.set(`bypass:blocked:${ip}`, JSON.stringify({ unlocksAt }), { ex: durationSec });
}

// ─── HWID active key check ────────────────────────────────────

export async function getActiveKeyByHWID(hwid) {
    const keyRef = await kv.get(`hwid:activekey:${hwid}`);
    if (!keyRef) return null;
    const keyStr = typeof keyRef === 'string' ? keyRef : String(keyRef);
    const data = await getKey(keyStr);
    if (!data) return null;
    // Check if still valid
    if (data.expires && Date.now() > data.expires) return null;
    if (data.banned) return null;
    return { key: keyStr, ...data };
}

export async function setActiveKeyForHWID(hwid, keyString, expiresSec) {
    if (expiresSec) {
        await kv.set(`hwid:activekey:${hwid}`, keyString, { ex: expiresSec });
    } else {
        // lifetime key - no expiry
        await kv.set(`hwid:activekey:${hwid}`, keyString);
    }
}

export async function isHWIDBanned(hwid) {
    const banned = await kv.get(`hwid:banned:${hwid}`);
    return !!banned;
}

export async function banHWID(hwid) {
    await kv.set(`hwid:banned:${hwid}`, '1');
}

export async function unbanHWID(hwid) {
    await kv.del(`hwid:banned:${hwid}`);
}

export async function getAllBannedHWIDs() {
    // We store a list separately for admin panel
    const list = await kv.lrange('hwids:banned', 0, -1);
    return list || [];
}

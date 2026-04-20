# ph4smoapi — Key System

Key system for ph4smo.club scripts.

## Setup

### 1. Deploy to Vercel
```
1. Create new GitHub repo: ph4smoapi
2. Push this folder to it
3. Import to Vercel → Deploy
4. URL will be: ph4smoapi.vercel.app
```

### 2. Set Environment Variables in Vercel Dashboard
Go to Project Settings → Environment Variables and add:

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_SECRET` | Your admin panel password | `mysecretpassword123` |
| `HMAC_SECRET` | Secret for signing API responses | `anyrandomstring456` |
| `KV_REST_API_URL` | Vercel KV URL (from KV dashboard) | `https://...` |
| `KV_REST_API_TOKEN` | Vercel KV token | `...` |
| `WORKINK_LINK_ID` | work.ink link ID | `2w6I` (from your work.ink link) |

### 3. Set up Vercel KV
1. Go to Vercel Dashboard → Storage → Create KV Database
2. Connect it to your project
3. Vercel auto-adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`

### 4. Set up work.ink
1. Go to [work.ink](https://work.ink) and create an account
2. Add your payout details (payment method)
3. Go to **Developers** section and get your **API Key**
4. Create a new **Offer**:
   - Set offer name (e.g., "ph4smo Key System")
   - Set payout amount per completion
   - Configure tasks (surveys, app installs, etc.)
   - Copy the **Offer ID**
5. Add both `WORKINK_API_KEY` and `WORKINK_OFFER_ID` to Vercel environment variables
6. Redeploy your project on Vercel

## URLs

| URL | Description |
|-----|-------------|
| `ph4smoapi.vercel.app` | Main page (choose key type) |
| `ph4smoapi.vercel.app/get-key` | Get key page |
| `ph4smoapi.vercel.app/admin` | Admin panel |
| `ph4smoapi.vercel.app/api/checkkey?key=X&hwid=Y` | Script validation endpoint |
| `ph4smoapi.vercel.app/api/admin?action=X&secret=Y` | Admin API |

## Admin Panel
Go to `/admin` and enter your `ADMIN_SECRET`.

Features:
- Dashboard with stats
- View/ban/delete all keys
- Generate keys manually
- Ban HWIDs

## Lua Script Integration
Add this to the top of your script:
```lua
-- Key check is handled by the loader
```
See the key check implementation in the main script.

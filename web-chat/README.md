# KCWT web chat

Live chat for [kcwatchtrading.com](https://kcwatchtrading.com). The site widget (`kcwt-chat-widget.js`) stays as it is. This service replaces the OpenClaw Sam tunnel.

Railway: create a **new** service in project scintillating-upliftment. Do not change the existing `kcwatchtrading` lead-relay service.

**Root directory = `web-chat`**

Start command is `npm start` (`node server.js`). Node 18 or newer. `PORT` is provided by Railway.

Do not change the live site file `chat-endpoint.txt` in the same deploy as this service. After the service has a public URL, point that file at:

```text
https://<service>.up.railway.app/chat
```

See `chat-endpoint.example.txt`. The widget only accepts a URL that ends in `/chat`.

## Env vars

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | Railway sets this | HTTP port |
| `TELEGRAM_BOT_TOKEN` | yes, for handoff | Same bot lead-relay uses to alert Gary. Not the inventory bot. |
| `TELEGRAM_CHAT_ID` | yes, for handoff | Gary's chat id. Plain replies from this chat are delivered to the site. |
| `ANTHROPIC_API_KEY` | no | When set, visitor replies use Claude Haiku. When unset, a buy/sell state machine answers. |
| `ANTHROPIC_MODEL` | no | Default `claude-haiku-4-5-20251001` |
| `RAILWAY_VOLUME_MOUNT_PATH` | no | When set, sessions (24h) and uploaded photos are stored on that volume. Without it, sessions live in memory and a restart drops them. |
| `RAILWAY_PUBLIC_DOMAIN` | no | When set with the bot token, the process registers `https://<domain>/telegram` as the bot webhook on boot. |
| `TELEGRAM_WEBHOOK_SECRET` | no | If set, `POST /telegram` requires Telegram's `X-Telegram-Bot-Api-Secret-Token` header, and webhook registration sends it as `secret_token`. |

Use the lead-relay bot token. Registering a webhook on the inventory bot would steal that bot's updates.

## What Gary does in Telegram

Every open, visitor message, and photo sends an alert that includes the session id.

- A normal reply goes to the latest open website session and takes the chat over. The concierge stops answering that session.
- `/t <sessionId> your message` (or `/reply <sessionId> your message`) sends to a specific session.
- Replying to an alert that contains a session id targets that session.
- `/who` shows the active session. `/help` prints the commands.

Gary's texts show up in the widget on the next poll (`from: "gary"`). They are not written by the model.

## HTTP

CORS allows `https://kcwatchtrading.com` and `https://www.kcwatchtrading.com`, including `OPTIONS`. Requests with no `Origin` (curl, Railway health checks) are allowed. Any other `Origin` gets 403.

- `GET /` and `GET /health` → `200 { "ok": true }`
- `POST /chat` with `message: "__open__"` starts a session and returns the greeting.
- `POST /chat` with a visitor message returns `{ reply, handledBy, ts, sessionId }`. `handledBy` is `"human"` only when `reply` is text Gary sent. While Gary has the session, the concierge does not answer. If Gary's line has not been polled yet, that POST returns it (`handledBy: "human"`). Otherwise `reply` is empty.
- `GET /chat?sessionId=&since=` returns `{ messages: [{ text, from: "gary"|"sam", ts }] }` with `ts` greater than `since`. Gary's takeover lines use `from: "gary"`. Each line is returned once.
- `POST /upload` with `{ sessionId, photoType, imageData }` (`imageData` is a `data:image/...;base64,...` URI) returns `{ "ok": true }` or `{ "error": "..." }`. The image bytes are kept when a volume is mounted. Gary gets a Telegram note that a photo arrived. v1 does not run vision.

## Smoke test

```bash
cd web-chat
PORT=3456 TELEGRAM_CHAT_ID=1 node server.js
```

```bash
# health
curl -sS http://127.0.0.1:3456/health

# open
curl -sS http://127.0.0.1:3456/chat \
  -H 'Origin: https://kcwatchtrading.com' \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"web_demo123","message":"__open__","visitor":{"ts":1}}'

# visitor message
curl -sS http://127.0.0.1:3456/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"web_demo123","message":"I want to sell a Submariner"}'

# poll — nothing new yet (the greeting and concierge reply already came back on POST)
curl -sS 'http://127.0.0.1:3456/chat?sessionId=web_demo123&since=0'

# upload
curl -sS http://127.0.0.1:3456/upload \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"web_demo123","photoType":"face","imageData":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'

# Gary takes over (chat id must match TELEGRAM_CHAT_ID)
curl -sS http://127.0.0.1:3456/telegram \
  -H 'Content-Type: application/json' \
  -d '{"message":{"chat":{"id":1},"from":{"id":1},"text":"I can take a look this afternoon."}}'

# Gary's line is waiting on the poll
curl -sS 'http://127.0.0.1:3456/chat?sessionId=web_demo123&since=0'
```

Preflight:

```bash
curl -sS -D - -o /dev/null -X OPTIONS http://127.0.0.1:3456/chat \
  -H 'Origin: https://www.kcwatchtrading.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Content-Type'
```

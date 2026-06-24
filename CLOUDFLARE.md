# Cloudflare deployment

The website, ticket API, and static files deploy as one Cloudflare Worker. Discord remains the staff interface. The Worker creates Discord threads, sends visitor messages, reads staff replies, and closes the website ticket when the thread is locked, deleted, or receives `!close`.

## One-time setup

Install Node.js 22 or newer first. Then run these commands.

Run these commands from the `[Website]` folder:

```powershell
npm install
npx wrangler login
npx wrangler d1 create liquid-star-tickets
```

Copy the `database_id` printed by Cloudflare into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Create the database tables:

```powershell
npm run db:remote
```

Store the Discord bot token without putting it in a file or command:

```powershell
npx wrangler secret put DISCORD_BOT_TOKEN
```

Generate a security secret:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Copy that generated value, then run:

```powershell
npx wrangler secret put SECURITY_HASH_SECRET
```

Wrangler asks for the value privately after each `secret put` command.

## Deploy

```powershell
npm run deploy
```

Cloudflare prints the live URL: `https://liquid-star.liquidstarvoxiom.workers.dev`. Open it and test Support. A newly registered `workers.dev` subdomain can take a few minutes to begin resolving.

## Discord requirements

The bot must remain invited to the Discord server. In the configured Forum or text channel it needs View Channel, Send Messages, Send Messages in Threads, Create Public Threads, Read Message History, Embed Links, and Manage Threads.

The bot may appear offline because the Worker uses Discord's REST API instead of maintaining an always-online gateway connection. Tickets and replies still work. Staff can reply normally inside a ticket thread. Type `!close`, lock the thread, or delete it to close the website ticket.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, add local values, then run:

```powershell
npm run db:local
npm run dev
```

Never commit `.dev.vars`, `bot/.env`, a bot token, or a security secret.

# Micro Manager

A small, self-hosted client portal and task manager for freelance creatives. Clients log in to submit requests, drag them into the order they care about, chat on each one, pay invoices, and download their files. You get a kanban board across every client, Stripe invoicing and subscriptions, and file delivery that unlocks when the bill is paid.

One Node process, one SQLite file, one uploads folder. No external services are required; Stripe is optional.

![Board](docs/board.png)

| Client files waiting on payment | Terminal themes |
| --- | --- |
| ![Locked files](docs/client-files.png) | ![Themes](docs/themes.png) |
| **Invoice with attached deliverables** | **Gruvbox Light** |
| ![Invoice](docs/invoice.png) | ![Light theme](docs/board-light.png) |

## Features

- **Kanban board** with five columns (Backlog, Up next, In progress, In review, Done). Clients see only their own requests and can drag to reorder them; the top of "Up next" is their highest priority. Mouse, touch and keyboard dragging are supported.
- **Requests** have a description, priority, due date, checklist, file attachments and a comment thread shared between you and the client.
- **Files** per client. Clients can browse, search, upload, rename and delete their own uploads, and download everything that is unlocked.
- **Paid-file gating.** Attach files to an invoice and they stay locked for the client until that invoice is paid. Files can also be marked "requires subscription". An active subscription unlocks every file on the account. Staff can always download.
- **Invoices** with line items, due dates and notes, sent through Stripe (hosted invoice page and email) or issued locally in demo mode. Mark paid for cash/bank transfers, void, and sync.
- **Subscriptions** (weekly, monthly, yearly retainers) that clients start through Stripe Checkout. Clients can manage cards or cancel via the Stripe customer portal.
- **15 terminal themes**: Tokyo Night, Catppuccin Mocha/Latte, Dracula, Nord, Gruvbox Dark/Light, One Dark, Solarized Dark/Light, Monokai, Rosé Pine/Dawn, Everforest and Kanagawa. Each person picks their own; admins set the default.
- **Command palette** (`⌘K` / `Ctrl+K`) to jump around and live-preview themes.
- Roles: **admin** (everything, plus team and workspace settings), **member** (manages clients, files and billing), **client** (their own portal).

## Get started

Pick whichever fits you. Each one ends the same way: open the address in your browser and a few setup screens walk you through creating your account, picking a look, connecting payments (optional) and loading example data to explore.

### Option 1: One click in the cloud (easiest)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/syntaxless/micro-manager)

1. Click the button and sign up for Render (free account).
2. Click **Deploy**. Render runs Micro Manager on its Starter plan (about $7 a month) with a disk for your files.
3. When it says **Live**, open the address Render shows you (something like `micro-manager-xxxx.onrender.com`).

You can add your own domain later under the service's **Settings → Custom Domains** in Render.

### Option 2: Your own server, one command

Rent any small Linux server (DigitalOcean, Hetzner, Linode, etc., about $5 a month), log in to it, and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/syntaxless/micro-manager/main/install.sh | bash
```

It installs everything it needs and asks one question: your domain name. If you have one, point it at the server first and you get HTTPS automatically. If not, just press Enter. Run the same command again any time to update; your data is kept.

### Option 3: On your own computer, to try it out

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it.
2. Download [docker-compose.yml](https://raw.githubusercontent.com/syntaxless/micro-manager/main/docker-compose.yml) into a folder.
3. In that folder, run `docker compose up -d`, then open http://localhost:3000.

### After setup

- **Getting paid:** in **Settings → Payments**, paste your Stripe secret key (the setup screen links you to the right page in Stripe). No Stripe? You can still send invoices and mark them paid by hand.
- **Inviting clients:** add a client under **Clients**, then **Invite**. They get a link to choose a password.
- **Backups:** everything (database and files) lives in one folder: `data/` next to the installer, or the disk in Render. Copy that folder and you have it all.

## Configuration (advanced)

Everything above is set inside the app. You only need these environment variables if you want to override those settings or tune the server.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `APP_URL` | from setup | Public URL used in invite links and Stripe redirects. Detected during setup; also editable in Settings. |
| `DATA_DIR` | `./data` | Database and uploads. |
| `MAX_UPLOAD_MB` | `200` | Per-file upload limit. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | | Creates the first admin on boot instead of using the setup screen. |
| `STRIPE_SECRET_KEY` | | Overrides the key saved in Settings. |
| `STRIPE_WEBHOOK_SECRET` | | Overrides the webhook secret saved in Settings. |
| `DEMO_PAYMENTS` | `false` | Without Stripe, lets clients simulate payments. Testing only. |
| `CURRENCY` | `usd` | Overrides the currency chosen in Settings. |
| `TRUST_PROXY` | `loopback` | Express `trust proxy` setting when running behind a reverse proxy. |

## Stripe

1. Paste a secret key in **Settings → Payments** (or set `STRIPE_SECRET_KEY`). Test keys (`sk_test_…`) show a "stripe test mode" tag.
2. Create an invoice and choose **Create & send**. Micro Manager creates the customer, the invoice and its line items in Stripe, finalizes it and asks Stripe to email it. Clients pay on Stripe's hosted page.
3. Create a subscription. The client clicks **Start subscription** and pays through Stripe Checkout (or you copy the checkout link and send it).

Statuses are pulled from Stripe whenever someone opens Billing, so a self-hosted box that Stripe can't reach still stays correct. For instant updates, add a webhook endpoint at `APP_URL/api/stripe/webhook` listening to `invoice.*`, `customer.subscription.*` and `checkout.session.completed`, and paste its signing secret under **Settings → Payments → Advanced**. Locally you can use the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

To let clients update their card or cancel, save a customer portal configuration once in the Stripe dashboard (Settings → Billing → Customer portal).

**Without Stripe**, issuing an invoice just marks it open and you record payments with **Mark paid**; subscriptions are activated by hand. To try the client side of the flow, turn on **Practice mode** in Settings → Payments (or set `DEMO_PAYMENTS=true`): clients then get a "Pay" button that records a simulated payment. Turn it off before real clients log in, since it lets them mark their own invoices paid.

## How file locking works

For a client, a file is downloadable when any of these is true:

- they uploaded it themselves;
- their account has an active (or trialing) subscription;
- it is attached to at least one invoice and one of those invoices is paid;
- it is attached to no invoice and isn't marked "requires subscription".

Otherwise it shows as locked with the reason (for example "Unlocks when invoice INV-0004 is paid") and a link to pay. Downloads are checked on the server, so a locked file can't be fetched by URL.

## Development

Node 22.13 or newer.

```bash
npm install
npm run dev        # API on :3000 with reload, Vite on :5173 (open this one)
npm test           # API tests, including a faked Stripe flow
npm run typecheck
npm run build && npm run seed && npm start   # demo data; logins admin@example.com / client@example.com, password123
```

The stack is Express 5 + Node's built-in `node:sqlite` on the server and React 19 + Vite + dnd-kit on the client, all TypeScript. Themes live in `shared/themes.ts`; adding one is a single line.

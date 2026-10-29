# IPO Alerts

Friends sign up with their WhatsApp number. Each morning you check which open IPOs are trading above **20% GMP** and send them a short, friendly WhatsApp message, either automatically from your PC or by pasting it into your WhatsApp broadcast list on your phone.

**Live site:** https://sowki03.github.io/ipo-alerts/ · **Admin:** https://sowki03.github.io/ipo-alerts/admin.html

## What a message looks like

```
☀️ Good morning Rahul!
Today's hot IPO 👇

📅 Closes tomorrow
BLS Polymers
💰 You need ₹15,000 to apply
📈 If it lists the way the market expects, you could make ~₹5,100 (34%)
👥 35 people fighting for every 1 share 🍀

⚠️ IPO investments are subject to market risks. Expected gains are not guaranteed.
```

On days with nothing above 20%, friends get one of 91 rotating funny lines instead, such as
"☀️ Good morning Rahul! The IPO market called in sick today 🤒 Back on its feet tomorrow!"

## How it works

```
 Friends ──► index.html (signup) ──► Supabase ◄── admin.html (you, phone or PC)
                                        ▲                │
                                        │                ├─ 📱 Send from phone: copy → paste into broadcast list
                                        │                └─ 💻 Send from PC: queues the send
                                        │                          │
                                        └──── sender/ on your PC ◄─┘  sends 1:1 on WhatsApp, with names
```

| Part | What it does | Runs on |
|---|---|---|
| `index.html` | Signup form + today's live 20%+ IPOs | GitHub Pages |
| `unsubscribe.html` | Friends remove themselves by number | GitHub Pages |
| `admin.html` | Email-link login, fetch IPOs, preview/edit message, send, subscribers, history, broadcast-list to-do | GitHub Pages |
| `supabase/schema.sql` | Tables and security rules (public can only sign up / unsubscribe) | Supabase |
| `sender/` | WhatsApp Web session: sends queued messages, welcomes new friends, handles STOP/START replies | Your PC |

## Two ways to send

- **💻 From PC:** automatic, one by one, with each friend's name as they typed it. Start `sender/start-sender.bat` and keep it open. The admin page shows whether the sender is online. A send that waits more than 30 minutes (PC off) is skipped, so stale alerts never go out late.
- **📱 From phone:** for when you're away from the PC. Copy the message on the admin page and paste it into your WhatsApp broadcast list. Everyone gets the same "Good morning!" text. Friends must have your number saved for broadcast messages to reach them; the admin page lists who to add to or remove from the list.

## Project layout

```
index.html, unsubscribe.html, admin.html
css/app.css            shared styles for admin + unsubscribe
js/config.js           Supabase URL + public anon key
js/ipo.js              live IPO data (InvestorGain) + message builder
js/templates.js        rotating "nothing hot today" lines
js/admin.js            admin page logic
supabase/schema.sql    database schema + row level security
sender/                PC WhatsApp sender (Node.js, whatsapp-web.js)
```

## Setup

See [SETUP.md](SETUP.md) for the Supabase, GitHub Pages and PC sender steps.

**Never commit** `sender/.env` (the Supabase service-role key) or `sender/.wwebjs_auth/` (the WhatsApp login). Both are in `.gitignore`.

## Disclaimer

Information only, not investment advice. Grey market premium (GMP) is unofficial and can change quickly. IPO investments are subject to market risks.

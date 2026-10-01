# MoodChat: Real-time MERN chat with AI sentiment analysis

A real-time chat app built with **MongoDB, Express, React (Vite) and Node.js**, using **Socket.io** for live messaging.
Every message is run through a sentiment analyzer (`input text -> output label`) before it is saved and broadcast.

## Features
- Register / log in (JWT + bcrypt)
- Real-time channels (`general`, `random`, `support`), online users, typing indicator
- **Sentiment analysis on every message**: label (positive / neutral / negative) + score, stored in MongoDB
- **Live tone preview** while you type
- **Room mood meter** summarising the sentiment of the room
- **Private invite-only rooms** with creator bans, unbans, and automatic moderation
- **Mutual friend requests** and real-time one-to-one messaging
- Online-user counts in the general and random rooms
- Responsive dark UI, custom SVG assets

## How the sentiment feature works
The whole feature is one function, `analyze(text)` in `server/utils/sentiment.js`. It uses the
quantized DistilBERT model `Xenova/distilbert-base-uncased-finetuned-sst-2-english` through
Transformers.js. Inference runs on the server CPU; message text is not sent to an AI API. The model
predicts positive or negative sentiment; low-confidence predictions and text without polarity cues
are treated as neutral. The model files are downloaded from Hugging Face when sentiment is first
requested and cached locally.
The first analysis therefore takes longer and requires internet access. No AI API key or
per-request model fee is required.

1. `server/socket.js` -> inside `message:send` (analyze -> save -> broadcast)
2. `server/server.js` -> `POST /api/analyze` (powers the live preview)

In private rooms, a negative result adds the model's negative confidence as 0-100 points.
If a member reaches 500 points across their messages in a rolling five-day window, they are
automatically removed and banned from that room. The creator can also ban any account by user ID,
unban accounts, and rotate invitation links. If the creator reaches the automatic threshold, the
creator remains able to manage the room and unban themselves. Sentiment classification is a moderation aid, not a reliable
assessment of a person's mental state; sarcasm and context can still be misclassified.

Private-room invitation links grant access to anyone who has the link until the creator rotates it.
Direct messages are available only after both users accept the friendship (an incoming request can
be accepted directly or by sending a request back).

## Project structure
```
mern-sentiment-chat/
├── .gitignore
├── package.json              # root scripts (dev / build / start)
├── README.md
├── server/
│   ├── .env.example          # copy to .env
│   ├── package.json
│   ├── server.js             # Express app + static serving in production
│   ├── socket.js             # Socket.io: auth, rooms, presence, messages
│   ├── constants.js          # room list
│   ├── config/db.js
│   ├── middleware/auth.js    # JWT guard
│   ├── models/{User,Message}.js
│   ├── routes/{auth,messages}.js
│   └── utils/sentiment.js    # <- the AI sentiment feature
└── client/
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── public/favicon.svg
    └── src/
        ├── main.jsx · App.jsx · api.js · constants.js · index.css
        ├── assets/           # logo, hero, positive/neutral/negative faces, empty-chat (SVG)
        ├── context/AuthContext.jsx
        ├── components/       # MessageBubble, MessageInput, MoodSummary, SentimentBadge
        └── pages/            # Login.jsx, Chat.jsx
```

## Run locally
Prerequisites: Node 20.19+ and MongoDB (local, or a MongoDB Atlas cluster). The sentiment model is
quantized for CPU inference but still needs disk space and memory; its weights are downloaded on the
first analysis, so allow outbound access to Hugging Face and retain the model cache in production
to avoid downloading it again after restarts.
By default, the model cache is `~/.cache/moodchat/transformers`; set `SENTIMENT_CACHE_DIR` to a
persistent writable directory on your deployment host if its application filesystem is ephemeral.
The downloaded quantized weights are about 65 MiB, and the backend used about 300 MiB of memory
after loading the model in local testing; select a host with at least 512 MiB of RAM and leave some
headroom for the runtime and database client.

```bash
# 1. install everything
npm install
npm run install-all

# 2. configure the server
cp server/.env.example server/.env      # Windows: copy server\.env.example server\.env
# edit server/.env: set MONGO_URI and a long random JWT_SECRET

# 3. start server (:5000) and client (:5173) together
npm run dev
```
Open http://localhost:5173, create two accounts in two browser windows, and chat.
Try: "I love this, it's awesome!" / "this is terrible, I hate it" / "see you at 5".

## Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit: MERN sentiment chat"
git branch -M main
git remote add origin https://github.com/<your-username>/mern-sentiment-chat.git
git push -u origin main
```
`.env` is git-ignored, so your secrets stay local.

## Deploy (single service on Render)
GitHub only stores the code (GitHub Pages cannot run a Node/Socket.io server), so deploy the app on a Node host.
Render's free tier works:

1. Create a free **MongoDB Atlas** cluster, add a database user, allow network access (0.0.0.0/0 for a demo), copy the connection string.
2. On Render: **New -> Web Service**, connect your GitHub repo.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Environment variables:
   - `NODE_ENV` = `production`
   - `MONGO_URI` = your Atlas connection string
   - `JWT_SECRET` = a long random string
   - `CLIENT_URL` = your Render URL, e.g. `https://mern-sentiment-chat.onrender.com`

In production Express serves the built React app, so the frontend and backend share one URL and no CORS setup is needed.

## Ideas to extend
- Warn before sending a strongly negative message
- Per-user mood history chart
- Private rooms / DMs, message reactions, emoji picker
- Swap `analyze()` for a multilingual or LLM-based classifier

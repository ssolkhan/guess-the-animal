# 🧠 Can You Think Like a Computer?

**PyroTech Engineering Day — AI Guessing Game**

Players try to guess a secret animal. The AI scores each guess from 0 to 1 based on semantic similarity, teaching students how AI understands relationships between concepts.

---

## Quick Deploy to Vercel (5 minutes)

### Step 1: Push to GitHub

1. Create a new repo on GitHub (e.g., `guess-the-animal`)
2. Push this folder:

```bash
cd guess-the-animal
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/guess-the-animal.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"**
3. Import your `guess-the-animal` repo
4. In **Settings → Environment Variables**, add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
5. Click **Deploy**

That's it! Vercel gives you a public URL like `https://guess-the-animal.vercel.app`

### Step 3: Open on Event Devices

Navigate to your Vercel URL on any tablet, laptop, or phone at the event. No installation needed.

---

## Project Structure

```
guess-the-animal/
├── api/
│   └── similarity.js    ← Serverless function (keeps API key safe)
├── public/
│   └── index.html       ← The game (single HTML file)
├── package.json
├── vercel.json           ← Routes /api/* to serverless functions
└── README.md
```

## How It Works

- The frontend sends the player's guess to `/api/similarity`
- The serverless function calls Claude's API with both the guess and secret word
- Claude returns a similarity score (0-1) and a spoiler-free reasoning
- The frontend displays results sorted by score

## Customization

**Change the animal list** — edit the `SECRET_ANIMALS` array in `public/index.html`

**Adjust scoring** — edit the system prompt in `api/similarity.js`

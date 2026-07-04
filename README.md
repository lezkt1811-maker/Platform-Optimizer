# Platform-Optimizer
StarChart13 Creator Intelligence Dashboard
A private, personal content-planning dashboard for StarChart13. Log research from TikTok, YouTube, Facebook, Snapchat, and your website, score topic ideas with an Opportunity Score, generate platform-ready captions, and track what wins.
Setup
No build step — plain HTML/CSS/JS.
Open index.html locally, or enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → main).
Go to Settings in the app and add your Anthropic API key to enable the AI caption generator and Lessons Learned insights. Get a key at console.anthropic.com.
Notes
All data (research entries, topics, history, settings) is saved in your browser's localStorage. It stays on whatever device/browser you use — it does not sync between devices and does not go through any server.
Your API key is stored the same way, locally in your browser, and is sent directly from your browser to Anthropic's API when you generate content.
Clearing your browser data/cache will erase everything — there's no cloud backup in this version.
Files
index.html — page shell
style.css — dark neon theme
app.js — all app logic (state, scoring, rendering, API calls)

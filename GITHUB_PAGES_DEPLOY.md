# Publish Trade X with GitHub Pages

This folder is GitHub Pages-ready. The root `index.html` is a self-contained build of the app, so your shareable link will open directly.

Important: GitHub Pages is static hosting. The app now also attempts frontend free-feed refresh every 1 second during 09:00–15:00 IST using Moneycontrol/Yahoo-style public endpoints, and it runs all analysis locally after each successful refresh. For more reliable server-side refresh, run/deploy the included Node server (`npm run serve:live`) on a platform such as Render, Railway, Fly.io, VPS, or your local computer.

## Option A — GitHub website, easiest

1. Create a new public GitHub repository, for example:
   `trade-x`
2. Upload all files from this folder to the repository root.
3. Go to repository **Settings → Pages**.
4. Under **Build and deployment**, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. Save.
6. Your link will be:

```text
https://YOUR-GITHUB-USERNAME.github.io/trade-x/
```

## Option B — Terminal commands

Replace `YOUR-GITHUB-USERNAME` and `trade-x`:

```bash
cd indian-market-intelligence
git init
git add .
git commit -m "Deploy Trade X market intelligence app"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/trade-x.git
git push -u origin main
```

Then enable GitHub Pages in **Settings → Pages → Deploy from branch → main → /root**.

## Notes

- The app uses verified delayed equity snapshots and labels the data as `DELAYED`.
- Options chains/backtesting remain demo/simulated until an official provider is connected.
- Do not commit real broker/API keys. Keep live data credentials server-side only.

# Torvant Drill

Small TypeScript web server (Node 20+) serving a simple page titled "Torvant Drill" with a button to call the Gemini API (`gemini-2.5-flash`).

## Local Development

1. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
2. Add your `GEMINI_API_KEY` in `.env`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build and start:
   ```bash
   npm run build
   npm start
   ```
5. Open `http://localhost:8080`.

## Cloud Run Deployment

- Region: `asia-south1`
- Max instances: `1`
- Public access: allowed (`--allow-unauthenticated`)
- Secret: `GEMINI_API_KEY` injected from Google Cloud Secret Manager

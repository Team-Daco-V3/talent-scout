<p align="center">
  <img src="apps/web/static/talent-scout-logo.png" alt="Talent Scout logo" width="120" />
</p>

# Talent Scout

Talent Scout is a local talent scouting tool built with the Markidy API and AI provider APIs.

It helps recruiters, founders, and hiring managers search Markidy profiles, evaluate candidate fit with AI, inspect public profile links, and save scouting reports as local JSON files.

It is not a final hiring decision system. It does not send messages, run chats, or make automated employment decisions.

## Demo

[![Watch the Talent Scout demo](https://img.youtube.com/vi/d4U0JhdhdOM/hqdefault.jpg)](https://youtu.be/d4U0JhdhdOM)

Watch the demo on YouTube: https://youtu.be/d4U0JhdhdOM

## Requirements

You need:

- Node.js 20.19 or newer, or Node.js 22.12 or newer
- A Markidy API key
- An AI provider API key from one supported provider:
  - OpenAI
  - Anthropic Claude
  - Google Gemini
  - xAI Grok
  - Mistral AI

The app runs locally on your computer. It does not include a database and does not store API keys on the server.

## Quick Start

### Option 1: Use the launcher

On Windows, double-click:

```text
start-talent-scout-windows.cmd
```

On macOS or Linux, run:

```bash
chmod +x start-talent-scout-macos-linux.sh
./start-talent-scout-macos-linux.sh
```

The launcher checks for Node.js, installs dependencies when `node_modules` is missing, and starts Talent Scout at `http://localhost:50224`.

### Option 2: Use the terminal

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run start
```

The app opens in your browser at:

```text
http://localhost:50224
```

If you are using Windows PowerShell and `npm` is blocked, use:

```powershell
npm.cmd install
npm.cmd run start
```

Stop the local server with `Ctrl+C` in the terminal.

## First Run

1. Open `http://localhost:50224`.
2. Enter the Markidy API URL. The default is `https://api.markidy.com`.
3. Paste your Markidy API key.
4. Choose an AI provider and paste that provider's API key.
5. Create or edit a scout with your hiring goal, target role, skills, countries, and candidate count.
6. Click `Save`, then `Run this scout`.
7. Open `Reports` to review saved and in-progress results.

## Report Storage

Talent Scout saves completed reports as JSON files in the project `reports/` folder.

- Each completed scout run creates a new report file.
- Existing reports are not overwritten.
- Reports are loaded again after browser refresh or app restart.
- API keys and AI keys are not written into report files.
- The `reports/` folder is ignored by git.

## Workspace Storage

Talent Scout saves scout setup and non-secret app settings in `.talent-scout/workspace.json`.

- Scout names, search criteria, selected AI provider, model, and API base URLs are restored after app restart.
- Markidy API keys and AI provider API keys are not saved to this file.
- API keys only stay in the current browser session and must be pasted again after the browser session ends.
- The `.talent-scout/` folder is ignored by git.

## What v1 Does

- Validates a Markidy API key through `/v1/me/channels`
- Uses AI to plan multiple Markidy profile search attempts, then broadens the search when strict filters return too few candidates
- Searches Markidy profiles through `/v1/profiles/search`
- Fetches profile detail through `/v1/profiles/:userId`
- Includes public `socialLinks`, `trustLinks`, and limited link previews in the AI evaluation context
- Evaluates candidates with a recommended AI provider preset
- Shows fit score, recommendation, objective matches/misses, reasons, risks, and profile links
- Exports results as JSON or CSV
- Provides a searchable country selector so users do not need to remember country codes

## What v1 Does Not Do

- No automatic message sending
- No chat automation
- No server-side background polling after the browser is closed
- No post/listing search
- No post request review
- No database
- No server-side stored API keys

## Configuration

The UI asks for:

- Markidy API URL, default `https://api.markidy.com`
- Markidy API key from the Markidy dashboard
- AI provider mode:
  - OpenAI
  - Anthropic Claude
  - Google Gemini
  - xAI Grok
  - Mistral AI

The open-source MVP intentionally ships only these recommended presets. More providers can be added by extending `apps/web/src/lib/ai/providers.ts`.

Save step stores settings in browser session storage, including API keys for the current browser session only. Keys are not stored in a server database by this app.

## Search Behavior

Talent Scout does not send one fixed query. The app asks the selected AI provider to create safe Markidy profile search attempts from the hiring criteria. The server then executes those Markidy profile API requests, starting strict and then removing optional filters to fill the candidate review pool. If AI planning fails, deterministic fallback attempts are used.

For each matching profile, Talent Scout fetches profile detail and evaluates the candidate with public profile signals. Candidate evaluation also includes public social/trust links and a small, guarded preview of public HTTP(S) pages when they are reachable.

## Security Notes

For local use, Talent Scout keeps credentials in memory only.

For a public hosted deployment, do not treat user-provided keys casually. A hosted operator receives the keys for each request. If you host this for other users, add a proper backend trust model, request logging policy, rate limits, and secret handling. Avoid putting AI or Markidy API keys directly into client-side JavaScript.

## Scripts

```bash
npm run start   # run locally at http://localhost:50224
npm run dev     # run Vite with the default development port
npm run build   # build the app
npm run check   # run Svelte and TypeScript checks
npm run test    # run unit tests
```

## Project Layout

```text
apps/web                 SvelteKit web app
apps/web/src/lib/server  Markidy and AI server adapters
apps/web/src/lib/fit     Objective scoring and shared types
apps/web/src/lib/export  JSON/CSV export helpers
```

## Contributing

Feedback, issues, and pull requests are welcome. Feel free to fork this project, adapt it for your own workflow, and suggest improvements.

## License

MIT

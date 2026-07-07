# Crypto Metrics Dashboard Local One-Click Launchers

These launchers start the dashboard on the user's own computer:

```text
http://localhost:3001
```

They install dependencies on the first run, build the React frontend, start the local Express backend, then open the browser.

Requirement: install Node.js LTS from `https://nodejs.org/`.

Configuration is shared through the repository root `.env` file. Copy `.env.example` to `.env`, then fill in `OPENAI_API_KEY` if AI parsing is needed.

If the package includes `database.sqlite`, it starts with that database. For a new local database, the first admin account is:

```text
username: admin
password: 123456
```

## Windows

1. Open the `launchers/windows` folder.
2. Double-click `Start Crypto Dashboard.bat`.
3. Keep the terminal window open while using the dashboard.

## macOS

1. Open the `launchers/mac` folder.
2. Double-click `Start Crypto Dashboard.command`.
3. Keep the terminal window open while using the dashboard.

If macOS blocks the file because it was downloaded from the internet, Control-click the file, choose `Open`, then choose `Open` again.

## Build A Shareable Package

From the project root:

```bash
npm run build:launchers
```

To build a package that includes the current local database:

```bash
npm run build:launchers:with-data
```

The generated folders and zips are written to:

```text
local-artifacts/launchers/
```

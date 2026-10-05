# Gittin

**An IDE? A word processor? It's just plain text.**

Gittin is a writing app for Markdown, notes, code and config files. It runs in your browser: open a file or a whole folder, format with a toolbar you already know, and save straight back to the file it came from. There are no accounts, and your files stay on your device.

Use it at [gittin.app](https://gittin.app).

## What it does

- **Write, then preview.** Format Markdown from the toolbar, then switch to Preview to read the finished page, with tables, maths, diagrams and emoji. Preview never changes your source.
- **More than Markdown.** Plain text, JSON, YAML, HTML, CSS, JavaScript and TypeScript open with their own syntax colours.
- **Bring the whole folder.** Open a folder, find the file you need and save each one back where it came from.
- **Nothing gets lost.** Unsaved changes wait in your browser until you save. Diff shows what changed since your last save, and version history keeps your recent saves so you can compare or restore them.
- **Works offline.** After one visit, Gittin starts without a connection.

Your documents stay ordinary files that open in any other app.

Saving back to files and folders needs a browser that can write to them, such as Chrome or Edge. In other browsers, saving downloads a copy instead.

## Development

Requires Node.js and npm.

    npm ci
    npm run dev

### Checks

    npm run typecheck
    npm test
    npx playwright install chromium webkit
    npm run test:browser
    npm run test:offline
    npm run build

`npm run test:browser` starts its own development server and runs in Chromium and WebKit. `npm run test:offline` builds the app and checks in Chromium that it works offline after one visit.

## Licence

Gittin's own code is released under the MIT Licence; see [LICENSE](LICENSE).

## Attribution

Gittin's editor incorporates and adapts source from TOAST UI Editor and its parser, together with material from other open-source projects. Required copyright, licence and attribution notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

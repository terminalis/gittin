# Gittin

Gittin is a writing app for Markdown, notes, code and config files. It runs in your browser: open a file or a whole folder, format with a toolbar you already know, and save straight back to the file it came from. There are no accounts, and your files stay on your device.

- Use it in the browser at [gittin.app/use](https://gittin.app/use/).
- On Windows, get the desktop app from the [Microsoft Store](https://apps.microsoft.com/detail/9NDJ4HR0FF1H).
- On Linux, install it with Flatpak:

      flatpak install --user https://terminalis.github.io/packages/flatpak/gittin.flatpakref

The desktop apps also commit your saves in git repositories and sync them with GitHub.

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

### Desktop app

The desktop app is the same app in a [Tauri](https://tauri.app) window, with git and GitHub added, in `src/native/`
and `src-tauri/`.
It needs Rust; on Windows also the Visual Studio Build Tools (C++), and on Linux Tauri's system packages
(`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev librsvg2-dev libssl-dev xdg-utils`).

    npm run tauri dev

`npm run tauri build` builds the Windows exe, and `tools/package-msix.ps1` packs it into the MSIX for the
Microsoft Store. [flatpak/README.md](flatpak/README.md) covers building the Flatpak. A version tag runs
`.github/workflows/release.yml`: the version lives in `package.json`, and each release needs a matching
`<release>` entry in the Flatpak metainfo.

The Rust third-party notices in `src-tauri/THIRD_PARTY_NOTICES.txt` are regenerated with
`node scripts/rust-notices.mjs` when `src-tauri/Cargo.lock` changes; the build fails on a `Cargo.lock` library
they neither credit nor list as not built.

## Licence

Gittin's own code is released under the MIT Licence; see [LICENSE](LICENSE).

## Attribution

Gittin's editor incorporates and adapts source from TOAST UI Editor and its parser, together with material from other open-source projects. Required copyright, licence and attribution notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). The desktop app's Rust libraries are listed in [src-tauri/THIRD_PARTY_NOTICES.txt](src-tauri/THIRD_PARTY_NOTICES.txt), generated with [cargo-about](https://github.com/EmbarkStudios/cargo-about).

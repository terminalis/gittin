# Flatpak

`io.github.terminalis.Gittin.yml` builds Gittin as a Flatpak on the GNOME runtime. The app gets a Wayland window
(X11 as a fallback), the GPU and the network, for images in documents; no filesystem access, no extra D-Bus names.
Files come and go through the desktop portals.

The build has no network, so every crate in `src-tauri/Cargo.lock` and every npm package in `package-lock.json`
is listed as a source, in `cargo-sources.json` and `node-sources.json`. Those files are generated, not committed:

```sh
bash tools/flatpak-cargo-sources.sh
bash tools/flatpak-node-sources.sh
```

Run them again whenever `Cargo.lock` or `package-lock.json` changes. They need `python3` with `pip`.

## Build and run

With Flatpak, the Flathub remote and Flathub's builder:

```sh
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub org.flatpak.Builder
```

From the repository root:

```sh
flatpak run --command=flathub-build org.flatpak.Builder --install flatpak/io.github.terminalis.Gittin.yml
flatpak run io.github.terminalis.Gittin
```

`flathub-build` builds the way Flathub does, into `builddir/` and the OSTree repo `repo/`, with its cache in
`.flatpak-builder/`. All three are gitignored and left out of the build's own source copy. To make a bundle
like the one on GitHub Releases:

```sh
flatpak build-bundle repo Gittin.flatpak io.github.terminalis.Gittin \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
```

## Lint

```sh
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest flatpak/io.github.terminalis.Gittin.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder --exceptions --user-exceptions flatpak/lint-exceptions.json repo repo
```

Both should pass. The one known difference is the source: this manifest builds the checkout it sits in
(`type: dir`), which the linter accepts everywhere except on Flathub's own servers, where it reports
`module-gittin-source-dir-not-allowed`.

## Distribution

Each release attaches the bundle to its GitHub Release, then starts `publish.yml` in
[terminalis/packages](https://github.com/terminalis/packages). That workflow imports the bundle into the signed
repository that Flatpak installs update from (`https://terminalis.github.io/packages/flatpak`). The bundle on its
own installs without updates.

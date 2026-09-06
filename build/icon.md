# build/icon.png

`build/icon.svg` is the source of `build/icon.png`, from which electron-builder derives
the `.icns` and `.ico` it ships.

Nothing in the build re-renders it: `icon.png` is committed, and re-rendering is a
deliberate step taken when the artwork changes. To do it:

## 1. Render the SVG with Electron

Create `scripts/render-icon.cjs`, which loads the SVG in a transparent 1024x1024
`BrowserWindow` and captures the page:

```js
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, backgroundColor: '#00000000', transparent: true });
    await win.loadFile(resolve('build/icon.svg'));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
    writeFileSync(resolve('build/icon.png'), image.toPNG());
    app.quit();
});
```

Run it from the repository root:

```sh
./node_modules/.bin/electron --force-device-scale-factor=1 scripts/render-icon.cjs
```

`capturePage`'s rect is in device-independent pixels, so on a Retina display the capture
comes out 2048x2048 and the icon is soft. `--force-device-scale-factor=1` keeps it at
1024. Delete `scripts/render-icon.cjs` afterwards; it is not committed.

## 2. Convert the capture to sRGB

The capture inherits the display's wide-gamut profile, which makes the gold a different
colour on other machines. Strip it:

```sh
sips --matchTo '/System/Library/ColorSync/Profiles/sRGB Profile.icc' build/icon.png --out build/icon.png
```

## 3. Verify

```sh
sips -g pixelWidth -g pixelHeight -g hasAlpha -g profile build/icon.png
```

Expect `pixelWidth: 1024`, `pixelHeight: 1024`, `hasAlpha: yes`, and a `profile` of
`sRGB IEC61966-2.1`.

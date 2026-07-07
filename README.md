# Auto Typer Chrome Extension

Auto Typer types the current clipboard text into the editable field that is focused when you paste or press the shortcut.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\user\OneDrive\Documents\Auto Typer`.

## Use

1. Focus an input, textarea, or contenteditable editor on a webpage.
2. Copy the text you want typed.
3. Press `Ctrl+V` on Windows/Linux or `Command+V` on macOS inside the focused field to auto-type the clipboard text.

You can also press `Ctrl+Shift+Y` on Windows/Linux or `Command+Shift+Y` on macOS. You can change that fallback shortcut at `chrome://extensions/shortcuts`.

Click the Auto Typer extension icon to enable or disable auto-typing. When disabled, paste behaves normally, the fallback shortcut does nothing, and any in-progress typing stops.

The extension stores the original target and caret position before typing starts. If you focus another field while typing is running, the running job continues writing into the original target. Pressing the hotkey again starts another typing job for whatever field is focused at that moment.

## Notes

- Chrome blocks extensions from running on internal pages like `chrome://extensions`.
- Existing tabs may need one refresh immediately after installing the extension.
- Typing speed is controlled by `TYPE_DELAY_MS` in `content.js`.

const MESSAGE_SOURCE = "auto-typer";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== MESSAGE_SOURCE || message.type !== "READ_CLIPBOARD") {
    return false;
  }

  void navigator.clipboard.readText()
    .then((text) => {
      sendResponse({
        ok: true,
        text
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || "Clipboard read failed."
      });
    });

  return true;
});

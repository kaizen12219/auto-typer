const MESSAGE_SOURCE = "auto-typer";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== MESSAGE_SOURCE || message.type !== "READ_CLIPBOARD") {
    return false;
  }

  void readClipboardText()
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

async function readClipboardText() {
  try {
    return readClipboardTextWithPasteCommand();
  } catch (pasteError) {
    if (!navigator.clipboard?.readText) {
      throw pasteError;
    }

    try {
      return await navigator.clipboard.readText();
    } catch (clipboardError) {
      throw new Error([
        "Clipboard read failed.",
        `paste command: ${getErrorMessage(pasteError)}`,
        `clipboard API: ${getErrorMessage(clipboardError)}`
      ].join(" "));
    }
  }
}

function readClipboardTextWithPasteCommand() {
  const textArea = getClipboardTextArea();
  textArea.value = "";
  textArea.focus();
  textArea.select();

  const pasted = document.execCommand("paste");
  const text = textArea.value;
  textArea.value = "";

  if (!pasted && text.length === 0) {
    throw new Error("document.execCommand('paste') returned false.");
  }

  return text;
}

function getClipboardTextArea() {
  let textArea = document.getElementById("clipboard-reader");

  if (textArea) {
    return textArea;
  }

  textArea = document.createElement("textarea");
  textArea.id = "clipboard-reader";
  textArea.setAttribute("aria-hidden", "true");
  textArea.style.position = "fixed";
  textArea.style.inset = "0";
  textArea.style.width = "1px";
  textArea.style.height = "1px";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.append(textArea);

  return textArea;
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

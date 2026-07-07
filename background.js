const MESSAGE_SOURCE = "auto-typer";
const TYPE_COMMAND = "type-clipboard";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const DEFAULT_ENABLED = true;

let creatingOffscreenDocument;

chrome.runtime.onInstalled.addListener(() => {
  void syncActionState();
});

chrome.runtime.onStartup.addListener(() => {
  void syncActionState();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === TYPE_COMMAND) {
    void typeClipboardIntoFocusedField();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== MESSAGE_SOURCE) {
    return false;
  }

  if (message.type === "TYPE_PREPARED_CLIPBOARD") {
    void typeClipboardIntoPreparedJob(sender, message.jobId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.warn("Auto Typer failed:", error);
        sendResponse({
          ok: false,
          error: error?.message || "Auto Typer failed."
        });
      });

    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.enabled) {
    void syncActionState();
  }
});

async function typeClipboardIntoFocusedField() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  try {
    if (!await isEnabled()) {
      await flashBadge(tab.id, "OFF", "#777777");
      return;
    }

    await ensureContentScript(tab.id);

    const prepared = await sendToFocusedFrame(tab.id, {
      source: MESSAGE_SOURCE,
      type: "PREPARE_TYPING"
    });

    if (!prepared?.ok || !prepared.jobId) {
      await flashBadge(tab.id, "NO", "#777777");
      return;
    }

    const clipboardText = await readClipboardText();

    await sendToFocusedFrame(tab.id, {
      source: MESSAGE_SOURCE,
      type: "START_TYPING",
      jobId: prepared.jobId,
      text: clipboardText
    });

    await flashBadge(tab.id, "GO", "#238636");
  } catch (error) {
    console.warn("Auto Typer failed:", error);
    await flashBadge(tab.id, "ERR", "#d1242f");
  }
}

async function typeClipboardIntoPreparedJob(sender, jobId) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;

  if (!tabId || typeof frameId !== "number" || !jobId) {
    throw new Error("Unable to find the originating tab and frame.");
  }

  if (!await isEnabled()) {
    await sendToFrame(tabId, frameId, {
      source: MESSAGE_SOURCE,
      type: "CANCEL_TYPING",
      jobId
    });
    await flashBadge(tabId, "OFF", "#777777");
    return;
  }

  const clipboardText = await readClipboardText();

  await sendToFrame(tabId, frameId, {
    source: MESSAGE_SOURCE,
    type: "START_TYPING",
    jobId,
    text: clipboardText
  });

  await flashBadge(tabId, "GO", "#238636");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        allFrames: true
      },
      files: ["content.js"]
    });
  } catch (error) {
    console.debug("Auto Typer could not inject into this page:", error);
  }
}

async function sendToFocusedFrame(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

async function isEnabled() {
  const settings = await chrome.storage.sync.get({
    enabled: DEFAULT_ENABLED
  });

  return Boolean(settings.enabled);
}

async function syncActionState() {
  const enabled = await isEnabled();

  await chrome.action.setTitle({
    title: enabled ? "Auto Typer is enabled" : "Auto Typer is disabled"
  });

  if (enabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#777777" });
  await chrome.action.setBadgeText({ text: "OFF" });
}

async function readClipboardText() {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    source: MESSAGE_SOURCE,
    type: "READ_CLIPBOARD"
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to read clipboard text.");
  }

  return response.text || "";
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (await hasOffscreenDocument(documentUrl)) {
    return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Read clipboard text when the user presses the Auto Typer shortcut."
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function hasOffscreenDocument(documentUrl) {
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl]
    });

    return existingContexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === documentUrl);
}

async function flashBadge(tabId, text, color) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });

  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }, 900);
}

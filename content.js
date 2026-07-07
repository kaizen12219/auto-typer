(() => {
  if (globalThis.__autoTyperContentScriptLoaded) {
    return;
  }

  globalThis.__autoTyperContentScriptLoaded = true;

  const MESSAGE_SOURCE = "auto-typer";
  const TYPE_DELAY_MS = 20;
  const DEFAULT_ENABLED = true;
  const TEXT_INPUT_TYPES = new Set([
    "",
    "email",
    "number",
    "password",
    "search",
    "tel",
    "text",
    "url"
  ]);

  const pendingJobs = new Map();
  const activeJobs = new Map();
  let autoTyperEnabled = false;
  let enabledStateLoaded = false;

  void hydrateEnabledState();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.enabled) {
      autoTyperEnabled = Boolean(changes.enabled.newValue);
      enabledStateLoaded = true;

      if (!autoTyperEnabled) {
        cancelAllJobs();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!shouldHandlePasteShortcut(event)) {
      return;
    }

    const job = prepareTypingJob();

    if (!job) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    pendingJobs.set(job.id, job);

    void requestClipboardTyping(job.id);
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== MESSAGE_SOURCE) {
      return false;
    }

    if (message.type === "PREPARE_TYPING") {
      const job = prepareTypingJob();

      if (!job) {
        return false;
      }

      pendingJobs.set(job.id, job);
      sendResponse({
        ok: true,
        jobId: job.id
      });
      return true;
    }

    if (message.type === "START_TYPING") {
      const job = pendingJobs.get(message.jobId);

      if (!job) {
        return false;
      }

      pendingJobs.delete(job.id);
      activeJobs.set(job.id, job);
      sendResponse({ ok: true });

      void runTypingJob(job, normalizeClipboardText(message.text))
        .catch((error) => console.warn("Auto Typer job failed:", error))
        .finally(() => activeJobs.delete(job.id));

      return true;
    }

    if (message.type === "CANCEL_TYPING") {
      const job = pendingJobs.get(message.jobId) || activeJobs.get(message.jobId);

      if (job) {
        job.cancelled = true;
        pendingJobs.delete(message.jobId);
        activeJobs.delete(message.jobId);
        sendResponse({ ok: true });
        return true;
      }
    }

    return false;
  });

  async function hydrateEnabledState() {
    const settings = await chrome.storage.sync.get({
      enabled: DEFAULT_ENABLED
    });

    autoTyperEnabled = Boolean(settings.enabled);
    enabledStateLoaded = true;
  }

  function shouldHandlePasteShortcut(event) {
    if (!enabledStateLoaded || !autoTyperEnabled || event.defaultPrevented) {
      return false;
    }

    const isPrimaryModifier = event.ctrlKey || event.metaKey;

    return Boolean(
      isPrimaryModifier &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "v"
    );
  }

  async function requestClipboardTyping(jobId) {
    try {
      const response = await chrome.runtime.sendMessage({
        source: MESSAGE_SOURCE,
        type: "TYPE_PREPARED_CLIPBOARD",
        jobId
      });

      if (!response?.ok) {
        cancelJob(jobId);
      }
    } catch (error) {
      console.warn("Auto Typer shortcut failed:", error);
      cancelJob(jobId);
    }
  }

  function cancelJob(jobId) {
    const job = pendingJobs.get(jobId) || activeJobs.get(jobId);

    if (job) {
      job.cancelled = true;
    }

    pendingJobs.delete(jobId);
    activeJobs.delete(jobId);
  }

  function cancelAllJobs() {
    for (const job of pendingJobs.values()) {
      job.cancelled = true;
    }

    for (const job of activeJobs.values()) {
      job.cancelled = true;
    }

    pendingJobs.clear();
    activeJobs.clear();
  }

  function prepareTypingJob() {
    if (!document.hasFocus()) {
      return null;
    }

    const activeElement = getDeepActiveElement(document);
    const control = getEditableControl(activeElement);

    if (control) {
      return createControlJob(control);
    }

    const editable = getFocusedContentEditable(activeElement);

    if (editable) {
      return createContentEditableJob(editable);
    }

    return null;
  }

  function getDeepActiveElement(root) {
    let activeElement = root.activeElement;

    while (activeElement?.shadowRoot?.activeElement) {
      activeElement = activeElement.shadowRoot.activeElement;
    }

    return activeElement;
  }

  function getEditableControl(element) {
    if (!element || element.disabled || element.readOnly) {
      return null;
    }

    if (element instanceof HTMLTextAreaElement) {
      return element;
    }

    if (element instanceof HTMLInputElement) {
      const inputType = (element.getAttribute("type") || "text").toLowerCase();
      return TEXT_INPUT_TYPES.has(inputType) ? element : null;
    }

    return null;
  }

  function getFocusedContentEditable(activeElement) {
    if (activeElement?.isContentEditable) {
      return getContentEditableRoot(activeElement);
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    if (!element?.isContentEditable) {
      return null;
    }

    return getContentEditableRoot(element);
  }

  function getContentEditableRoot(element) {
    let root = element;

    while (root.parentElement?.isContentEditable) {
      root = root.parentElement;
    }

    return root;
  }

  function createControlJob(element) {
    const selection = getControlSelection(element);

    return {
      id: crypto.randomUUID(),
      kind: "control",
      element,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      selectionDirection: selection.direction,
      cancelled: false
    };
  }

  function createContentEditableJob(element) {
    const selection = window.getSelection();
    const range = document.createRange();

    if (selection && selection.rangeCount > 0) {
      const selectedRange = selection.getRangeAt(0);

      if (element.contains(selectedRange.commonAncestorContainer)) {
        range.setStart(selectedRange.startContainer, selectedRange.startOffset);
        range.setEnd(selectedRange.endContainer, selectedRange.endOffset);
      } else {
        range.selectNodeContents(element);
        range.collapse(false);
      }
    } else {
      range.selectNodeContents(element);
      range.collapse(false);
    }

    return {
      id: crypto.randomUUID(),
      kind: "contenteditable",
      element,
      range,
      cancelled: false
    };
  }

  function getControlSelection(element) {
    const fallbackPosition = element.value.length;

    try {
      if (
        typeof element.selectionStart === "number" &&
        typeof element.selectionEnd === "number"
      ) {
        return {
          start: element.selectionStart,
          end: element.selectionEnd,
          direction: element.selectionDirection || "none"
        };
      }
    } catch {
      // Some input types expose value but do not support text selection APIs.
    }

    return {
      start: fallbackPosition,
      end: fallbackPosition,
      direction: "none"
    };
  }

  async function runTypingJob(job, text) {
    if (job.kind === "control") {
      await typeIntoControl(job, text);
      return;
    }

    await typeIntoContentEditable(job, text);
  }

  async function typeIntoControl(job, text) {
    for (const character of Array.from(text)) {
      if (!canUseControl(job.element) || job.cancelled) {
        break;
      }

      insertControlCharacter(job, character);
      await sleep(TYPE_DELAY_MS);
    }
  }

  function insertControlCharacter(job, character) {
    const element = job.element;
    const beforeInputEvent = createInputEvent("beforeinput", {
      data: character,
      inputType: "insertText",
      cancelable: true
    });

    if (!element.dispatchEvent(beforeInputEvent)) {
      return;
    }

    const value = element.value;
    const start = clamp(job.selectionStart, 0, value.length);
    const end = clamp(job.selectionEnd, start, value.length);
    const nextValue = value.slice(0, start) + character + value.slice(end);
    const nextPosition = start + character.length;

    setNativeValue(element, nextValue);
    job.selectionStart = nextPosition;
    job.selectionEnd = nextPosition;

    try {
      element.setSelectionRange(nextPosition, nextPosition, job.selectionDirection);
    } catch {
      // The original target may no longer support selection or may be unfocused.
    }

    element.dispatchEvent(createInputEvent("input", {
      data: character,
      inputType: "insertText"
    }));
  }

  async function typeIntoContentEditable(job, text) {
    for (const character of Array.from(text)) {
      if (!canUseContentEditable(job.element, job.range) || job.cancelled) {
        break;
      }

      insertContentEditableCharacter(job, character);
      await sleep(TYPE_DELAY_MS);
    }
  }

  function insertContentEditableCharacter(job, character) {
    const element = job.element;
    const beforeInputEvent = createInputEvent("beforeinput", {
      data: character,
      inputType: "insertText",
      cancelable: true
    });

    if (!element.dispatchEvent(beforeInputEvent)) {
      return;
    }

    job.range.deleteContents();

    if (character === "\n") {
      const lineBreak = document.createElement("br");
      job.range.insertNode(lineBreak);
      job.range.setStartAfter(lineBreak);
    } else {
      const textNode = document.createTextNode(character);
      job.range.insertNode(textNode);
      job.range.setStartAfter(textNode);
    }

    job.range.collapse(true);
    syncVisibleSelectionIfStillFocused(job);

    element.dispatchEvent(createInputEvent("input", {
      data: character,
      inputType: "insertText"
    }));
  }

  function canUseControl(element) {
    return Boolean(
      element?.isConnected &&
      !element.disabled &&
      !element.readOnly
    );
  }

  function canUseContentEditable(element, range) {
    return Boolean(
      element?.isConnected &&
      element.isContentEditable &&
      element.contains(range.commonAncestorContainer)
    );
  }

  function syncVisibleSelectionIfStillFocused(job) {
    const activeElement = getDeepActiveElement(document);

    if (!job.element.contains(activeElement)) {
      return;
    }

    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(job.range.cloneRange());
  }

  function setNativeValue(element, value) {
    const ownDescriptor = Object.getOwnPropertyDescriptor(element, "value");
    const prototype = Object.getPrototypeOf(element);
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    const setter = prototypeDescriptor?.set || ownDescriptor?.set;

    if (setter) {
      setter.call(element, value);
      return;
    }

    element.value = value;
  }

  function createInputEvent(type, options) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        cancelable: Boolean(options.cancelable),
        composed: true,
        data: options.data,
        inputType: options.inputType
      });
    } catch {
      return new Event(type, {
        bubbles: true,
        cancelable: Boolean(options.cancelable)
      });
    }
  }

  function normalizeClipboardText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
})();

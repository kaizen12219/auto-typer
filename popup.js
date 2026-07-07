const DEFAULT_ENABLED = true;

const enabledToggle = document.getElementById("enabled-toggle");
const statusText = document.getElementById("status-text");

init();

async function init() {
  const settings = await chrome.storage.sync.get({
    enabled: DEFAULT_ENABLED
  });

  render(Boolean(settings.enabled));

  enabledToggle.addEventListener("change", async () => {
    const enabled = enabledToggle.checked;
    render(enabled);
    await chrome.storage.sync.set({ enabled });
  });
}

function render(enabled) {
  enabledToggle.checked = enabled;
  statusText.textContent = enabled ? "Enabled" : "Disabled";
}

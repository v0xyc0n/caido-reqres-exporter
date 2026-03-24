import type { Caido } from "@caido/sdk-frontend";
import type { CommandContext } from "@caido/sdk-frontend";
import type { API } from "../../backend/src/index";

// ─── Types ────────────────────────────────────────────────────────────────────

type Pair = {
  requestRaw: string;
  responseRaw: string | null;
  host: string;
  path: string;
};

// ─── HTTP Data Fetching ───────────────────────────────────────────────────────

async function fetchPair(
  sdk: Caido<API>,
  requestId: string,
  knownRequestRaw?: string,
  knownResponseRaw?: string
): Promise<Pair | null> {
  const reqResult = await sdk.graphql.request({ id: requestId });
  const req = reqResult.request;
  if (!req) return null;

  const requestRaw = knownRequestRaw ?? req.raw;
  const host = req.host;
  const path = req.path + (req.query ? `?${req.query}` : "");

  let responseRaw = knownResponseRaw ?? null;
  if (!responseRaw && req.response?.id) {
    const respResult = await sdk.graphql.response({ id: req.response.id });
    responseRaw = respResult.response?.raw ?? null;
  }

  return { requestRaw, responseRaw, host, path };
}

async function pairsFromContext(
  sdk: Caido<API>,
  context: CommandContext
): Promise<Pair[]> {
  if (context.type === "RequestRowContext") {
    if (context.requests.length === 0) return [];
    return Promise.all(
      context.requests.map((r) => fetchPair(sdk, r.id))
    ).then((results) => results.filter((p): p is Pair => p !== null));
  }

  if (context.type === "RequestContext") {
    const req = context.request;
    if (!("id" in req) || !req.id) return [];
    const pair = await fetchPair(sdk, req.id, req.raw);
    return pair ? [pair] : [];
  }

  if (context.type === "ResponseContext") {
    const pair = await fetchPair(
      sdk,
      context.request.id,
      undefined,
      context.response.raw
    );
    return pair ? [pair] : [];
  }

  return [];
}

// ─── HTTP Formatting ──────────────────────────────────────────────────────────

function formatPair(pair: Pair, index?: number, total?: number): string {
  const numbered = index !== undefined && total !== undefined && total > 1;
  const header = numbered
    ? `${"─".repeat(72)}\n[${index + 1}/${total}] ${pair.host}${pair.path}\n${"─".repeat(72)}`
    : "─".repeat(72);
  return [
    header,
    "===== REQUEST =====",
    pair.requestRaw.trimEnd(),
    "",
    "===== RESPONSE =====",
    pair.responseRaw?.trimEnd() ?? "(no response captured)",
  ].join("\n");
}

function formatBundle(pairs: Pair[]): string {
  const ts = new Date().toISOString();
  const header = [
    `# ReqRes Exporter — ${pairs.length} request${pairs.length === 1 ? "" : "s"}`,
    `# Exported: ${ts}`,
    "",
  ].join("\n");
  const bodies = pairs.map((p, i) => formatPair(p, i, pairs.length));
  return header + bodies.join("\n\n") + "\n";
}

function makeFilename(pairs: Pair[]): string {
  const ts = new Date()
    .toISOString()
    .replace("T", "_")
    .replace(/[:.]/g, "-")
    .replace("Z", "");
  if (pairs.length === 1) {
    const safePath = pairs[0].path.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    return `${pairs[0].host}_${safePath}_${ts}.txt`;
  }
  return `reqres_${pairs.length}_requests_${ts}.txt`;
}

// ─── Settings Page ────────────────────────────────────────────────────────────

function buildSettingsPage(sdk: Caido<API>): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "padding: 24px; max-width: 480px; font-family: sans-serif;";

  const heading = document.createElement("h2");
  heading.textContent = "ReqRes Exporter";
  heading.style.cssText = "margin: 0 0 8px; font-size: 18px;";
  root.appendChild(heading);

  const label = document.createElement("label");
  label.textContent = "Output directory";
  label.style.cssText = "display: block; margin-bottom: 6px; font-size: 14px;";
  root.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "e.g. /Users/you/Downloads";
  input.style.cssText =
    "width: 100%; padding: 6px 8px; font-size: 14px; border: 1px solid #555; border-radius: 4px; background: #1e1e1e; color: #eee; box-sizing: border-box;";
  root.appendChild(input);

  const hint = document.createElement("p");
  hint.style.cssText = "margin: 6px 0 16px; font-size: 12px; color: #888;";
  hint.textContent = "Each selected request will be saved as a separate .txt file in this directory.";
  root.appendChild(hint);

  const btn = document.createElement("button");
  btn.textContent = "Save";
  btn.style.cssText =
    "padding: 7px 18px; font-size: 14px; border: none; border-radius: 4px; background: #4f8ef7; color: #fff; cursor: pointer;";
  root.appendChild(btn);

  const status = document.createElement("span");
  status.style.cssText = "margin-left: 12px; font-size: 13px; color: #aaa;";
  root.appendChild(status);

  // Load stored value or fall back to default from backend
  const stored = sdk.storage.get() as string | null;
  if (stored) {
    input.value = stored;
  } else {
    sdk.backend.getDefaultDir().then((dir) => {
      if (!input.value) input.value = dir;
    });
  }

  btn.addEventListener("click", () => {
    const dir = input.value.trim();
    if (!dir) {
      status.textContent = "Please enter a directory.";
      status.style.color = "#f87171";
      return;
    }
    sdk.storage.set(dir);
    status.textContent = "Saved!";
    status.style.color = "#4ade80";
    setTimeout(() => (status.textContent = ""), 2000);
  });

  return root;
}

// ─── HTTP Actions ─────────────────────────────────────────────────────────────

async function cmdCopy(sdk: Caido<API>, context: CommandContext): Promise<void> {
  try {
    const pairs = await pairsFromContext(sdk, context);
    if (pairs.length === 0) {
      sdk.window.showToast("No request selected.", { variant: "warning" });
      return;
    }
    await navigator.clipboard.writeText(formatBundle(pairs));
    const msg =
      pairs.length === 1
        ? "Copied to clipboard!"
        : `Copied ${pairs.length} requests to clipboard!`;
    sdk.window.showToast(msg, { variant: "success" });
  } catch (err) {
    sdk.window.showToast(`Copy failed: ${err}`, { variant: "error" });
  }
}

async function cmdSave(sdk: Caido<API>, context: CommandContext): Promise<void> {
  try {
    let dir = (sdk.storage.get() as string | null) ?? "";
    if (!dir) {
      dir = await sdk.backend.getDefaultDir();
    }

    const pairs = await pairsFromContext(sdk, context);
    if (pairs.length === 0) {
      sdk.window.showToast("No request selected.", { variant: "warning" });
      return;
    }

    const files = pairs.map((pair) => ({
      name: makeFilename([pair]),
      content: formatBundle([pair]),
    }));

    const result = await sdk.backend.saveFiles(dir, files);
    if (!result.ok) {
      sdk.window.showToast(`Save failed: ${result.error}`, { variant: "error" });
      return;
    }

    const msg =
      pairs.length === 1
        ? `Saved 1 file to ${dir}`
        : `Saved ${pairs.length} files to ${dir}`;
    sdk.window.showToast(msg, { variant: "success", duration: 5000 });
  } catch (err) {
    sdk.window.showToast(`Save failed: ${err}`, { variant: "error" });
  }
}

// ─── Plugin Entry Point ───────────────────────────────────────────────────────

export function init(sdk: Caido<API>): void {
  const PAGE_ID = "reqres-exporter-settings";

  sdk.navigation.addPage(PAGE_ID, {
    body: buildSettingsPage(sdk),
  });

  sdk.sidebar.registerItem("ReqRes Exporter", PAGE_ID, {
    icon: "fas fa-file-export",
  });

  sdk.commands.register("copy-reqres", {
    name: "Copy Request & Response",
    run: (ctx) => cmdCopy(sdk, ctx),
    group: "ReqRes Exporter",
  });

  sdk.commands.register("save-reqres", {
    name: "Save Request & Response to File",
    run: (ctx) => cmdSave(sdk, ctx),
    group: "ReqRes Exporter",
  });

  sdk.menu.registerItem({ type: "RequestRow", commandId: "copy-reqres", leadingIcon: "fas fa-copy" });
  sdk.menu.registerItem({ type: "RequestRow", commandId: "save-reqres", leadingIcon: "fas fa-floppy-disk" });
  sdk.menu.registerItem({ type: "Request", commandId: "copy-reqres", leadingIcon: "fas fa-copy" });
  sdk.menu.registerItem({ type: "Request", commandId: "save-reqres", leadingIcon: "fas fa-floppy-disk" });
  sdk.menu.registerItem({ type: "Response", commandId: "copy-reqres", leadingIcon: "fas fa-copy" });
  sdk.menu.registerItem({ type: "Response", commandId: "save-reqres", leadingIcon: "fas fa-floppy-disk" });
}

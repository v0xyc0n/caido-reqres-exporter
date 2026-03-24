import type { Caido } from "@caido/sdk-frontend";
import type { CommandContext } from "@caido/sdk-frontend";

// ─── Types ────────────────────────────────────────────────────────────────────

type Pair = {
  requestRaw: string;
  responseRaw: string | null;
  host: string;
  path: string;
};

// ─── HTTP Data Fetching ───────────────────────────────────────────────────────

async function fetchPair(
  sdk: Caido,
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
  sdk: Caido,
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

// ─── HTTP Actions ─────────────────────────────────────────────────────────────

async function cmdCopy(sdk: Caido, context: CommandContext): Promise<void> {
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

async function cmdSave(sdk: Caido, context: CommandContext): Promise<void> {
  try {
    const pairs = await pairsFromContext(sdk, context);
    if (pairs.length === 0) {
      sdk.window.showToast("No request selected.", { variant: "warning" });
      return;
    }

    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch {
      return;
    }

    for (const pair of pairs) {
      const fileHandle = await dirHandle.getFileHandle(makeFilename([pair]), { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(formatBundle([pair]));
      await writable.close();
    }

    const msg =
      pairs.length === 1 ? "Saved to file!" : `Saved ${pairs.length} files!`;
    sdk.window.showToast(msg, { variant: "success" });
  } catch (err) {
    sdk.window.showToast(`Save failed: ${err}`, { variant: "error" });
  }
}

// ─── Plugin Entry Point ───────────────────────────────────────────────────────

export function init(sdk: Caido): void {
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

  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: "copy-reqres",
    leadingIcon: "fas fa-copy",
  });
  sdk.menu.registerItem({
    type: "RequestRow",
    commandId: "save-reqres",
    leadingIcon: "fas fa-floppy-disk",
  });
  sdk.menu.registerItem({
    type: "Request",
    commandId: "copy-reqres",
    leadingIcon: "fas fa-copy",
  });
  sdk.menu.registerItem({
    type: "Request",
    commandId: "save-reqres",
    leadingIcon: "fas fa-floppy-disk",
  });
  sdk.menu.registerItem({
    type: "Response",
    commandId: "copy-reqres",
    leadingIcon: "fas fa-copy",
  });
  sdk.menu.registerItem({
    type: "Response",
    commandId: "save-reqres",
    leadingIcon: "fas fa-floppy-disk",
  });
}

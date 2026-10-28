export type Pair = {
  requestRaw: string;
  responseRaw: string | null;
  host: string;
  path: string;
};

export type Format = {
  excludeHeaders: string[];
  requestLabel: string;
  responseLabel: string;
  separator: string;
  showRequestLabel: boolean;
  showResponseLabel: boolean;
  showSeparator: boolean;
  showBundleHeader: boolean;
  showTimestamp: boolean;
  showNumbering: boolean;
};

export type Template = Format & { id: string; name: string };

export type RenderOptions = {
  headersOnly?: boolean;
};

const NO_RESPONSE_TEXT = "(no response captured)";

export const DEFAULT_FORMAT: Format = {
  excludeHeaders: [],
  requestLabel: "===== REQUEST =====",
  responseLabel: "===== RESPONSE =====",
  separator: "─".repeat(72),
  showRequestLabel: true,
  showResponseLabel: true,
  showSeparator: true,
  showBundleHeader: true,
  showTimestamp: true,
  showNumbering: true,
};

export const INITIAL_TEMPLATES: Template[] = [
  {
    ...DEFAULT_FORMAT,
    id: "natural",
    name: "Natural",
    showRequestLabel: false,
    showResponseLabel: false,
    showSeparator: false,
    showBundleHeader: false,
    showTimestamp: false,
    showNumbering: false,
  },
  { ...DEFAULT_FORMAT, id: "full", name: "Full" },
];

// ─── HTTP Message Processing ──────────────────────────────────────────────────

type Message = { head: string; eol: string; body: string };

function splitMessage(raw: string): Message | null {
  for (const eol of ["\r\n", "\n"]) {
    const idx = raw.indexOf(eol + eol);
    if (idx !== -1) {
      return { head: raw.slice(0, idx), eol, body: raw.slice(idx + eol.length * 2) };
    }
  }
  return null;
}

function headerName(line: string): string | null {
  const colon = line.indexOf(":");
  return colon === -1 ? null : line.slice(0, colon).trim().toLowerCase();
}

function headerValue(msg: Message, name: string): string | null {
  for (const line of msg.head.split(msg.eol).slice(1)) {
    if (headerName(line) === name) return line.slice(line.indexOf(":") + 1).trim();
  }
  return null;
}

function filterHeaders(msg: Message, exclude: string[]): string {
  const excludeSet = new Set(exclude.map((h) => h.trim().toLowerCase()).filter(Boolean));
  if (excludeSet.size === 0) return msg.head;
  const [startLine, ...headers] = msg.head.split(msg.eol);
  const kept = headers.filter((line) => !excludeSet.has(headerName(line) ?? ""));
  return [startLine, ...kept].join(msg.eol);
}

function looksBinary(body: string): boolean {
  const len = Math.min(body.length, 4096);
  let bad = 0;
  for (let i = 0; i < len; i++) {
    const c = body.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) bad++;
  }
  return len > 0 && bad / len > 0.1;
}

// Re-indents textually instead of JSON.stringify(JSON.parse(...)) so numbers beyond
// double precision (e.g. 64-bit IDs) and duplicate keys survive unchanged.
export function prettyJson(body: string): string {
  const text = body.trim();
  if (!/^[[{]/.test(text)) return body;
  try {
    JSON.parse(text);
  } catch {
    return body;
  }

  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => "\n" + "  ".repeat(depth);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inString = false;
      continue;
    }
    switch (c) {
      case '"':
        inString = true;
        out += c;
        break;
      case "{":
      case "[": {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === "}" || text[j] === "]") {
          out += c + text[j];
          i = j;
        } else {
          depth++;
          out += c + newline();
        }
        break;
      }
      case "}":
      case "]":
        depth--;
        out += newline() + c;
        break;
      case ",":
        out += "," + newline();
        break;
      case ":":
        out += ": ";
        break;
      case " ":
      case "\t":
      case "\n":
      case "\r":
        break;
      default:
        out += c;
    }
  }
  return out;
}

function renderBody(msg: Message): string {
  const encoding = headerValue(msg, "content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    return `(compressed body omitted: ${encoding})`;
  }
  if (looksBinary(msg.body)) return "(binary body omitted)";
  return prettyJson(msg.body);
}

export function processMessage(raw: string, format: Format, headersOnly: boolean): string {
  const msg = splitMessage(raw);
  if (!msg) return raw.trimEnd();
  const head = filterHeaders(msg, format.excludeHeaders);
  if (headersOnly || msg.body.trim() === "") return head;
  return head + msg.eol + msg.eol + renderBody(msg).trimEnd();
}

// ─── Output ───────────────────────────────────────────────────────────────────

function formatPair(
  pair: Pair,
  format: Format,
  opts: RenderOptions,
  index: number,
  total: number
): string {
  const headersOnly = opts.headersOnly ?? false;
  const separator = format.showSeparator && format.separator ? format.separator : null;
  const lines: string[] = [];

  if (separator) lines.push(separator);
  if (format.showNumbering && total > 1) {
    lines.push(`[${index + 1}/${total}] ${pair.host}${pair.path}`);
    if (separator) lines.push(separator);
  }

  if (format.showRequestLabel && format.requestLabel) lines.push(format.requestLabel);
  lines.push(processMessage(pair.requestRaw, format, headersOnly));
  lines.push("");
  if (format.showResponseLabel && format.responseLabel) lines.push(format.responseLabel);
  lines.push(
    pair.responseRaw ? processMessage(pair.responseRaw, format, headersOnly) : NO_RESPONSE_TEXT
  );

  return lines.join("\n");
}

export function formatBundle(pairs: Pair[], format: Format, opts: RenderOptions = {}): string {
  const header: string[] = [];
  if (format.showBundleHeader) {
    header.push(`# ReqRes Exporter — ${pairs.length} request${pairs.length === 1 ? "" : "s"}`);
  }
  if (format.showTimestamp) header.push(`# Exported: ${new Date().toISOString()}`);
  if (header.length > 0) header.push("");

  const bodies = pairs.map((p, i) => formatPair(p, format, opts, i, pairs.length));
  // Lone surrogates make Caido's frontend→backend bridge reject the string on save.
  return (header.join("\n") + bodies.join("\n\n") + "\n").toWellFormed();
}

export const LARGE_OUTPUT_BYTES = 1024 * 1024;

export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function makeFilenames(pairs: Pair[]): string[] {
  const ts = new Date().toISOString().replace("T", "_").replace(/[:.]/g, "-").replace("Z", "");
  const used = new Set<string>();
  return pairs.map((pair) => {
    const safeHost = pair.host.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safePath = pair.path.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    const base = `${safeHost}_${safePath}_${ts}`;
    let name = `${base}.txt`;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}.txt`;
    used.add(name);
    return name;
  });
}

export function templateSummary(format: Format): string {
  const parts: string[] = [];
  if (format.excludeHeaders.length > 0) {
    parts.push(`Excludes: ${format.excludeHeaders.join(", ")}`);
  }

  const features: string[] = [];
  if (format.showRequestLabel || format.showResponseLabel) features.push("request/response labels");
  if (format.showSeparator) features.push("separator");
  if (format.showBundleHeader) features.push("bundle header");
  if (format.showTimestamp) features.push("timestamp");
  if (format.showNumbering) features.push("numbering");

  if (features.length === 0) {
    parts.push("No decoration, complete request/response");
  } else {
    const desc = [...features, "complete request/response"].join(", ");
    parts.push(desc.charAt(0).toUpperCase() + desc.slice(1));
  }
  return parts.join(" · ");
}

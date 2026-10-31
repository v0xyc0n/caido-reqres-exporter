import type { Caido, CommandContext } from "@caido/sdk-frontend";
import type { API } from "../../backend/src/index";
import { defineComponent, h, type PropType } from "vue";
import {
  DEFAULT_FORMAT,
  INITIAL_TEMPLATES,
  LARGE_OUTPUT_BYTES,
  byteSize,
  formatBundle,
  formatBytes,
  makeFilenames,
  templateSummary,
  type Format,
  type Pair,
  type RenderOptions,
  type Template,
} from "./format";
import { mapWithLimit } from "./util";

type StorageData = {
  outputDir: string;
  defaultTemplate: Format;
  templates: Template[];
};

const MAX_TEMPLATES = 10;
const MANY_REQUESTS = 5;
const FETCH_CONCURRENCY = 8;

// Caido's own theme variables, so the page always matches the app's theme.
const COLOR = {
  bg: "var(--c-bg-default)",
  bgSubtle: "var(--c-bg-subtle)",
  bgInset: "var(--c-bg-inset)",
  fg: "var(--c-fg-default)",
  fgSubtle: "var(--c-fg-subtle)",
  border: "var(--c-border-default)",
  accent: "var(--c-bg-secondary)",
  accentBorder: "var(--c-border-secondary)",
  success: "var(--c-fg-success)",
  danger: "var(--c-fg-danger)",
};

const CSS = {
  INPUT: `width:100%;padding:6px 8px;font-size:14px;border:1px solid ${COLOR.border};border-radius:4px;background:${COLOR.bg};color:${COLOR.fg};box-sizing:border-box;`,
  BTN: "padding:7px 18px;font-size:14px;border:none;border-radius:4px;cursor:pointer;",
  BTN_PRIMARY: `background:${COLOR.accent};color:${COLOR.bg};`,
  BTN_NEUTRAL: `background:transparent;color:${COLOR.fg};border:1px solid ${COLOR.border};`,
  LABEL: `display:block;margin-bottom:4px;font-size:13px;color:${COLOR.fgSubtle};`,
  HINT: `margin:4px 0 0;font-size:12px;color:${COLOR.fgSubtle};`,
  CARD: `border:1px solid ${COLOR.border};border-radius:6px;padding:12px 14px;margin-bottom:8px;background:${COLOR.bgSubtle};`,
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function freshStorage(): StorageData {
  return {
    outputDir: "",
    defaultTemplate: { ...DEFAULT_FORMAT },
    templates: INITIAL_TEMPLATES.map((t) => ({ ...t })),
  };
}

function loadStorage(sdk: Caido<API>): StorageData {
  const raw = sdk.storage.get();
  // v1.0.x stored only the output directory as a plain string.
  if (typeof raw === "string") return { ...freshStorage(), outputDir: raw };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return freshStorage();

  const data = raw as unknown as Partial<StorageData>;
  return {
    outputDir: data.outputDir ?? "",
    defaultTemplate: { ...DEFAULT_FORMAT, ...data.defaultTemplate },
    templates: Array.isArray(data.templates)
      ? data.templates.map((t) => ({ ...DEFAULT_FORMAT, ...t }))
      : INITIAL_TEMPLATES.map((t) => ({ ...t })),
  };
}

async function persistStorage(sdk: Caido<API>, data: StorageData): Promise<void> {
  await sdk.storage.set(data);
}

// ─── HTTP Data Fetching ───────────────────────────────────────────────────────

async function fetchPair(
  sdk: Caido<API>,
  requestId: string,
  knownRequestRaw?: string,
  knownResponseRaw?: string
): Promise<Pair | null> {
  const { request: req } = await sdk.graphql.request({ id: requestId });
  if (!req) return null;

  let responseRaw = knownResponseRaw ?? null;
  if (!responseRaw && req.response?.id) {
    const { response } = await sdk.graphql.response({ id: req.response.id });
    responseRaw = response?.raw ?? null;
  }

  return {
    requestRaw: knownRequestRaw ?? req.raw,
    responseRaw,
    host: req.host,
    path: req.path + (req.query ? `?${req.query}` : ""),
  };
}

/**
 * Request ids selected on the current page. Keyboard shortcuts run commands
 * with a bare `BaseContext`, so the selection has to be recovered from the
 * global page context instead.
 */
function selectedIdsFromPage(sdk: Caido<API>): string[] {
  let page;
  try {
    page = sdk.window.getContext().page;
  } catch {
    return [];
  }
  if (page === undefined) return [];

  const selection =
    page.kind === "HTTPHistory"
      ? page.selection
      : page.kind === "Sitemap"
        ? page.requestSelection
        : undefined;

  if (selection === undefined || selection.kind !== "Selected") return [];
  return [selection.main, ...selection.secondary];
}

async function pairsFromContext(sdk: Caido<API>, context: CommandContext): Promise<Pair[]> {
  let pairs: (Pair | null)[] = [];
  if (context.type === "RequestRowContext") {
    pairs = await mapWithLimit(context.requests, FETCH_CONCURRENCY, (r) => fetchPair(sdk, r.id));
  } else if (context.type === "BaseContext") {
    pairs = await mapWithLimit(selectedIdsFromPage(sdk), FETCH_CONCURRENCY, (id) => fetchPair(sdk, id));
  } else if (context.type === "RequestContext") {
    const req = context.request;
    if ("id" in req && req.id) pairs = [await fetchPair(sdk, req.id, req.raw)];
  } else if (context.type === "ResponseContext") {
    pairs = [await fetchPair(sdk, context.request.id, undefined, context.response.raw)];
  }
  return pairs.filter((p): p is Pair => p !== null);
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function mkInput(value: string, placeholder?: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.value = value;
  if (placeholder) el.placeholder = placeholder;
  el.style.cssText = CSS.INPUT;
  return el;
}

function mkLabel(text: string): HTMLLabelElement {
  const el = document.createElement("label");
  el.textContent = text;
  el.style.cssText = CSS.LABEL;
  return el;
}

function mkCheck(label: string, checked: boolean): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement("label");
  wrap.style.cssText = `display:flex;align-items:center;gap:8px;font-size:14px;color:${COLOR.fg};cursor:pointer;margin-bottom:6px;`;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(label));
  return { wrap, input };
}

function mkBtn(text: string, extra: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = text;
  el.style.cssText = CSS.BTN + extra;
  return el;
}

function mkGroup(...children: HTMLElement[]): HTMLDivElement {
  const div = document.createElement("div");
  div.style.cssText = "margin-bottom:12px;";
  for (const c of children) div.appendChild(c);
  return div;
}

function mkHr(): HTMLHRElement {
  const hr = document.createElement("hr");
  hr.style.cssText = `border:none;border-top:1px solid ${COLOR.border};margin:20px 0;`;
  return hr;
}

function mkHeading(text: string): HTMLHeadingElement {
  const el = document.createElement("h3");
  el.textContent = text;
  el.style.cssText = `margin:0 0 4px;font-size:15px;color:${COLOR.fg};`;
  return el;
}

function mkHint(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText = CSS.HINT + "margin-bottom:12px;";
  return p;
}

function mkSectionLabel(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `font-size:13px;color:${COLOR.fgSubtle};margin-bottom:6px;font-weight:600;`;
  return el;
}

function mkCollapsible(title: string, extraSummaryCss = ""): HTMLDetailsElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = title;
  summary.style.cssText =
    `font-size:13px;color:${COLOR.fgSubtle};font-weight:600;cursor:pointer;margin-bottom:6px;user-select:none;` +
    extraSummaryCss;
  details.appendChild(summary);
  return details;
}

function mkStatusRow(
  btnLabel: string,
  onClick: (status: HTMLSpanElement) => void | Promise<void>
): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:12px;";
  const btn = mkBtn(btnLabel, CSS.BTN_PRIMARY);
  const status = document.createElement("span");
  status.style.cssText = `font-size:13px;color:${COLOR.fgSubtle};`;
  btn.addEventListener("click", () => onClick(status));
  row.appendChild(btn);
  row.appendChild(status);
  return row;
}

function flashStatus(el: HTMLSpanElement, msg: string, ok: boolean): void {
  el.textContent = msg;
  el.style.color = ok ? COLOR.success : COLOR.danger;
  if (ok) setTimeout(() => (el.textContent = ""), 2000);
}

function mkChip(text: string, onRemove: () => void): HTMLElement {
  const chip = document.createElement("span");
  chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font-size:13px;border:1px solid ${COLOR.border};border-radius:12px;background:${COLOR.bgInset};color:${COLOR.fg};`;
  chip.appendChild(document.createTextNode(text));
  const x = document.createElement("span");
  x.textContent = "×";
  x.style.cssText = `cursor:pointer;color:${COLOR.fgSubtle};font-size:15px;line-height:1;`;
  x.addEventListener("click", onRemove);
  chip.appendChild(x);
  return chip;
}

function mkIconBtn(iconClass: string, title: string): HTMLElement {
  const el = document.createElement("i");
  el.className = iconClass;
  el.title = title;
  el.style.cssText = `cursor:pointer;color:${COLOR.fgSubtle};font-size:13px;padding:2px;`;
  el.addEventListener("mouseenter", () => (el.style.color = COLOR.fg));
  el.addEventListener("mouseleave", () => (el.style.color = COLOR.fgSubtle));
  return el;
}

// ─── Format Editor ────────────────────────────────────────────────────────────

function buildFormatFields(format: Format): {
  container: HTMLElement;
  getValues: () => Format;
} {
  let excluded = [...format.excludeHeaders];
  const container = document.createElement("div");

  // Exclude headers
  container.appendChild(mkSectionLabel("Exclude Headers"));

  const chipBox = document.createElement("div");
  chipBox.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:24px;";

  function renderChips() {
    chipBox.replaceChildren();
    if (excluded.length === 0) {
      const none = document.createElement("span");
      none.textContent = "(none)";
      none.style.cssText = `font-size:13px;color:${COLOR.fgSubtle};font-style:italic;`;
      chipBox.appendChild(none);
      return;
    }
    for (const hdr of excluded) {
      chipBox.appendChild(
        mkChip(hdr, () => {
          excluded = excluded.filter((h) => h !== hdr);
          renderChips();
        })
      );
    }
  }
  container.appendChild(chipBox);

  const addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:6px;margin-bottom:16px;";
  const addInput = mkInput("", "Header name");
  addInput.style.flex = "1";
  const addBtn = mkBtn("+", CSS.BTN_NEUTRAL + "padding:6px 14px;");
  const doAdd = () => {
    const name = addInput.value.trim();
    if (name && !excluded.some((h) => h.toLowerCase() === name.toLowerCase())) {
      excluded.push(name);
      renderChips();
    }
    addInput.value = "";
  };
  addBtn.addEventListener("click", doAdd);
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doAdd();
    }
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
  renderChips();

  // Format (collapsed)
  const formatDetails = mkCollapsible("Format");
  container.appendChild(formatDetails);

  function mkToggleInput(label: string, checked: boolean, value: string) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;

    const lbl = document.createElement("label");
    lbl.style.cssText =
      `display:flex;align-items:center;gap:8px;font-size:13px;color:${COLOR.fgSubtle};min-width:130px;cursor:pointer;`;
    lbl.appendChild(checkbox);
    lbl.appendChild(document.createTextNode(label));

    const input = mkInput(value);
    input.style.flex = "1";
    const sync = () => {
      input.disabled = !checkbox.checked;
      input.style.opacity = checkbox.checked ? "1" : "0.4";
    };
    checkbox.addEventListener("change", sync);
    sync();

    row.appendChild(lbl);
    row.appendChild(input);
    formatDetails.appendChild(row);
    return { checkbox, input };
  }

  const reqLabel = mkToggleInput("Request label", format.showRequestLabel, format.requestLabel);
  const respLabel = mkToggleInput("Response label", format.showResponseLabel, format.responseLabel);
  const sep = mkToggleInput("Separator", format.showSeparator, format.separator);

  // Options (collapsed)
  const optDetails = mkCollapsible("Options", "margin-top:8px;");
  optDetails.style.marginBottom = "16px";
  container.appendChild(optDetails);

  const optGrid = document.createElement("div");
  optGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:4px;";
  const bundleCheck = mkCheck("Show bundle header", format.showBundleHeader);
  const timestampCheck = mkCheck("Show timestamp", format.showTimestamp);
  const numberingCheck = mkCheck("Show numbering for multiple", format.showNumbering);
  optGrid.append(bundleCheck.wrap, timestampCheck.wrap, numberingCheck.wrap);
  optDetails.appendChild(optGrid);

  return {
    container,
    getValues: () => ({
      excludeHeaders: [...excluded],
      requestLabel: reqLabel.input.value,
      responseLabel: respLabel.input.value,
      separator: sep.input.value,
      showRequestLabel: reqLabel.checkbox.checked,
      showResponseLabel: respLabel.checkbox.checked,
      showSeparator: sep.checkbox.checked,
      showBundleHeader: bundleCheck.input.checked,
      showTimestamp: timestampCheck.input.checked,
      showNumbering: numberingCheck.input.checked,
    }),
  };
}

// ─── Settings Page ────────────────────────────────────────────────────────────

function buildOutputDirSection(sdk: Caido<API>): HTMLElement {
  const section = document.createElement("div");
  section.appendChild(mkHeading("Output Directory"));

  const input = mkInput("", "e.g. /Users/you/Downloads");
  section.appendChild(input);
  section.appendChild(mkHint("Files will be saved to this directory."));

  const { outputDir } = loadStorage(sdk);
  if (outputDir) {
    input.value = outputDir;
  } else {
    sdk.backend.getDefaultDir().then((dir: string) => {
      if (!input.value) input.value = dir;
    });
  }

  section.appendChild(
    mkStatusRow("Save", async (status) => {
      const dir = input.value.trim();
      if (!dir) return flashStatus(status, "Please enter a directory.", false);
      const s = loadStorage(sdk);
      s.outputDir = dir;
      await persistStorage(sdk, s);
      flashStatus(status, "Saved!", true);
    })
  );
  return section;
}

function buildDefaultFormatSection(sdk: Caido<API>): HTMLElement {
  const section = document.createElement("div");
  section.appendChild(mkHeading("Default Format"));
  section.appendChild(mkHint("Customize the format used by the default Copy and Save commands."));

  const fields = buildFormatFields(loadStorage(sdk).defaultTemplate);
  section.appendChild(fields.container);

  section.appendChild(
    mkStatusRow("Save Format", async (status) => {
      const s = loadStorage(sdk);
      s.defaultTemplate = fields.getValues();
      await persistStorage(sdk, s);
      flashStatus(status, "Saved!", true);
    })
  );
  return section;
}

function buildTemplateCard(
  tmpl: Template,
  handlers: { onEdit: () => void; onDelete: () => void; onMakeDefault: () => Promise<void> }
): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = CSS.CARD + "display:flex;align-items:center;gap:12px;cursor:pointer;";
  card.title = "Edit";
  card.addEventListener("click", handlers.onEdit);

  const left = document.createElement("div");
  left.style.cssText = "flex:1;min-width:0;";

  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display:flex;align-items:center;gap:10px;";

  const name = document.createElement("strong");
  name.textContent = tmpl.name;
  name.style.cssText = `font-size:14px;color:${COLOR.fg};`;

  const editIcon = mkIconBtn("fas fa-pen", "Edit");

  const delIcon = mkIconBtn("fas fa-trash", "Delete");
  delIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`Delete template "${tmpl.name}"?`)) handlers.onDelete();
  });

  nameRow.append(name, editIcon, delIcon);
  left.appendChild(nameRow);

  const info = document.createElement("div");
  info.style.cssText = `font-size:12px;color:${COLOR.fgSubtle};margin-top:2px;`;
  info.textContent = templateSummary(tmpl);
  left.appendChild(info);
  card.appendChild(left);

  const right = document.createElement("div");
  right.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;";
  const defaultBtn = mkBtn(
    "Make Default",
    CSS.BTN_NEUTRAL + "padding:5px 14px;font-size:13px;white-space:nowrap;"
  );
  const defaultStatus = document.createElement("span");
  defaultStatus.style.cssText = "font-size:12px;white-space:nowrap;";
  defaultBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await handlers.onMakeDefault();
    flashStatus(defaultStatus, "Applied!", true);
  });
  right.append(defaultBtn, defaultStatus);
  card.appendChild(right);

  return card;
}

function buildTemplateEditor(
  sdk: Caido<API>,
  existing: Template | null,
  onDone: () => void
): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = CSS.CARD + `border-color:${COLOR.accentBorder};`;

  const nameInput = mkInput(existing?.name ?? "", "Template name");
  card.appendChild(mkGroup(mkLabel("Name"), nameInput));

  const fields = buildFormatFields(existing ?? DEFAULT_FORMAT);
  card.appendChild(fields.container);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;";
  const saveBtn = mkBtn(existing ? "Save" : "Add", CSS.BTN_PRIMARY);
  const cancelBtn = mkBtn("Cancel", CSS.BTN_NEUTRAL);
  const status = document.createElement("span");
  status.style.cssText = "font-size:13px;";

  cancelBtn.addEventListener("click", onDone);
  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) return flashStatus(status, "Name is required.", false);

    const s = loadStorage(sdk);
    const id = existing?.id ?? crypto.randomUUID();
    const updated: Template = { ...fields.getValues(), id, name };
    const idx = s.templates.findIndex((t) => t.id === id);
    if (idx >= 0) s.templates[idx] = updated;
    else s.templates.push(updated);

    await persistStorage(sdk, s);
    onDone();
  });

  row.append(saveBtn, cancelBtn, status);
  card.appendChild(row);
  return card;
}

function buildTemplatesSection(sdk: Caido<API>, onDefaultChanged: () => void): HTMLElement {
  const section = document.createElement("div");
  section.appendChild(mkHeading("Templates"));
  section.appendChild(mkHint('Templates are available via "Copy with Template" in the right-click menu.'));

  const addBtn = mkBtn("+ Add Template", CSS.BTN_NEUTRAL);
  section.appendChild(addBtn);

  const list = document.createElement("div");
  list.style.cssText = "margin-top:12px;";
  section.appendChild(list);

  let editingId: string | null = null;
  const NEW = "__new__";
  const stopEditing = () => {
    editingId = null;
    render();
  };

  function render() {
    list.replaceChildren();
    const { templates } = loadStorage(sdk);

    if (editingId === NEW) list.appendChild(buildTemplateEditor(sdk, null, stopEditing));

    for (const tmpl of templates) {
      if (editingId === tmpl.id) {
        list.appendChild(buildTemplateEditor(sdk, tmpl, stopEditing));
        continue;
      }
      list.appendChild(
        buildTemplateCard(tmpl, {
          onEdit: () => {
            editingId = tmpl.id;
            render();
          },
          onDelete: async () => {
            const s = loadStorage(sdk);
            s.templates = s.templates.filter((t) => t.id !== tmpl.id);
            await persistStorage(sdk, s);
            render();
          },
          onMakeDefault: async () => {
            const { id: _id, name: _name, ...format } = tmpl;
            const s = loadStorage(sdk);
            s.defaultTemplate = format;
            await persistStorage(sdk, s);
            onDefaultChanged();
          },
        })
      );
    }

    addBtn.style.display = templates.length >= MAX_TEMPLATES ? "none" : "";
  }

  addBtn.addEventListener("click", () => {
    editingId = NEW;
    render();
  });

  render();
  return section;
}

function buildSettingsPage(sdk: Caido<API>): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText =
    `padding:24px;max-width:1100px;margin:0 auto;color:${COLOR.fg};overflow-y:auto;height:100%;box-sizing:border-box;`;

  const title = document.createElement("h2");
  title.textContent = "ReqRes Exporter";
  title.style.cssText = `margin:0 0 20px;font-size:18px;color:${COLOR.fg};`;
  root.appendChild(title);

  root.appendChild(buildOutputDirSection(sdk));
  root.appendChild(mkHr());

  const defaultFormatWrap = document.createElement("div");
  const renderDefaultFormat = () => defaultFormatWrap.replaceChildren(buildDefaultFormatSection(sdk));
  renderDefaultFormat();
  root.appendChild(defaultFormatWrap);

  root.appendChild(mkHr());
  root.appendChild(buildTemplatesSection(sdk, renderDefaultFormat));
  return root;
}

// ─── Template Picker ──────────────────────────────────────────────────────────

const TemplatePicker = defineComponent({
  props: {
    templates: { type: Array as PropType<Template[]>, required: true },
  },
  emits: ["select"],
  setup(props, { emit }) {
    return () =>
      h(
        "div",
        { style: "display:flex;flex-direction:column;gap:8px;min-width:280px;" },
        props.templates.map((t) =>
          h(
            "button",
            {
              onClick: () => emit("select", t),
              style:
                `padding:10px 14px;font-size:14px;border:1px solid ${COLOR.border};border-radius:6px;background:${COLOR.bgSubtle};color:${COLOR.fg};cursor:pointer;text-align:left;`,
            },
            [
              h("div", { style: "font-weight:600;" }, t.name),
              h("div", { style: `font-size:12px;color:${COLOR.fgSubtle};margin-top:2px;` }, templateSummary(t)),
            ]
          )
        )
      );
  },
});

// ─── Commands ─────────────────────────────────────────────────────────────────

function confirmManyRequests(sdk: Caido<API>, context: CommandContext): boolean {
  let count = 1;
  if (context.type === "RequestRowContext") count = context.requests.length;
  else if (context.type === "BaseContext") count = selectedIdsFromPage(sdk).length;
  if (count <= MANY_REQUESTS) return true;
  return confirm(`You selected ${count} requests. Continue?`);
}

function confirmLargeOutput(bytes: number): boolean {
  if (bytes <= LARGE_OUTPUT_BYTES) return true;
  return confirm(
    `This export is ${formatBytes(bytes)}. Very large exports can freeze the app you paste or open them in. Continue?`
  );
}

async function cmdCopy(
  sdk: Caido<API>,
  context: CommandContext,
  format: Format,
  opts: RenderOptions = {}
): Promise<void> {
  if (!confirmManyRequests(sdk, context)) return;
  try {
    const pairs = await pairsFromContext(sdk, context);
    if (pairs.length === 0) {
      sdk.window.showToast("No request selected.", { variant: "warning" });
      return;
    }
    const text = formatBundle(pairs, format, opts);
    if (!confirmLargeOutput(byteSize(text))) return;
    await navigator.clipboard.writeText(text);
    const msg =
      pairs.length === 1 ? "Copied to clipboard!" : `Copied ${pairs.length} requests to clipboard!`;
    sdk.window.showToast(msg, { variant: "success" });
  } catch (err) {
    sdk.window.showToast(`Copy failed: ${err}`, { variant: "error" });
  }
}

async function cmdSave(sdk: Caido<API>, context: CommandContext, format: Format): Promise<void> {
  if (!confirmManyRequests(sdk, context)) return;
  try {
    const dir = loadStorage(sdk).outputDir || (await sdk.backend.getDefaultDir());

    const pairs = await pairsFromContext(sdk, context);
    if (pairs.length === 0) {
      sdk.window.showToast("No request selected.", { variant: "warning" });
      return;
    }

    const names = makeFilenames(pairs);
    const files = pairs.map((pair, i) => ({
      name: names[i],
      content: formatBundle([pair], format),
    }));
    if (!confirmLargeOutput(files.reduce((sum, f) => sum + byteSize(f.content), 0))) return;

    const result = await sdk.backend.saveFiles(dir, files);
    if (!result.ok) {
      sdk.window.showToast(`Save failed: ${result.error}`, { variant: "error" });
      return;
    }

    const msg = pairs.length === 1 ? `Saved 1 file to ${dir}` : `Saved ${pairs.length} files to ${dir}`;
    sdk.window.showToast(msg, { variant: "success", duration: 5000 });
  } catch (err) {
    sdk.window.showToast(`Save failed: ${err}`, { variant: "error" });
  }
}

function cmdCopyWithTemplate(sdk: Caido<API>, context: CommandContext): Promise<void> | void {
  const { templates } = loadStorage(sdk);
  if (templates.length === 0) {
    sdk.window.showToast("No templates configured. Add one in ReqRes Exporter settings.", {
      variant: "info",
    });
    return;
  }
  if (templates.length === 1) return cmdCopy(sdk, context, templates[0]);

  const dialog = sdk.window.showDialog(
    {
      component: TemplatePicker,
      props: { templates },
      events: {
        select: (...args: unknown[]) => {
          dialog.close();
          cmdCopy(sdk, context, args[0] as Template);
        },
      },
    },
    { title: "Select Template", modal: true }
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

type MenuType = "RequestRow" | "Request" | "Response";
const ALL_MENUS: MenuType[] = ["RequestRow", "Request", "Response"];

/** Caido binds its own shortcuts to Cmd on macOS and Ctrl everywhere else. */
function primaryModifier(): string {
  try {
    const platform = `${navigator.platform} ${navigator.userAgent}`;
    return /mac/i.test(platform) ? "Meta" : "Control";
  } catch {
    return "Control";
  }
}

export function init(sdk: Caido<API>): void {
  const PAGE_ID = "reqres-exporter-settings";
  sdk.navigation.addPage(PAGE_ID, { body: buildSettingsPage(sdk) });
  sdk.sidebar.registerItem("ReqRes Exporter", PAGE_ID, { icon: "fas fa-file-export" });

  const defaultFormat = () => loadStorage(sdk).defaultTemplate;

  // Registration order is menu order.
  const commands: {
    id: string;
    name: string;
    icon: string;
    menus: MenuType[];
    run: (ctx: CommandContext) => Promise<void> | void;
  }[] = [
    {
      id: "copy-reqres",
      name: "Copy Request & Response",
      icon: "fas fa-copy",
      menus: ALL_MENUS,
      run: (ctx) => cmdCopy(sdk, ctx, defaultFormat()),
    },
    {
      id: "copy-headers-only",
      name: "Copy Headers Only",
      icon: "fas fa-heading",
      menus: ALL_MENUS,
      run: (ctx) => cmdCopy(sdk, ctx, defaultFormat(), { headersOnly: true }),
    },
    {
      id: "copy-with-template",
      name: "Copy with Template",
      icon: "fas fa-layer-group",
      menus: ALL_MENUS,
      run: (ctx) => cmdCopyWithTemplate(sdk, ctx),
    },
    {
      id: "save-reqres",
      name: "Save Request & Response to File",
      icon: "fas fa-floppy-disk",
      menus: ALL_MENUS,
      run: (ctx) => cmdSave(sdk, ctx, defaultFormat()),
    },
  ];

  for (const cmd of commands) {
    sdk.commands.register(cmd.id, { name: cmd.name, run: cmd.run, group: "ReqRes Exporter" });
    for (const type of cmd.menus) {
      sdk.menu.registerItem({ type, commandId: cmd.id, leadingIcon: cmd.icon });
    }
  }

  // Registered after the command: Caido ignores a shortcut for an unknown
  // command id. It only sets a default — an existing user binding is kept.
  sdk.shortcuts.register("copy-reqres", [primaryModifier(), "Shift", "C"]);
}

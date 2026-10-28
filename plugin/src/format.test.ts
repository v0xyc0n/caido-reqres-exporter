import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FORMAT,
  INITIAL_TEMPLATES,
  byteSize,
  formatBundle,
  formatBytes,
  makeFilenames,
  prettyJson,
  processMessage,
  templateSummary,
  type Pair,
} from "./format.ts";

const [NATURAL, FULL] = INITIAL_TEMPLATES;

const REQUEST =
  'POST /a HTTP/1.1\r\nHost: x\r\nCookie: s=1\r\nContent-Type: application/json\r\n\r\n{"a":1}';
const pair: Pair = {
  requestRaw: REQUEST,
  responseRaw: "HTTP/1.1 204 No Content\r\n\r\n",
  host: "x",
  path: "/a",
};

test("prettyJson keeps numbers beyond double precision", () => {
  const out = prettyJson('{"id":12345678901234567890}');
  assert.equal(out, '{\n  "id": 12345678901234567890\n}');
});

test("prettyJson leaves structural characters inside strings alone", () => {
  const out = prettyJson('{"s":"a,b:{c}\\"x"}');
  assert.equal(out, '{\n  "s": "a,b:{c}\\"x"\n}');
});

test("prettyJson keeps empty containers compact", () => {
  assert.equal(prettyJson('{"e":[],"o":{ }}'), '{\n  "e": [],\n  "o": {}\n}');
});

test("prettyJson returns non-JSON and scalars unchanged", () => {
  assert.equal(prettyJson("not json {"), "not json {");
  assert.equal(prettyJson("{broken"), "{broken");
  assert.equal(prettyJson("42"), "42");
});

test("excluded headers are removed case-insensitively", () => {
  const out = processMessage(REQUEST, { ...DEFAULT_FORMAT, excludeHeaders: ["cookie"] }, false);
  assert.ok(!out.includes("Cookie"));
  assert.ok(out.includes("Host: x"));
});

test("headers-only drops the body", () => {
  assert.equal(
    processMessage(REQUEST, DEFAULT_FORMAT, true),
    "POST /a HTTP/1.1\r\nHost: x\r\nCookie: s=1\r\nContent-Type: application/json"
  );
});

test("compressed bodies are replaced with a placeholder", () => {
  const raw = "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\n\r\n\x1f\x8b\x08\x00garbage";
  assert.ok(processMessage(raw, DEFAULT_FORMAT, false).endsWith("(compressed body omitted: gzip)"));
});

test("binary bodies are replaced with a placeholder", () => {
  const raw = "HTTP/1.1 200 OK\r\n\r\n" + "\x00\x01\x02\x03abc".repeat(50);
  assert.ok(processMessage(raw, DEFAULT_FORMAT, false).endsWith("(binary body omitted)"));
});

test("Natural template output has no decoration", () => {
  const out = formatBundle([pair], NATURAL);
  assert.ok(out.startsWith("POST /a HTTP/1.1"));
  assert.ok(!out.includes("=====") && !out.includes("#"));
});

test("Full template output has labels, separator and bundle header", () => {
  const out = formatBundle([pair], FULL);
  assert.ok(out.startsWith("# ReqRes Exporter — 1 request\n"));
  assert.ok(out.includes("===== REQUEST =====") && out.includes("===== RESPONSE ====="));
  assert.ok(out.includes("─".repeat(72)));
});

test("numbering appears even without a separator", () => {
  const out = formatBundle([pair, pair], { ...DEFAULT_FORMAT, showSeparator: false });
  assert.ok(out.includes("[1/2] x/a") && out.includes("[2/2] x/a"));
  assert.ok(!out.includes("─"));
});

test("missing response is reported", () => {
  const out = formatBundle([{ ...pair, responseRaw: null }], DEFAULT_FORMAT);
  assert.ok(out.includes("(no response captured)"));
});

test("output is well-formed so saving cannot fail on lone surrogates", () => {
  const out = formatBundle([{ ...pair, requestRaw: "GET / HTTP/1.1\r\n\r\nx\uD800y" }], NATURAL);
  assert.ok(out.isWellFormed());
});

test("byteSize counts UTF-8 bytes, not characters", () => {
  assert.equal(byteSize("abc"), 3);
  assert.equal(byteSize("─"), 3);
});

test("formatBytes picks a readable unit", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("filenames contain no path separators", () => {
  const [name] = makeFilenames([{ ...pair, host: "../../etc", path: "/a/../b\\c?d=e" }]);
  assert.ok(!name.includes("/") && !name.includes("\\"));
});

test("filenames stay unique when the same endpoint is saved twice", () => {
  const names = makeFilenames([pair, pair, pair]);
  assert.equal(new Set(names).size, 3);
  assert.ok(names[1].endsWith("_2.txt") && names[2].endsWith("_3.txt"));
});

test("template summaries match the built-in descriptions", () => {
  assert.equal(templateSummary(NATURAL), "No decoration, complete request/response");
  assert.equal(
    templateSummary(FULL),
    "Request/response labels, separator, bundle header, timestamp, numbering, complete request/response"
  );
});

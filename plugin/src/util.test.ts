import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWithLimit } from "./util.ts";

test("mapWithLimit keeps order and never exceeds the limit", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithLimit([5, 1, 4, 2, 3, 0], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 2);
});

test("mapWithLimit handles an empty list", async () => {
  assert.deepEqual(await mapWithLimit([], 4, async (n: number) => n), []);
});

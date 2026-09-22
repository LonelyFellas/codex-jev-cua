import test from "node:test";
import assert from "node:assert/strict";
import { parseAX, selectCandidates } from "../src/ax.ts";
import { runTask } from "../src/loop.ts";

const home = "0 standard window Music\n1 scroll area ID: sidebarScroller\n2 outline Sidebar\n4 row (selectable) Search\n5 row (selected) Home\n6 row (selectable, expanded) Playlists\n7 row (disabled, selectable) Unavailable\n8 row Noninteractive\n9 button (disabled, settable) Disabled\n10 button Show Now Playing";

test("Music Search sidebar row is a selectable candidate and remains visible under clipping", () => {
  const result = selectCandidates(parseAX(home), "Open Search in the Music sidebar", 1);
  assert.equal(result.candidates[0]?.index, 4);
  assert.equal(result.candidates[0]?.role, "row");
  assert.equal(result.clipped, true);
  const indexes = selectCandidates(parseAX(home)).candidates.map((candidate) => candidate.index);
  assert.ok(indexes.includes(5));
  assert.ok(indexes.includes(6));
  assert.ok(!indexes.includes(7));
  assert.ok(!indexes.includes(8));
  assert.ok(!indexes.includes(9));
});

test("actual Music search text field is recognized as editable and remains a candidate", () => {
  const ax = "92 toolbar\n93 search text field (settable) Apple Music\n94 button Search\n96 radio button Description: Apple Music, Value: 1\nThe focused UI element is 93 search text field (settable) Apple Music";
  const field = parseAX(ax).find((e) => e.index === 93)!;
  assert.equal(field.role, "search field");
  assert.equal(field.label, "(settable) Apple Music");
  assert.ok(field.raw.includes("search text field"));
  assert.ok(selectCandidates(parseAX(ax), "Search Apple Music").candidates.some((e) => e.index === 93));
});

test("scripted Music search can select sidebar then set the actual search field without playback", async () => {
  let state = home;
  const calls: unknown[][] = [];
  const result = await runTask({ appName: "Music", allowedApps: ["Music"], goal: "Search Apple Music for Eason Chan 明年今日", dryRun: false, maxSteps: 2,
    resources: { text: "陈奕迅 明年今日" },
    driver: { async bind() {}, async observe() { return state; }, async click(index) {
      assert.equal(index, 4); calls.push(["click", index]);
      state = "0 standard window Music\n4 row (selected) Search\n11 search text field (settable) Apple Music\n12 radio button Description: Apple Music, Value: 1";
    }, async setValue(index, value) {
      assert.equal(index, 11); calls.push(["setValue", index, value]);
      state = "0 standard window Music\n20 text 明年今日\n21 text 陈奕迅";
    } },
    decide: async ({ candidates }) => {
      const first = calls.length === 0;
      const target = candidates.find((candidate) => candidate.index === (first ? 4 : 11))!;
      assert.ok(target);
      return { action: first ? "click_element" : "set_value", targetIndex: target.index, confidence: 0.99, done: 0, risk: 0 };
    },
    verify: (ax) => ax.includes("20 text 明年今日") && ax.includes("21 text 陈奕迅"),
  });
  assert.equal(result.status, "done");
  assert.deepEqual(calls, [["click", 4], ["setValue", 11, "陈奕迅 明年今日"]]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceLabel, timeAgo } from "../../lib/session-display";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/126.0.0.0`;
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test("deviceLabel names browser and OS", () => {
  assert.equal(deviceLabel(CHROME_WIN), "Chrome · Windows");
  assert.equal(deviceLabel(FIREFOX_MAC), "Firefox · macOS");
  assert.equal(deviceLabel(SAFARI_IOS), "Safari · iOS");
  assert.equal(deviceLabel(CHROME_LINUX), "Chrome · Linux");
});

test("deviceLabel: Edge is not mistaken for Chrome, Android not for Linux", () => {
  assert.equal(deviceLabel(EDGE_WIN), "Edge · Windows");
  assert.equal(deviceLabel(CHROME_ANDROID), "Chrome · Android");
});

test("deviceLabel falls back for missing or unrecognised user agents", () => {
  assert.equal(deviceLabel(null), "Unknown device");
  assert.equal(deviceLabel(undefined), "Unknown device");
  assert.equal(deviceLabel(""), "Unknown device");
  assert.equal(deviceLabel("curl/8.4.0"), "Unknown device");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0)"), "Windows");
});

test("timeAgo buckets", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  assert.equal(timeAgo(ago(5_000), now), "just now");
  assert.equal(timeAgo(ago(60_000), now), "1 minute ago");
  assert.equal(timeAgo(ago(12 * 60_000), now), "12 minutes ago");
  assert.equal(timeAgo(ago(3 * 3_600_000), now), "3 hours ago");
  assert.equal(timeAgo(ago(26 * 3_600_000), now), "1 day ago");
  assert.equal(timeAgo(ago(5 * 86_400_000), now), "5 days ago");
});

test("timeAgo clamps a future timestamp (clock skew) to 'just now'", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.equal(timeAgo(new Date(now.getTime() + 60_000), now), "just now");
});

test("timeAgo accepts ISO strings (as the session API returns them)", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.equal(timeAgo("2026-10-02T11:48:00Z", now), "12 minutes ago");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseGigBriefAssets } from "../../lib/gigBriefMedia";

test("approved references retain admin order and signed URLs without including public sample reels", () => {
  const picture = "https://media.example.test/1792931200000-abc123-Service%20picture.PNG?token=abc#preview";
  const clip = "https://media.example.test/demo.MOV?download=1";
  assert.deepEqual(parseGigBriefAssets([
    "Brief::Show the service in your reel",
    "Sample::https://media.example.test/public.mp4",
    `Media::${picture}`,
    `media:: ${clip} `,
    `Media::${picture}`,
    "Meta::application_mode=apply",
  ]), [
    { url: picture, kind: "image", name: "Service picture.PNG" },
    { url: clip, kind: "video", name: "demo.MOV" },
  ]);
});

test("legacy image links and extensionless uploads remain usable while documents open as files", () => {
  const inputs = ["https://media.example.test/legacy.webp#detail", "https://media.example.test/clip.mp4", "Media::https://media.example.test/image", "Media::https://media.example.test/brief.pdf", "https://example.test/apply"];
  assert.deepEqual(parseGigBriefAssets(inputs).map(asset => asset.kind), ["image", "video", "image", "file"]);
  assert.equal(parseGigBriefAssets(["Media::https://media.example.test/%broken.jpg"])[0].name, "%broken.jpg");
});

test("untrusted requirements never supply executable media URLs or crash reference rendering", () => {
  assert.deepEqual(parseGigBriefAssets(null), []);
  assert.deepEqual(parseGigBriefAssets("Media::https://media.example.test/picture.png"), []);
  assert.deepEqual(parseGigBriefAssets([null, 1, {}, "Media::javascript:alert(1)", "Media::data:image/png;base64,ABC", "Media::blob:https://example.test/file", "Media::file:///tmp/picture.png", "Media::not a url"]), []);
});

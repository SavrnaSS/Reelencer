import test from "node:test";
import assert from "node:assert/strict";
import { briefAssetDownloadUrl, describeAssetShape, encodeAssetNote, encodeReelExample, parseGigBriefAssets, splitBriefMediaLines, withAssetNote, withReelExample } from "../../lib/gigBriefMedia";

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

test("Supabase references download as attachments under their display name; other hosts open the original", () => {
  const [stored, external] = parseGigBriefAssets([
    "Media::https://abc.supabase.co/storage/v1/object/public/gig-brief-media/brief-media/u/1792931200000-abc123-Wallet%20view.png",
    "Media::https://cdn.example.test/wallet.png",
  ]);
  const href = new URL(briefAssetDownloadUrl(stored)!);
  assert.equal(href.searchParams.get("download"), "Wallet view.png");
  assert.equal(briefAssetDownloadUrl(external), null);
});

test("picture shapes name the orientation and the nearest common ratio", () => {
  assert.deepEqual(describeAssetShape(2880, 1800), { orientation: "Landscape", ratio: "16:10" });
  assert.deepEqual(describeAssetShape(1080, 1920), { orientation: "Vertical", ratio: "9:16" });
  assert.deepEqual(describeAssetShape(1000, 1010), { orientation: "Square", ratio: "1:1" });
  assert.deepEqual(describeAssetShape(2400, 1000), { orientation: "Landscape", ratio: null });
  assert.equal(describeAssetShape(0, 100), null);
});

test("admin reel examples attach to their reference in any order and never appear as references themselves", () => {
  const picture = "https://media.example.test/wallet.png";
  const clip = "https://media.example.test/wallet-in-reel.mp4";
  const assets = parseGigBriefAssets([`Media::${encodeReelExample(picture, clip)}`, `Media::${picture}`, `Media::${encodeReelExample("https://media.example.test/gone.png", clip)}`]);
  assert.deepEqual(assets, [{ url: picture, kind: "image", name: "wallet.png", reelExample: { url: clip, kind: "video" } }]);
  assert.deepEqual(parseGigBriefAssets([`Media::${picture}`, "Media::Reel::{broken", `Media::Reel::${JSON.stringify({ for: picture, url: "javascript:alert(1)" })}`]), [{ url: picture, kind: "image", name: "wallet.png" }]);
});

test("setting and clearing reel examples keeps references in order and drops examples of removed references", () => {
  const a = "https://media.example.test/a.png", b = "https://media.example.test/b.png", shot = "https://media.example.test/a-reel.jpg";
  const withExample = withReelExample([a, b], a, shot);
  assert.deepEqual(withExample, [a, b, encodeReelExample(a, shot)]);
  assert.deepEqual(splitBriefMediaLines(withExample).examples.get(a), { url: shot, kind: "image" });
  assert.deepEqual(withReelExample(withExample, a, null), [a, b]);
  assert.deepEqual(withReelExample([b, encodeReelExample(a, shot)], b, null), [b]);
});

test("creator notes attach to their reference, keep typed spaces for the admin and survive example edits", () => {
  const a = "https://media.example.test/a.png", b = "https://media.example.test/b.png";
  const typed = withAssetNote([a, b], a, "Show the   approved earnings ");
  assert.equal(splitBriefMediaLines(typed).notes.get(a), "Show the   approved earnings ");
  const withExample = withReelExample(typed, a, "https://media.example.test/a-reel.jpg");
  assert.deepEqual(withExample, [a, b, encodeReelExample(a, "https://media.example.test/a-reel.jpg"), encodeAssetNote(a, "Show the   approved earnings ")]);
  const [first, second] = parseGigBriefAssets(withExample.map(line => `Media::${line}`));
  assert.equal(first.note, "Show the approved earnings");
  assert.equal(second.note, undefined);
  assert.deepEqual(withAssetNote(withExample, a, "  "), withReelExample(typed, a, "https://media.example.test/a-reel.jpg").filter(line => !line.startsWith("Note::")));
  // Removing the reference drops its note; notes are capped.
  assert.deepEqual(withReelExample(typed.filter(line => line !== a), a, null), [b]);
  assert.equal(splitBriefMediaLines([a, encodeAssetNote(a, "x".repeat(500))]).notes.get(a)?.length, 240);
});

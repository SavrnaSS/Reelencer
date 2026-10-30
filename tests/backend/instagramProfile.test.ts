import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractInstagramPost, extractInstagramProfile, fetchInstagramProfile, fetchInstagramReel, normalizeInstagramHandle } from "../../lib/api/instagramProfile";

const html = (user: Record<string, unknown>) => `<script type="application/json">${JSON.stringify({ user })}</script>`;
const base = { username: "creator.name", id: "123", edge_followed_by: { count: 0 }, edge_follow: { count: 12 }, edge_owner_to_timeline_media: { count: 2 } };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("validates handles before requesting a fixed Instagram origin", async () => {
  assert.equal(normalizeInstagramHandle(" @Creator.Name "), "creator.name");
  for (const handle of ["https://evil.test", "../admin", "x?next=/", "", "a".repeat(31)]) {
    await assert.rejects(fetchInstagramProfile(handle), /valid Instagram handle/);
  }
});

test("reads exact counts including zero and deduplicates exposed media", () => {
  const post = { shortcode: "ABC", is_video: true, video_view_count: 400, like_count: 0, comment_count: 2, taken_at: 1791021600, caption: { text: "First line\nMore" } };
  const profile = extractInstagramProfile(html({ ...base, edge_owner_to_timeline_media: { count: 2, edges: [{ node: post }, { node: post }] } }), "creator.name");
  assert.equal(profile.followers, 0);
  assert.equal(profile.following, 12);
  assert.equal(profile.posts, 2);
  assert.equal(profile.media.length, 1);
  assert.equal(profile.media[0].likes, 0);
  assert.equal(profile.media[0].views, 400);
  assert.equal(profile.media[0].caption, "First line");
});

test("metadata fallback handles HTML entities and rounded counts without inventing post metrics", () => {
  const profile = extractInstagramProfile('<meta content="1.2M Followers, 1,234 Following, 56 Posts - Creator (@creator.name) &amp; friends" property="og:description">', "creator.name");
  assert.equal(profile.followers, 1_200_000);
  assert.equal(profile.following, 1234);
  assert.equal(profile.posts, 56);
  assert.deepEqual(profile.media, []);
  assert.match(profile.note, /rounded/);
});

test("does not confuse similar handles or unrelated embedded profiles", () => {
  assert.throws(() => extractInstagramProfile('<meta name="description" content="10 Followers, 5 Following, 2 Posts (@creator.name.other)">', "creator.name"), /did not expose/);
  assert.throws(() => extractInstagramProfile(html({ ...base, username: "someone.else" }), "creator.name"), /did not expose/);
});

test("private accounts expose counts only and hidden likes remain unavailable", () => {
  const post = { shortcode: "ABC", like_count: 42, like_and_view_counts_disabled: true };
  const data = { ...base, edge_owner_to_timeline_media: { count: 1, edges: [{ node: post }] } };
  assert.equal(extractInstagramProfile(html(data), "creator.name").media[0].likes, undefined);
  const privateProfile = extractInstagramProfile(html({ ...data, is_private: true }), "creator.name");
  assert.deepEqual(privateProfile.media, []);
  assert.match(privateProfile.note, /private/);
});

test("does not import posts belonging to another creator or invent publication dates", () => {
  const profile = extractInstagramProfile(html({ ...base, edge_owner_to_timeline_media: { count: 2, edges: [
    { node: { shortcode: "WRONG", owner: { username: "other" }, like_count: 999 } },
    { node: { shortcode: "RIGHT", taken_at: "invalid" } },
  ] } }), "creator.name");
  assert.equal(profile.media.length, 1);
  assert.equal(profile.media[0].externalId, "ig:RIGHT");
  assert.equal(profile.media[0].postedAt, undefined);
});

test("network reader reports blocks and never follows redirects to other origins", async () => {
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "http://localhost/secret" } });
  }) as typeof fetch;
  await assert.rejects(fetchInstagramProfile("creator.name"), /redirected/);
  globalThis.fetch = (async () => new Response(null, { status: 429 })) as typeof fetch;
  await assert.rejects(fetchInstagramProfile("creator.name"), /limited/);
});

test("limits response size and accepts only HTML", async () => {
  globalThis.fetch = (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch;
  await assert.rejects(fetchInstagramProfile("creator.name"), /unreadable/);
  globalThis.fetch = (async () => new Response("x".repeat(4_000_001), { headers: { "content-type": "text/html" } })) as typeof fetch;
  await assert.rejects(fetchInstagramProfile("creator.name"), /reading limit/);
});

test("public reel pages require matching author and shortcode", () => {
  const page = html({ shortcode: "ABC", owner: { username: "creator.name" }, play_count: 12345, like_count: 321, comment_count: 12 });
  assert.equal(extractInstagramPost(page, "creator.name", "ABC")?.views, 12345);
  assert.equal(extractInstagramPost(page, "creator.name", "ABC")?.likes, 321);
  assert.equal(extractInstagramPost(page, "someone.else", "ABC"), undefined);
  assert.equal(extractInstagramPost(page, "creator.name", "WRONG"), undefined);
});

test("JSON-LD reel interaction counters distinguish views from likes", () => {
  const page = html({ '@type': 'VideoObject', url: 'https://www.instagram.com/reel/ABC/', author: { url: 'https://www.instagram.com/creator.name/' }, interactionStatistic: [
    { interactionType: { '@type': 'WatchAction' }, userInteractionCount: 5000 },
    { interactionType: 'https://schema.org/LikeAction', userInteractionCount: 200 },
  ] });
  const post = extractInstagramPost(page, 'creator.name', 'ABC');
  assert.equal(post?.views, 5000);
  assert.equal(post?.likes, 200);
  assert.equal(post?.comments, undefined);
});

test("metadata likes require both canonical URL and matching creator", () => {
  const page = '<meta property="og:url" content="https://www.instagram.com/reel/ABC/"><meta property="og:description" content="1.2K likes, 12 comments - creator.name on October 7, 2026: &quot;Caption&quot;">';
  assert.equal(extractInstagramPost(page, 'creator.name', 'ABC')?.likes, 1200);
  assert.equal(extractInstagramPost(page, 'creator.name', 'ABC')?.comments, 12);
  assert.equal(extractInstagramPost(page, 'creator', 'ABC'), undefined);
  assert.equal(extractInstagramPost(page, 'creator.name', 'WRONG'), undefined);
});

test("tracked reel pages fill metrics even when the profile exposes only counts", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const content = url.includes('/reel/')
      ? html({ shortcode: 'ABC', owner: { username: 'creator.name' }, video_view_count: 9000, like_count: 500 })
      : '<meta name="description" content="123 Followers, 4 Following, 1 Posts (@creator.name)">';
    return new Response(content, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile('creator.name', ['https://www.instagram.com/reel/ABC/?igsh=x', 'http://localhost/secret', 'https://evil.test/reel/ABC/']);
  assert.equal(profile.media[0].views, 9000);
  assert.equal(profile.media[0].likes, 500);
  assert.deepEqual(urls.filter(url => url.includes('/reel/')), ['https://www.instagram.com/reel/ABC/embed/', 'https://www.instagram.com/reel/ABC/']);
  assert.ok(urls.includes('https://www.instagram.com/creator.name/embed/'));
});

test("blocked reel pages do not discard successful profile counts", async () => {
  globalThis.fetch = (async (input) => String(input).includes('/reel/') ? new Response(null, { status: 429 }) : new Response('<meta name="description" content="123 Followers, 4 Following, 1 Posts (@creator.name)">', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
  const profile = await fetchInstagramProfile('creator.name', ['https://www.instagram.com/reel/ABC/']);
  assert.equal(profile.followers, 123);
  assert.deepEqual(profile.media, []);
  assert.match(profile.note, /1 did not expose/);
});

test("serialized embedded payloads expose reel play counters", () => {
  const page = html({ data: JSON.stringify({ shortcode: 'ABC', user: { username: 'creator.name' }, ig_play_count: 34567, like_count: 123 }) });
  assert.equal(extractInstagramPost(page, 'creator.name', 'ABC')?.views, 34567);
});

test("malformed view counters do not mask a valid play counter or turn zero into missing", () => {
  const post = { shortcode: 'ABC', user: { username: 'creator.name' }, video_view_count: 'hidden', play_count: 1234 };
  assert.equal(extractInstagramPost(html(post), 'creator.name', 'ABC')?.views, 1234);
  assert.equal(extractInstagramPost(html({ ...post, video_view_count: 0 }), 'creator.name', 'ABC')?.views, 1234);
  assert.equal(extractInstagramPost(html({ ...post, video_view_count: 0, play_count: undefined }), 'creator.name', 'ABC')?.views, 0);
});

test("discovers verified Reels-tab payloads even without links or profile counts", async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    const content = url.endsWith('/creator.name/')
      ? '<meta name="description" content="123 Followers, 4 Following, 1 Posts (@creator.name)">'
      : url.endsWith('/reels/')
        ? html({ data: JSON.stringify({ shortcode: 'ABC', user: { username: 'creator.name' }, product_type: 'clips', clips_metadata: { play_count: 10000 }, like_count: 500 }) })
        : '';
    return new Response(content, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile('creator.name');
  assert.equal(profile.media[0].views, 10000);
  assert.equal(profile.media[0].likes, 500);
  assert.equal(profile.media[0].url, 'https://www.instagram.com/reel/ABC/');
});

function embedPage(media: Record<string, unknown>) {
  const data = JSON.stringify({ gql_data: { shortcode_media: media } });
  return `<script>requireLazy(["ServerJS"],function(ServerJS){var s=new ServerJS();s.handle(${JSON.stringify({ require: [["Embed", [], [{ contextJSON: data }]]] })});});</script>`;
}

test("public ServerJS embed payloads yield verified view counts without executing scripts", () => {
  const page = embedPage({ shortcode: "EMBED", is_video: true, owner: { username: "creator.name" }, video_view_count: 993, like_count: 35 });
  const media = extractInstagramPost(page, "creator.name", "EMBED");
  assert.equal(media?.views, 993);
  assert.equal(media?.likes, 35);
  assert.equal(extractInstagramPost(page, "other", "EMBED"), undefined);
  assert.equal(extractInstagramPost(page, "creator.name", "OTHER"), undefined);
  assert.equal(extractInstagramPost('<script>"contextJSON":"invalid";throw new Error("Must not execute")</script>', "creator.name", "EMBED"), undefined);
});

test("embed-first reads recover real views within the existing request budget", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const page = url.endsWith('/embed/') ? embedPage({ shortcode: "ABC", is_video: true, owner: { username: "creator.name" }, video_view_count: 0, like_count: 5 }) : html(base);
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile("creator.name", ["https://www.instagram.com/reel/ABC/"]);
  assert.equal(profile.media[0].views, 0);
  assert.deepEqual(urls.filter((url) => url.includes("/reel/")), ["https://www.instagram.com/reel/ABC/embed/", "https://www.instagram.com/reel/ABC/"]);
  assert.ok(urls.includes("https://www.instagram.com/creator.name/embed/"));
});

test("unreadable embed view counts fall back to the primary page and preserve other metrics", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const page = url.endsWith('/creator.name/') ? html(base) : url.endsWith('/embed/')
      ? embedPage({ shortcode: "ABC", owner: { username: "creator.name" }, like_count: 35 })
      : html({ shortcode: "ABC", owner: { username: "creator.name" }, play_count: 1000, like_count: 40 });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile("creator.name", ["https://www.instagram.com/reel/ABC/"]);
  assert.equal(profile.media[0].views, 1000);
  assert.equal(profile.media[0].likes, 40);
  assert.deepEqual(urls.filter((url) => url.includes("/reel/")), ["https://www.instagram.com/reel/ABC/embed/", "https://www.instagram.com/reel/ABC/"]);
});

test("embed rate limits stop secondary requests instead of doubling the load", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    return url.endsWith('/creator.name/') ? new Response(html(base), { headers: { 'content-type': 'text/html' } }) : new Response(null, { status: 429 });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile("creator.name", ["https://www.instagram.com/reel/ABC/"]);
  assert.equal(urls.length, 2);
  assert.deepEqual(profile.media, []);
});

function timelineEmbed(posts: Record<string, unknown>[]) {
  return `<script>someServer.handle(${JSON.stringify({ contextJSON: JSON.stringify({ user: { ...base, edge_owner_to_timeline_media: { count: posts.length, edges: posts.map(node => ({ node })) } } }) })});</script>`;
}

const profileCountsOnly = '<meta name="description" content="123 Followers, 4 Following, 8 Posts (@creator.name)">';

test("new reels from the profile embed get reserved read slots with six existing reels", async () => {
  const requested: string[] = [];
  const published = Math.floor(Date.now() / 1000) - 60;
  const known = Array.from({ length: 6 }, (_, index) => `KNOWN${index}`);
  globalThis.fetch = (async (input, init) => {
    const url = String(input); requested.push(url);
    assert.equal(init?.redirect, 'manual');
    const code = new URL(url).pathname.split('/')[2];
    const page = url.endsWith('/creator.name/') || url.endsWith('/creator.name/reels/') ? profileCountsOnly : url.endsWith('/creator.name/embed/')
      ? timelineEmbed([{ shortcode: 'NEW1', is_video: true, taken_at_timestamp: published }, { shortcode: 'NEW2', is_video: true, taken_at_timestamp: published - 10 }])
      : embedPage({ shortcode: code, is_video: true, owner: { username: 'creator.name' }, video_view_count: 10 });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await fetchInstagramProfile('creator.name', known.map(code => `https://www.instagram.com/reel/${code}/`), { publishedAfter: (published - 100) * 1000 });
  const reads = requested.filter(url => url.includes('/reel/'));
  assert.equal(reads.length, 10, 'new discoveries use one embed; each of four tracked reels also checks its primary page');
  assert.equal(new Set(reads.map(url => new URL(url).pathname.split('/')[2])).size, 6, 'the six-reel cap stays intact');
  assert.deepEqual(reads.slice(0,2), ['https://www.instagram.com/reel/NEW1/embed/', 'https://www.instagram.com/reel/NEW2/embed/']);
  assert.equal(result.media.find(post => post.externalId === 'ig:NEW1')?.postedAt, new Date(published * 1000).toISOString());
  assert.equal(result.media.find(post => post.externalId === 'ig:NEW1')?.views, 10);
  assert.equal(result.followers, 123, 'embed counts do not overwrite the fresher profile counts');
  assert.equal(result.media.filter(post => post.externalId === 'ig:NEW1').length, 1);
});

test("a newly discovered embed with views still loads the primary page to verify its publication date", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now()/1000) - 60;
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const page = url.endsWith('/creator.name/') || url.endsWith('/creator.name/reels/') ? profileCountsOnly : url.endsWith('/creator.name/embed/')
      ? timelineEmbed([{ shortcode: 'DATED', is_video: true }])
      : url.endsWith('/reel/DATED/embed/') ? embedPage({ shortcode: 'DATED', is_video: true, owner: { username: 'creator.name' }, video_view_count: 7 })
      : html({ shortcode: 'DATED', is_video: true, owner: { username: 'creator.name' }, taken_at: published, like_count: 2 });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await fetchInstagramProfile('creator.name');
  assert.ok(urls.includes('https://www.instagram.com/reel/DATED/'));
  assert.equal(result.media[0].postedAt, new Date(published * 1000).toISOString());
  assert.equal(result.media[0].views, 7);
  assert.equal(result.media[0].likes, 2);
});

test("Reels-tab discovery still runs with tracked reels when profile embeds expose no feed", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now()/1000) - 60;
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const code = new URL(url).pathname.split('/')[2];
    const page = url.endsWith('/creator.name/reels/') ? html({ shortcode: 'FROMTAB', is_video: true, owner: { username: 'creator.name' }, taken_at: published })
      : url.includes('/reel/') ? embedPage({ shortcode: code, is_video: true, owner: { username: 'creator.name' }, video_view_count: 42 }) : profileCountsOnly;
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await fetchInstagramProfile('creator.name',['https://www.instagram.com/reel/KNOWN/']);
  assert.ok(urls.includes('https://www.instagram.com/creator.name/reels/'));
  assert.equal(result.media.find(post => post.externalId === 'ig:FROMTAB')?.views,42);
});

test("new-reel budget skips older posts, photos and foreign accounts", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now()/1000) - 60;
  globalThis.fetch = (async (input) => {
    const url=String(input);urls.push(url);
    const page=url.endsWith('/creator.name/') ? profileCountsOnly : url.endsWith('/creator.name/embed/') ? timelineEmbed([
      { shortcode: 'RECENT', is_video: true, taken_at: published },
      { shortcode: 'ANCIENT', is_video: true, taken_at: published - 86400 },
      { shortcode: 'PHOTO', is_video: false, taken_at: published },
      { shortcode: 'FOREIGN', is_video: true, taken_at: published, owner: { username: 'other' } },
    ]) : embedPage({ shortcode: 'RECENT', is_video: true, owner: { username: 'creator.name' }, video_view_count: 5 });
    return new Response(page,{headers:{'content-type':'text/html'}});
  }) as typeof fetch;
  const result=await fetchInstagramProfile('creator.name',[],{publishedAfter:(published-100)*1000});
  assert.deepEqual(urls.filter(url=>url.includes('/reel/')),['https://www.instagram.com/reel/RECENT/embed/']);
  assert.equal(result.media.some(post=>post.externalId==='ig:FOREIGN'),false);
});

test("discovery failures retain saved-reel refreshes and the public profile counts", async () => {
  globalThis.fetch=(async (input)=> {
    const url=String(input);
    if(url.includes('/creator.name/') && !url.endsWith('/creator.name/')) return new Response(null,{status:500});
    const page=url.endsWith('/creator.name/') ? profileCountsOnly : embedPage({shortcode:'KNOWN',is_video:true,owner:{username:'creator.name'},video_view_count:9});
    return new Response(page,{headers:{'content-type':'text/html'}});
  }) as typeof fetch;
  const result=await fetchInstagramProfile('creator.name',['https://www.instagram.com/reel/KNOWN/']);
  assert.equal(result.followers,123);
  assert.equal(result.media[0].views,9);
});

test("the Reels tab discovers a new upload when the profile feed only contains a pinned older reel", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now() / 1000) - 30;
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const page = url.endsWith('/creator.name/') ? profileCountsOnly
      : url.endsWith('/creator.name/embed/') ? timelineEmbed([{ shortcode: 'PINNED', is_video: true, taken_at: published - 86400 * 30 }])
        : url.endsWith('/creator.name/reels/') ? timelineEmbed([{ shortcode: 'NEWUPLOAD', product_type: 'clips', taken_at: published }])
          : embedPage({ shortcode: new URL(url).pathname.split('/')[2], owner: { username: 'creator.name' }, video_view_count: 12, like_count: 2 });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await fetchInstagramProfile('creator.name', ['https://www.instagram.com/reel/PINNED/'], { publishedAfter: (published - 100) * 1000 });
  assert.ok(urls.includes('https://www.instagram.com/creator.name/reels/'));
  const found = result.media.find(post => post.externalId === 'ig:NEWUPLOAD');
  assert.equal(found?.views, 12);
  assert.equal(found?.postedAt, new Date(published * 1000).toISOString());
  assert.equal(found?.url, 'https://www.instagram.com/reel/NEWUPLOAD/');
});

test("a submitted link fetches verified metrics directly and fills its real publication date", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now() / 1000) - 60;
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    const page = embedPage({ shortcode: 'DIRECT', owner: { username: 'creator.name' }, video_view_count: 0, like_count: 0,
      ...(url.endsWith('/embed/') ? {} : { taken_at: published, comment_count: 2, caption: { text: 'Fetched caption' } }),
    });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const result = await fetchInstagramReel('creator.name', 'https://m.instagram.com/p/DIRECT/?igsh=share');
  assert.deepEqual(urls, ['https://www.instagram.com/reel/DIRECT/embed/', 'https://www.instagram.com/reel/DIRECT/', 'https://www.instagram.com/creator.name/reels/']);
  assert.equal(result?.views, 0);
  assert.equal(result?.likes, 0);
  assert.equal(result?.comments, 2);
  assert.equal(result?.caption, 'Fetched caption');
  assert.equal(result?.postedAt, new Date(published * 1000).toISOString());
  assert.equal(result?.url, 'https://www.instagram.com/reel/DIRECT/');
});

test("submitted reel reads reject foreign URLs, ignore another author's counts and stop at rate limits", async () => {
  let reads = 0;
  globalThis.fetch = (async () => {
    reads++;
    return new Response(embedPage({ shortcode: 'DIRECT', owner: { username: 'other.creator' }, video_view_count: 9999 }), { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  await assert.rejects(fetchInstagramReel('creator.name', 'https://evil.test/reel/DIRECT/'), /valid Instagram reel link/);
  assert.equal(reads, 0);
  assert.equal(await fetchInstagramReel('creator.name', 'https://www.instagram.com/reel/DIRECT/'), undefined);
  assert.equal(reads, 3);
  reads = 0;
  globalThis.fetch = (async () => { reads++; return new Response(null, { status: 429 }); }) as typeof fetch;
  await assert.rejects(fetchInstagramReel('creator.name', 'https://www.instagram.com/reel/DIRECT/'), /limited/);
  assert.equal(reads, 1);
});

test("a newer valid play counter is not masked by a lagging legacy view counter", () => {
  const post = { shortcode: 'CURRENT', user: { username: 'creator.name' }, video_view_count: 913, play_count: 2003 };
  assert.equal(extractInstagramPost(html(post), 'creator.name', 'CURRENT')?.views, 2003);
  assert.equal(extractInstagramPost(html({ ...post, video_view_count: 2003, play_count: 913 }), 'creator.name', 'CURRENT')?.views, 2003);
  assert.equal(extractInstagramPost(html({ ...post, video_view_count: 'hidden', play_count: undefined }), 'creator.name', 'CURRENT')?.views, undefined);
});

test("all exact-author shortcode payloads and JSON-LD counters are reconciled without accepting recommendations", () => {
  const raw = (code: string, author: string, views: number) => html({ shortcode: code, owner: { username: author }, video_view_count: views });
  const structured = (code: string, author: string, views: number) => html({ '@type': 'VideoObject', url: `https://www.instagram.com/reel/${code}/`, author: { url: `https://www.instagram.com/${author}/` }, interactionStatistic: [
    { interactionType: { '@type': 'WatchAction' }, userInteractionCount: views },
  ] });
  const page = raw('CURRENT', 'creator.name', 913) + structured('CURRENT', 'creator.name', 2003) + raw('CURRENT', 'another.creator', 90000) + structured('OTHER', 'creator.name', 80000);
  assert.equal(extractInstagramPost(page, 'creator.name', 'CURRENT')?.views, 2003, 'JSON-LD is read even when an earlier payload already has views');
  assert.equal(extractInstagramPost(page + raw('CURRENT', 'creator.name', 2010), 'creator.name', 'CURRENT')?.views, 2010, 'later exact-owned payloads are considered');
  assert.equal(extractInstagramPost(page, 'creator.name', 'MISSING'), undefined);
  assert.equal(extractInstagramPost(page, 'creator.name', '.*'), undefined);
});

test("a profile merges duplicate owned media instead of retaining only the first stale reading", () => {
  const stale = { shortcode: 'CURRENT', is_video: true, owner: { username: 'creator.name' }, video_view_count: 913 };
  const page = html({ ...base, edge_owner_to_timeline_media: { count: 2, edges: [{ node: stale }, { node: { ...stale, video_view_count: 2003 } }] } });
  const profile = extractInstagramProfile(page, 'creator.name');
  assert.equal(profile.media.length, 1);
  assert.equal(profile.media[0].views, 2003);
  assert.equal(profile.media[0].url, 'https://www.instagram.com/reel/CURRENT/');
});

test("modern Reels-tab owner IDs are bound to the requested profile and foreign or unproven owners stay excluded", () => {
  const profile = { ...base, id: '17841410000000001', pk: '1234567', follower_count: 209, is_private: false };
  const node = { code: 'CURRENT', product_type: 'clips', user: { pk: '1234567', id: '17841410000000001' }, play_count: 2003, like_count: 40 };
  const page = html({ data: { profile, feed: { xig_user_by_username: { pk: '1234567', polaris_clips_connection: { edges: [
    { node },
    { node: { ...node, code: 'FOREIGN', user: { pk: '9999999' }, play_count: 999999 } },
    { node: { ...node, code: 'CONFLICT', user: { pk: '1234567', username: 'other.creator' }, play_count: 999999 } },
    { node: { ...node, code: 'UNKNOWN', user: {}, play_count: 999999 } },
  ] } } } } });
  const result = extractInstagramProfile(page, 'creator.name');
  assert.deepEqual(result.media.map(post => [post.externalId, post.views]), [['ig:CURRENT', 2003]]);
  assert.equal(extractInstagramPost(page, 'creator.name', 'CURRENT')?.views, 2003);
  assert.equal(extractInstagramPost(page, 'creator.name', 'FOREIGN'), undefined);
  assert.equal(extractInstagramPost(page, 'other.creator', 'CURRENT'), undefined);
});

test("numeric owner proofs reject unsafe JSON numbers and malformed IDs without rejecting exact digit strings", () => {
  const page = (identity: unknown) => html({ profile: { ...base, id: identity }, reel: { code: 'CURRENT', product_type: 'clips', user: { id: identity }, play_count: 2003 } });
  for (const identity of [Number.MAX_SAFE_INTEGER + 1, 0, '0', -1, 'not-an-id', '1e18', {}, true]) {
    assert.equal(extractInstagramPost(page(identity), 'creator.name', 'CURRENT'), undefined);
    assert.equal(extractInstagramProfile(page(identity), 'creator.name').media.length, 0);
  }
  assert.equal(extractInstagramPost(page('17841410000000001'), 'creator.name', 'CURRENT')?.views, 2003);
  assert.equal(extractInstagramPost(page(1234567), 'creator.name', 'CURRENT')?.views, 2003);
});

test("newer numeric-owner Reels-tab views survive a lagging embed and primary reel page", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now() / 1000) - 60;
  const identity = { ...base, id: '17841410000000001', pk: '1234567', follower_count: 209, is_private: false };
  const named = { code: 'CURRENT', user: { username: 'creator.name', id: identity.id }, product_type: 'clips', taken_at: published };
  globalThis.fetch = (async (input, init) => {
    const url = String(input); urls.push(url);
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'manual');
    const page = url.endsWith('/creator.name/') ? html({ ...identity, edge_owner_to_timeline_media: { count: 1, edges: [{ node: named }] } })
      : url.endsWith('/creator.name/reels/') ? html({ data: { xig_user_by_username: { pk: identity.pk, polaris_clips_connection: { edges: [
        { node: { ...named, user: { pk: identity.pk, id: identity.id }, play_count: 2003, like_count: 40 } },
        { node: { ...named, code: 'SUGGESTED', user: { pk: '999999' }, play_count: 999999 } },
      ] } } } })
        : url.includes('/reel/') ? embedPage({ shortcode: 'CURRENT', owner: { username: 'creator.name' }, video_view_count: 918, like_count: 39 }) : '';
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile('creator.name', ['https://www.instagram.com/reel/CURRENT/']);
  assert.equal(profile.media.length, 1);
  assert.equal(profile.media[0].views, 2003);
  assert.equal(profile.media[0].likes, 40);
  assert.equal(profile.media[0].postedAt, new Date(published * 1000).toISOString());
  assert.ok(urls.includes('https://www.instagram.com/reel/CURRENT/'));
  assert.equal(urls.some(url => url.includes('SUGGESTED')), false);
});

test("every scheduled tracked-reel read checks the primary page even while the embed has a valid dated count", async () => {
  const urls: string[] = [];
  const published = Math.floor(Date.now() / 1000) - 60;
  let current = 2003;
  globalThis.fetch = (async input => {
    const url = String(input); urls.push(url);
    const page = url.includes('/reel/') ? embedPage({ shortcode: 'CURRENT', is_video: true, owner: { username: 'creator.name' }, video_view_count: url.endsWith('/embed/') ? 913 : current, taken_at: published }) : profileCountsOnly;
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const tracked = ['https://www.instagram.com/reel/CURRENT/'];
  assert.equal((await fetchInstagramProfile('creator.name', tracked, { refreshInteractions: false })).media[0].views, 2003);
  current = 2011;
  assert.equal((await fetchInstagramProfile('creator.name', tracked, { refreshInteractions: false })).media[0].views, 2011);
  assert.equal(urls.filter(url => url === tracked[0]).length, 2);
});

test("direct reel reads reconcile a valid dated embed with the newer full page and retain it on page failure", async () => {
  const published = Math.floor(Date.now() / 1000) - 60;
  let failed = false;
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); urls.push(url);
    if (failed && !url.endsWith('/embed/')) return new Response(null, { status: 503 });
    return new Response(embedPage({ shortcode: 'CURRENT', owner: { username: 'creator.name' }, video_view_count: url.endsWith('/embed/') ? 913 : 2003, taken_at: published }), { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const url = 'https://www.instagram.com/reel/CURRENT/';
  assert.equal((await fetchInstagramReel('creator.name', url))?.views, 2003);
  failed = true;
  assert.equal((await fetchInstagramReel('creator.name', url))?.views, 913);
  assert.equal(urls.length, 6);
});

test("direct public reel lookup reads current Reels-tab plays when embed views lag and the primary page omits views", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); urls.push(url);
    const page = url.endsWith('/creator.name/reels/') ? html({ data: {
      profile: { ...base, id: '17841410000000001', pk: '1234567', follower_count: 209 },
      xig_user_by_username: { pk: '1234567', polaris_clips_connection: { edges: [{ node: { code: 'CURRENT', product_type: 'clips', user: { pk: '1234567' }, play_count: 2003, like_count: 40 } }] } },
    } })
      : embedPage({ shortcode: 'CURRENT', owner: { username: 'creator.name' }, like_count: 39, ...(url.endsWith('/embed/') ? { video_view_count: 913 } : {}) });
    return new Response(page, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const reading = await fetchInstagramReel('creator.name', 'https://www.instagram.com/reel/CURRENT/');
  assert.equal(reading?.views, 2003);
  assert.equal(reading?.likes, 40);
  assert.equal(urls.length, 3);
});

test("direct reel primary-page rate limits preserve a valid embed and stop before Reels-tab reads", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); urls.push(url);
    return url.endsWith('/embed/') ? new Response(embedPage({ shortcode: 'CURRENT', owner: { username: 'creator.name' }, video_view_count: 913 }), { headers: { 'content-type': 'text/html' } }) : new Response(null, { status: 429 });
  }) as typeof fetch;
  assert.equal((await fetchInstagramReel('creator.name', 'https://www.instagram.com/reel/CURRENT/'))?.views, 913);
  assert.deepEqual(urls, ['https://www.instagram.com/reel/CURRENT/embed/', 'https://www.instagram.com/reel/CURRENT/']);
});

test("a login wall on the Reels tab and reel pages still refreshes saved reels from their public embeds", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); urls.push(url);
    if (url.endsWith('/creator.name/')) return new Response(html(base), { headers: { 'content-type': 'text/html' } });
    if (/\/reel\/\w+\/embed\/$/.test(url)) {
      const code = url.split('/')[4];
      return new Response(embedPage({ shortcode: code, is_video: true, owner: { username: "creator.name" }, video_view_count: code === "ABC" ? 2232 : 900, like_count: 41 }), { headers: { 'content-type': 'text/html' } });
    }
    if (url.endsWith('/creator.name/embed/')) return new Response('', { headers: { 'content-type': 'text/html' } });
    return new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/accounts/login/' } });
  }) as typeof fetch;
  const profile = await fetchInstagramProfile("creator.name", ["https://www.instagram.com/reel/ABC/", "https://www.instagram.com/reel/DEF/"]);
  assert.deepEqual(profile.media.map((media) => [media.url, media.views]), [["https://www.instagram.com/reel/ABC/", 2232], ["https://www.instagram.com/reel/DEF/", 900]]);
  assert.ok(urls.includes("https://www.instagram.com/reel/DEF/embed/"), "every saved reel's embed is read");
  assert.equal(urls.filter((url) => /\/reel\/\w+\/$/.test(url)).length, 0, "no reel pages after the Reels tab asked for login");
  assert.match(profile.note, /came from public embeds/);
  assert.doesNotMatch(profile.note, /discovery paused/);
});

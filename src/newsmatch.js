// Turns posts and headlines into watch words, and matches new coins against them.
// Example: a post "meet Elsa, my new dog" adds "elsa"; a coin named "ELSA" or
// "Elsa the Dog" launched afterwards triggers a NEWS MATCH alert.

const STOP = new Set(`the a an and or but if then than so to of in on at by for with from into onto over under about after before
this that these those it its it's is are was were be been being am do does did done have has had having will would can could
should may might must shall not no yes just very really more most much many some any all each every few lot lots also too
i me my mine we us our you your he him his she her they them their what which who whom whose when where why how
new old good bad great best big small first last next one two three today tomorrow yesterday now soon still again ever never
here there out up down off back only even well like get got make made go going went come came take took see saw say said
know think want need look looks use used time year years day days week people thing things way world life man woman
news report reports says said amid after over update live breaking video watch photos photo just via https http www com amp
rt lol lmao haha wow yeah ok okay thanks thank please sir guys everyone someone anyone nothing something everything
elon musk elonmusk tesla spacex twitter x post posts tweet tweets crypto coin coins token tokens memecoin solana sol pump fun`.split(/\s+/));

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Returns [{ kw, strong }] — strong words are names the post clearly introduces.
export function extractKeywords(text, { headline = false, ignore = [] } = {}) {
  const out = new Map();
  const ign = new Set(ignore.map(norm));
  const add = (w, strong) => {
    const k = norm(w);
    if (k.length < 3 || k.length > 24 || STOP.has(k) || ign.has(k) || /^\d+$/.test(k)) return;
    const cur = out.get(k);
    out.set(k, { kw: k, strong: strong || cur?.strong || false });
  };
  const t = String(text ?? '').replace(/https?:\/\/\S+/g, ' ');
  // "named Elsa", "called Floki", "meet Elsa"
  for (const m of t.matchAll(/\b(?:named|called|name is|meet|introducing|say hi to|say hello to)\s+["“']?([A-Za-z][\w'-]{1,20}(?:\s+(?:the\s+)?[A-Z][\w'-]{1,20})?)/gi)) {
    add(m[1], true);
    m[1].split(/\s+/).forEach((part, i) => add(part, i === 0));
  }
  for (const m of t.matchAll(/[#$]([A-Za-z][A-Za-z0-9_]{1,20})/g)) add(m[1], true);           // #hashtag / $CASHTAG
  for (const m of t.matchAll(/["“]([^"”]{2,30})["”]/g)) { add(m[1], true); }                    // "quoted"
  for (const m of t.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g)) {                // Proper Nouns
    add(m[1], false);
    for (const part of m[1].split(/\s+/)) add(part, false);
  }
  if (!headline) for (const w of t.split(/[^A-Za-z0-9']+/)) if (w.length >= 4) add(w, false); // short posts: every real word
  return [...out.values()];
}

// Does this coin's name or ticker match the watch word?
export function matchCoin(coin, kw) {
  const k = norm(kw);
  if (k.length < 3) return null;
  const s = norm(coin.symbol), n = norm(coin.name);
  if (s === k || n === k) return 'exact';
  if (k.length >= 4 && (n.startsWith(k) || n.endsWith(k) || s.startsWith(k))) return 'close';
  if (k.length >= 5 && (n.includes(k) || s.includes(k))) return 'close';
  return null;
}

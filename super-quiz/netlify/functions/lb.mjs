import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const ADMIN_HASH = "6e61a9bbd74f6520c8c5c95fa1a0e64a4676cd8945187481b56c85c2c0d1ca01";
const MAX_SCORE = 2000; // 10 أسئلة × (100 + 50 + 50) كحد أقصى
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const hid = (s) => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return "p" + h.toString(36);
};
const normName = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim();
const nameOk = (n) =>
  n.length >= 2 && n.length <= 20 &&
  /^[\p{L}\p{N} _\-.]+$/u.test(n) &&
  !/\d{5,}/.test(n.replace(/[\s\-_.]/g, "")) &&
  !/(www|http|\.com|\.net|\.ly|t\.me)/i.test(n);
const isAdmin = (req) =>
  createHash("sha256").update(req.headers.get("x-admin") || "").digest("hex") === ADMIN_HASH;
const better = (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time);

export default async (req) => {
  const store = getStore({ name: "leaderboard", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const items = await Promise.all(
      blobs.slice(0, 300).map(async (b) => {
        const v = await store.get(b.key, { type: "json" });
        return v ? { ...v, id: b.key } : null;
      })
    );
    const list = items
      .filter(Boolean)
      .sort((x, y) => y.score - x.score || x.time - y.time)
      .slice(0, 100);
    return json(list);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  if (body.action === "score") {
    const name = cleanName(body.name);
    const score = Number(body.score), time = Number(body.time), ok = Number(body.ok);
    if (!nameOk(name)) return json({ error: "name" }, 400);
    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) return json({ error: "score" }, 400);
    if (!Number.isFinite(time) || time < 0 || time > 300) return json({ error: "time" }, 400);
    const rec = { name, score: Math.round(score), time: Math.round(time * 10) / 10, ok: Math.max(0, Math.min(10, ok | 0)), at: Date.now() };
    const id = hid(normName(name));
    const old = await store.get(id, { type: "json" });
    if (!old || better(rec, old)) await store.setJSON(id, rec);
    return json({ saved: true });
  }

  if (!isAdmin(req)) return json({ error: "auth" }, 401);

  if (body.action === "delete") {
    await store.delete(String(body.id));
    return json({ ok: true });
  }
  if (body.action === "rename") {
    const name = cleanName(body.name);
    if (!nameOk(name)) return json({ error: "name" }, 400);
    const old = await store.get(String(body.id), { type: "json" });
    if (!old) return json({ error: "missing" }, 404);
    const nid = hid(normName(name));
    await store.setJSON(nid, { ...old, name });
    if (nid !== body.id) await store.delete(String(body.id));
    return json({ ok: true });
  }
  return json({ error: "action" }, 400);
};

export const config = { path: "/api/lb" };

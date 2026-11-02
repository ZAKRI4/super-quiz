import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";
import "../../filter.js"; // نفس فلتر الصفحة (يضع SuperFilter في globalThis)

const F = globalThis.SuperFilter;

// بصمة SHA-256 لكلمة السر (الافتراضية: super2026). الصفحة ترسل البصمة في ترويسة x-admin.
// تُغيَّر من زر «تغيير كلمة السر» في لوحة المشرف، أو بمتغير البيئة ADMIN_HASH.
const DEFAULT_HASH = "9a0ee89e00a006877eca0c28eebeb38aa301469b9cce8012b6ee04b13079a7e8";
const MAX_SCORE = 2000; // 10 أسئلة × (100 + 50 + 50) كحد أقصى
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// نفس طريقة بناء المفاتيح السابقة تماماً حتى تبقى النتائج الحالية ظاهرة
const hid = (s) => {
  let h = 5381;
  for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return "p" + h.toString(36);
};
const normName = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const better = (a, b) => a.score > b.score || (a.score === b.score && a.time < b.time);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = () => getStore({ name: "leaderboard", consistency: "strong" });
const conf = () => getStore({ name: "super-config", consistency: "strong" });

async function adminHash() {
  try {
    const h = await conf().get("admin-hash");
    if (h && /^[0-9a-f]{64}$/.test(h.trim())) return h.trim();
  } catch {}
  return String(process.env.ADMIN_HASH || DEFAULT_HASH).trim().toLowerCase();
}
async function isAdmin(req) {
  const h = (req.headers.get("x-admin") || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(await adminHash()));
}

// ---- قائمة الكلمات المحظورة التي يضيفها المشرف (تُحفظ في super-config/blocklist) ----
const MODES = ["auto", "s", "a", "e"];
function cleanWords(v) {
  const seen = new Set(), block = [], allow = [];
  for (const it of Array.isArray(v && v.block) ? v.block : []) {
    const w = String((it && it.w) ?? it ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const m = MODES.includes(it && it.m) ? it.m : "auto";
    const k = w.toLowerCase() + "|" + m;
    if (w.length < 2 || seen.has(k) || block.length >= 3000) continue;
    seen.add(k); block.push({ w, m });
  }
  const seenA = new Set();
  for (const n of Array.isArray(v && v.allow) ? v.allow : []) {
    const w = String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (w.length < 2 || seenA.has(w.toLowerCase()) || allow.length >= 500) continue;
    seenA.add(w.toLowerCase()); allow.push(w);
  }
  return { block, allow };
}
let WCACHE = null, WAT = 0;
async function loadWords() {
  if (WCACHE && Date.now() - WAT < 10000) return WCACHE;
  let w = { block: [], allow: [] };
  try { const v = await conf().get("blocklist", { type: "json" }); if (v) w = cleanWords(v); } catch {}
  WCACHE = w; WAT = Date.now();
  return w;
}

async function readAll(st, limit) {
  const { blobs } = await st.list();
  const items = await Promise.all(
    (limit ? blobs.slice(0, limit) : blobs).map(async (b) => {
      const v = await st.get(b.key, { type: "json" }).catch(() => null);
      return v && v.name ? { ...v, id: b.key } : null;
    })
  );
  return items.filter(Boolean);
}

export default async (req) => {
  try {
    const st = store();

    if (req.method === "GET") {
      const list = (await readAll(st, 300))
        .sort((x, y) => y.score - x.score || x.time - y.time)
        .slice(0, 100);
      return json(list);
    }

    if (req.method !== "POST") return json({ error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    F.setCustom(await loadWords());                // قائمة المشرف + القائمة المدمجة

    // فحص الاسم قبل بدء الاختبار (لا يكشف القائمة للزوار)
    if (body.action === "check") {
      const err = F.nameError(F.cleanName(body.name));
      return err ? json({ error: err }, 422) : json({ ok: true });
    }

    if (body.action === "score") {
      const name = F.cleanName(body.name);
      const err = F.nameError(name);               // الطول + الرموز + الروابط + الألفاظ البذيئة
      if (err) return json({ error: err }, 422);
      const score = Number(body.score), time = Number(body.time), ok = Number(body.ok);
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) return json({ error: "score" }, 400);
      if (!Number.isFinite(time) || time < 0 || time > 300) return json({ error: "time" }, 400);
      const rec = { name, score: Math.round(score), time: Math.round(time * 10) / 10, ok: Math.max(0, Math.min(10, ok | 0)), at: Date.now() };
      const id = hid(normName(name));
      const old = await st.get(id, { type: "json" }).catch(() => null);
      if (!old || better(rec, old)) await st.setJSON(id, rec);
      return json({ saved: true });
    }

    // ---- كل ما بعده يحتاج كلمة سر المشرف ----
    if (!["auth", "delete", "rename", "reset", "purge", "setpw", "words_get", "words_set"].includes(body.action)) return json({ error: "action" }, 400);
    if (!(await isAdmin(req))) { await sleep(400); return json({ error: "auth" }, 401); }

    if (body.action === "auth") return json({ ok: true });

    if (body.action === "delete") {
      if (!body.id) return json({ error: "id" }, 400);
      await st.delete(String(body.id));
      return json({ ok: true });
    }

    if (body.action === "rename") {
      const name = F.cleanName(body.name);
      const err = F.nameError(name);
      if (err) return json({ error: err }, 422);
      const oid = String(body.id || "");
      const old = oid && (await st.get(oid, { type: "json" }).catch(() => null));
      if (!old) return json({ error: "missing" }, 404);
      const nid = hid(normName(name));
      let rec = { ...old, name };
      if (nid !== oid) {
        // إن كان الاسم الجديد موجوداً نُبقي الأفضل بدل أن نمسح نتيجة أحدهما
        const other = await st.get(nid, { type: "json" }).catch(() => null);
        if (other && better(other, rec)) rec = { ...other, name };
        await st.delete(oid);
      }
      await st.setJSON(nid, rec);
      return json({ ok: true });
    }

    if (body.action === "reset") {
      const rows = await readAll(st);
      await Promise.all(rows.map((r) => st.delete(r.id)));
      return json({ ok: true, removed: rows.length });
    }

    if (body.action === "purge") {
      const rows = (await readAll(st)).filter((r) => F.isBad(r.name));
      await Promise.all(rows.map((r) => st.delete(r.id)));
      return json({ ok: true, removed: rows.length });
    }

    if (body.action === "words_get") return json(await loadWords());

    if (body.action === "words_set") {
      const w = cleanWords({ block: body.block, allow: body.allow });
      await conf().setJSON("blocklist", w);
      WCACHE = w; WAT = Date.now();
      return json({ ok: true, ...w });
    }

    if (body.action === "setpw") {
      const h = String(body.hash || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(h)) return json({ error: "bad_hash" }, 400);
      await conf().set("admin-hash", h);
      return json({ ok: true });
    }

    return json({ error: "action" }, 400);
  } catch (e) {
    console.error("lb error", e);
    return json({ error: "server" }, 500);
  }
};

export const config = { path: "/api/lb" };

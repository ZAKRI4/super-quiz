/* =====================================================================
   filter.js — فلتر الأسماء (عربي + إنجليزي + عربيزي + اللهجة الليبية)
   ملف واحد يُستخدم في مكانين:
     1) الصفحة  : <script src="filter.js"></script>
     2) الخادم  : netlify/functions/lb.mjs  (حتى لا يمكن تجاوز الفلتر)
   لإضافة كلمة جديدة: أضفها في القائمة المناسبة بالأسفل فقط.

   مستويات المطابقة:
     S  = تُحجب إذا ظهرت في أي مكان داخل الاسم (للكلمات الطويلة الواضحة)
     E  = تُحجب إذا كانت هي الكلمة كاملة فقط
     R  = كلمة كاملة مع بادئات عربية (ال، يا، و، ب ...)
     P  = كلمة كاملة + بادئات + ضمائر ملكية (ـك، ـه، ـها، ـي ...)
     A  = كلمة كاملة + بادئات + لواحق أوسع (جمع، مؤنث، ضمائر)
   ===================================================================== */
(function (root) {
  "use strict";

  /* ---------- دوال التعريف القديمة (للمعرّفات فقط، لا تغيّرها) ---------- */
  const LEET_OLD = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i" };
  function pre(s) {
    s = String(s).toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0640\u200c-\u200f]/g, "");
    s = s.replace(/[أإآٱ]/g, "ا").replace(/ى|ی/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ک/g, "ك");
    return s.replace(/[0134578@$!]/g, function (c) { return LEET_OLD[c]; });
  }
  const norm = function (s) { return pre(s).replace(/(.)\1+/g, "$1"); };
  const hid = function (s) { let h = 5381; for (const c of s) h = (h * 33 ^ c.charCodeAt(0)) >>> 0; return "p" + h.toString(36); };

  /* ---------- التطبيع القوي للفلتر ---------- */
  const HOMO = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ѕ": "s", "һ": "h", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h", "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "χ": "x" };
  const HOMO_RE = new RegExp("[" + Object.keys(HOMO).join("") + "]", "g");
  const LEET1 = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "€": "e" };
  const LEET2 = { "0": "o", "1": "i", "4": "a", "@": "a", "$": "s", "!": "i", "€": "e" }; // العربيزي: نُبقي 2 3 5 6 7 8 9

  function base(s) {
    s = String(s).normalize("NFKD").toLowerCase();
    s = s.replace(HOMO_RE, function (c) { return HOMO[c]; });
    s = s.replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g, "");
    s = s.replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x6F0); });
    s = s.replace(/[أإآٱ]/g, "ا").replace(/[ىیۍێې]/g, "ي").replace(/[ةۃہھۂ]/g, "ه")
      .replace(/[ؤۆۇۈۋ]/g, "و").replace(/ئ/g, "ي").replace(/[کڪ]/g, "ك").replace(/[ڤڨ]/g, "ف")
      .replace(/پ/g, "ب").replace(/چ/g, "ج").replace(/ژ/g, "ز").replace(/گ/g, "ك").replace(/ء/g, "");
    return s;
  }

  /* حرف مكرر في الكلمة المحجوبة = يقبل أي تكرار (كسسسمك ، fuuuck) */
  function pat(w) {
    let o = "", i = 0;
    while (i < w.length) {
      let j = i; while (j < w.length && w[j] === w[i]) j++;
      const n = j - i; o += w[i] + (n > 1 ? "{" + n + ",}" : "+"); i = j;
    }
    return o;
  }
  const clean = function (w) { return base(w).replace(/[^a-z0-9\u0621-\u064A]/g, ""); };

  /* ---------- لواحق وبادئات ---------- */
  const PRE = "(?:ويا|يا|وال|بال|فال|كال|لل|ال|ب|ل|و|ف|ك)?";
  const SUFP = "(?:ها|هم|كم|كن|هن|نا|ني|ي|ك|ه)?";
  const SUFA = "(?:ها|هم|كم|كن|هن|نا|ني|ات|ين|ون|ان|تك|تي|تها|ته|تهم|ي|ك|ه|ا|و)?";
  const SUFE = "(?:s|es|ed|er|ers|ing|in|y|ies|z|zz|head|face|hole)?";
  const AR = /[\u0621-\u064A]/;

  /* مجموعتان: N = بدون أرقام (تُفحص بعد تحويل الأرقام) ، D = عربيزي بأرقام (3ars ، ka7ba) */
  const G = { N: { plain: [], tok: [] }, D: { plain: [], tok: [] } };
  function add(tier, w, tail) {
    const c = clean(w); if (!c) return;
    const g = /[0-9]/.test(c) ? G.D : G.N, ar = AR.test(c), p = pat(c) + (tail || "");
    if (tier === "S") g.plain.push(new RegExp(p));
    else if (tier === "E") g.tok.push(new RegExp("^" + p + "$"));
    else if (tier === "R") g.tok.push(new RegExp("^" + (ar ? PRE : "") + p + "$"));
    else if (tier === "P") g.tok.push(new RegExp("^" + (ar ? PRE + p + SUFP : p + SUFE) + "$"));
    else if (tier === "A") g.tok.push(new RegExp("^" + (ar ? PRE + p + SUFA : p + SUFE) + "$"));
  }
  const addAll = function (tier, list) { list.forEach(function (w) { add(tier, w); }); };

  /* توليد "ابن/بنت/ولد ... + الكلب/الحرام/القحبة ..." دفعة واحدة */
  function combo(rels, arts, tails) {
    [false, true].forEach(function (dig) {
      const t = tails.filter(function (x) { return /[0-9]/.test(clean(x[0] || x)) === dig; });
      if (!t.length) return;
      const r = "(?:" + rels.map(function (x) { return pat(clean(x)); }).join("|") + ")";
      const a = "(?:" + arts.map(function (x) { return pat(clean(x)); }).join("|") + ")?";
      const tl = "(?:" + t.map(function (x) { return Array.isArray(x) ? pat(clean(x[0])) + x[1] : pat(clean(x)); }).join("|") + ")";
      (dig ? G.D : G.N).plain.push(new RegExp(r + a + tl));
    });
  }

  /* =====================================================================
     القوائم
     ===================================================================== */

  /* ----- عربي: S (تُحجب في أي موضع) ----- */
  addAll("S", [
    "كسمك", "كسامك", "كسيمك", "كسمين", "كسخت", "كساخت", "كسختك", "كسربك", "كسدين", "كسدينك",
    "شرموط", "شراميط", "شرمط",
    "قحبة", "قحبت",
    "منيوك", "متناك", "نيكمك", "نيكك", "نيكها", "ننيكك", "انيكك", "نيكوك", "ينيك", "نياك",
    "زانية", "عاهر", "ديوث", "ساقطة", "خنيث", "مخنث", "لوطي", "داعش",
    "دينامك", "دينابوك", "دينمك", "ديناختك"
  ]);

  /* ----- عربي: E (الكلمة كاملة فقط) ----- */
  addAll("E", [
    "كس", "كسك", "كسه", "كسها", "كسي", "كسكم", "كسهم",
    "نيك", "خولات", "خولين", "زمل", "زمال", "زامل", "زامله",
    "قواد", "قواده", "قوادين", "بزاز", "بغي", "شاذ", "شواذ", "سحاق", "سحاقيه", "لواط", "نازي", "زاني",
    "زب", "زبي", "زبك", "زبه", "زبها", "زبهم", "زبكم", "زبر", "الزب", "يازب",
    "امك", "اختك", "بنتك", "باتك", "ابوك", "عمك", "خالك", "جدتك", "اخوك", "ابيك", "امكم", "ابوكم", "عمكم",
    "خالتك", "عمتك", "زوجتك", "مرتك", "اهلك", "عرضك", "امه", "اخته",
    "كلبك", "كلبه", "كلبكم",
    "حيوان", "بهيم", "بهيمه", "جحش", "عبيط", "عبيل", "هبيل", "هبله", "ابله", "اهبل", "احمق", "معفن",
    "نذل", "وغد", "سافل", "منحط", "زباله", "زنجي", "ملعون", "ملعونه", "لعين",
    "فاجر", "فاجره", "عاهره", "عاهرات", "اباحي", "اباحيه", "سكس", "سكسي", "بورن", "بورنو",
    "اغتصاب", "مغتصب", "بظر", "ايري", "ايرك", "ايره", "ايرها", "خري"
  ]);

  /* ----- عربي: R (مع ال / يا / و ...) ----- */
  addAll("R", ["كلب", "كلاب", "خول"]);

  /* ----- عربي: P (مع الضمائر: ـك ـه ـها ...) ----- */
  addAll("P", ["ناك", "ناكح", "منيك", "يلعن", "ينعل"]);

  /* ----- عربي: A (مع لواحق أوسع) ----- */
  addAll("A", [
    "عرص", "معرص", "طيز", "خرا", "حمار", "خنزير", "غبي", "حقير", "وسخ", "وصخ", "قذر", "تيس",
    "ديوس", "قحاب"
  ]);

  /* ----- عربي: عبارات النسب (ابن/بنت/ولد/أولاد ... الكلب/الحرام/القحبة ...) ----- */
  combo(
    ["ابن", "بنت", "ولد", "اولاد", "ولاد", "اخو", "اخت"],
    ["ال", "ل"],
    [["كلب", "(?!ي)"], "كلبه", "حرام", "قحبه", "شرموطه", "شرموط", "متناكه", "متناك", "منيوكه", "منيوك",
      "وسخه", "وسخ", "زانيه", "زنا", "زاني", "عاهره", "ديوث", "خول", "عرص", "ساقطه", "حقيره", "حمار", "حماره", "خنزير", "خنزيره"]
  );

  /* ----- إنجليزي: S ----- */
  addAll("S", [
    "fuck", "fck", "fcuk", "phuck", "fvck", "motherfuck", "mothafuck", "bullshit", "horseshit", "dipshit",
    "shithead", "shitface", "shitbag", "bitch", "biatch", "beyotch", "btch", "bastard", "whore", "pussy", "porn",
    "asshole", "arsehole", "dumbass", "jackass", "fatass", "cocksuck", "blowjob", "handjob", "rimjob", "jackoff",
    "jerkoff", "dickhead", "dildo", "cumshot", "hentai", "nigger", "nigga", "niggah", "faggot", "fagot", "shemale",
    "masturbat", "ejaculat", "orgasm", "pedophil", "paedophil", "molest", "incest", "butthole", "isis", "hitler",
    "terrorist", "stupid", "idiot", "imbecile", "scumbag", "douchebag", "goddamn", "bollock", "sonofabitch",
    "killyourself", "buttfuck", "titties", "titty"
  ]);

  /* ----- عربيزي (بحروف لاتينية): S ----- */
  addAll("S", [
    "kosomak", "kosmak", "kosomek", "kosamak", "kosumak", "kosomk", "kosmk", "kozomak", "cosomak", "qosomak",
    "kosokhtak", "koskhtak", "kosokhtek",
    "sharmoot", "sharmouta", "sharmota", "sharmuta", "sharmout", "sharmot", "sharmut", "charmout", "charmot", "sharameet",
    "qahba", "qahbe", "kahba", "kahbe", "ka7ba", "ka7be", "qa7ba", "qa7be", "9a7ba", "9a7be",
    "manyak", "manyok", "manyouk", "manyuk", "manyek", "mnyak", "mnyok", "mnyouk", "mnyuk", "mnyek",
    "dayouth", "dayyouth", "dayuth", "dyouth", "diyouth",
    "nikmak", "nikmk", "nikomak", "nikomk", "neikmak", "nikmek",
    "khanzir", "khanzeer", "khinzir", "5anzir", "5inzir",
    "yel3an", "yil3an", "yen3al", "yin3al"
  ]);

  /* ----- إنجليزي + عربيزي: E (الكلمة كاملة) ----- */
  addAll("E", [
    "ass", "asses", "arse", "anus", "cum", "jizz", "jiz", "jism", "suck", "sucks", "hell", "rape", "rapist", "pedo",
    "paedo", "wtf", "stfu", "kys", "nazi", "anal", "milf", "xxx", "gay", "gook", "coon", "hoe", "thot", "orgy",
    "semen", "dumb",
    "kos", "kosa", "kosi", "kosak", "kossi", "kosk", "kosek", "kosha",
    "zebi", "zbi", "zbek", "zbak", "zebak", "zebek",
    "tizak", "teezak", "tizek", "ayri", "ayrek", "kelb", "ghabi", "ghaby", "dayus", "dayous",
    "3ars", "3arsa", "3ahra", "3ahira", "3ahera", "a7a", "7mar", "7imar", "5awal", "5wal", "8abi"
  ]);

  /* ----- إنجليزي: A (مع s / y / er / ing ...) ----- */
  addAll("A", [
    "cunt", "slut", "retard", "cock", "dick", "tit", "boob", "sex", "twat", "nude", "naked", "fag", "penis", "vagina",
    "wank", "shit", "crap", "piss", "bugger", "prick", "douche", "skank", "pimp", "hooker", "tranny", "spic", "kike",
    "chink", "loser", "moron", "horny", "erotic", "fuk", "fuq", "phuk", "khawal", "scum"
  ]);

  /* ----- عربيزي: عبارات النسب (ibn el kalb / wled l7ram ...) ----- */
  combo(
    ["ibn", "ebn", "ibin", "wled", "walad", "weld", "ould", "wlid", "bint", "bnt", "ebnt", "akho", "okht", "ukht"],
    ["el", "al", "l", "il"],
    [["kalb", "(?!i)"], ["kelb", "(?!i)"], "haram", "7aram", "qahba", "qa7ba", "9a7ba", "kahba", "ka7ba",
      "sharmouta", "sharmoota", "manyouk", "manyak", "3ahra", "3ahira", "wsikha", "wasikha", "khawal", "5awal", "dayouth"]
  );

  /* أسماء مسموحة بالاسم الكامل حتى لو أثارت الفلتر (أضف هنا أي اسم بريء يُحجب بالخطأ) */
  const ALLOW = [];
  const ALLOW_SET = {}; ALLOW.forEach(function (n) { ALLOW_SET[clean(n)] = 1; });

  /* =====================================================================
     الفحص
     ===================================================================== */
  function prep(s, re, digits) {
    let t = s.split(re).filter(Boolean);
    const out = t.slice(), run = [];
    const flush = function () { if (run.length > 1) out.push(run.join("")); run.length = 0; };
    t.forEach(function (x) { if (x.length === 1) run.push(x); else flush(); });
    flush();
    return { tok: out, comp: t.join("") };
  }
  function hit(g, v) {
    for (let i = 0; i < g.plain.length; i++) if (g.plain[i].test(v.comp)) return true;
    for (let i = 0; i < g.tok.length; i++) for (let j = 0; j < v.tok.length; j++) if (g.tok[i].test(v.tok[j])) return true;
    return false;
  }
  function isBad(name) {
    const b = base(String(name || "")).slice(0, 80);
    if (ALLOW_SET[b.replace(/[^a-z0-9\u0621-\u064A]/g, "")]) return false;
    const L = /[^a-z\u0621-\u064A]+/, LD = /[^a-z0-9\u0621-\u064A]+/;
    const v1 = prep(b.replace(/[0134578@$!€]/g, function (c) { return LEET1[c]; }), L);   // أرقام → حروف (f4ck ، sh1t)
    const v3 = prep(b.replace(/[0-9]/g, " "), L);                                         // أرقام → فواصل (kos123)
    const v2 = prep(b.replace(/[014@$!€]/g, function (c) { return LEET2[c]; }), LD);      // عربيزي (3ars ، ka7ba)
    return hit(G.N, v1) || hit(G.N, v3) || hit(G.D, v2);
  }

  /* ---------- التحقق الكامل من الاسم (مشترك بين الصفحة والخادم) ---------- */
  const cleanName = function (v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); };
  function nameError(raw) {
    const name = cleanName(raw);
    if (name.length < 2 || name.length > 20) return "bad_length";
    if (!/^[\p{L}\p{M}\p{N} _\-.]+$/u.test(name)) return "bad_chars";
    if (/\d{5,}/.test(name.replace(/[\s\-_.]/g, "")) || /(www|http|\.com|\.net|\.ly|t\.me)/i.test(name)) return "bad_contact";
    if (isBad(name)) return "bad_name";
    return "";
  }

  root.SuperFilter = { isBad: isBad, nameError: nameError, cleanName: cleanName, norm: norm, hid: hid };
})(typeof globalThis !== "undefined" ? globalThis : this);

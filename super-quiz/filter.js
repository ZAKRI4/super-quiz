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
  function runs(w) {
    const r = []; let i = 0;
    while (i < w.length) { let j = i; while (j < w.length && w[j] === w[i]) j++; r.push([w[i], j - i]); i = j; }
    return r;
  }
  const runPat = function (r) { return r[0] + (r[1] > 1 ? "{" + r[1] + ",}" : "+"); };
  const pat = function (w) { return runs(w).map(runPat).join(""); };
  const clean = function (w) { return base(w).replace(/[^a-z0-9\u0621-\u064A]/g, ""); };

  /* نمط "الحجب في أي موضع": يتحمّل حروفاً زائدة بين حروف الكلمة
       عربي  : حروف مدّ/لاتينية (حتى 2) ، ومع الكلمات 5 أحرف فأكثر يقبل أيضاً حرفاً عربياً زائداً (قححخبة)
       إنجليزي: حرف علّة/h/x زائد بين الحروف للكلمات 5 أحرف فأكثر (fuuck ، biatch) */
  function loose(c, ar) {
    const r = runs(c).map(runPat);
    if (ar && c.length >= 4) return r.join(c.length >= 5 ? "(?:[اويa-z]{0,2}|[\\u0621-\\u064A])" : "[اويa-z]{0,2}");
    if (!ar && !/[0-9]/.test(c) && c.length >= 5) return r.join("[aeiouyhx]?");
    return r.join("");
  }

  /* ---------- لواحق وبادئات ---------- */
  const PRE = "(?:ويا|يا|وال|بال|فال|كال|لل|ال|ب|ل|و|ف|ك)?";
  const SUFP = "(?:ها|هم|كم|كن|هن|نا|ني|ي|ك|ه)?";
  const SUFA = "(?:ها|هم|كم|كن|هن|نا|ني|ات|ين|ون|ان|تك|تي|تها|ته|تهم|ي|ك|ه|ا|و)?";
  const SUFE = "(?:s|es|ed|er|ers|ing|in|y|ies|z|zz|head|face|hole)?";
  const PREL = "(?:ya|yaa|ye|el|al|il|wel|w)?";                      // عربيزي: ya kos ، elkos
  const SUFL = "(?:i|a|ah|ak|ek|ik|ha|kom|hom|na|ek|ki)?";
  const AR = /[\u0621-\u064A]/;

  /* مجموعتان: N = بدون أرقام (تُفحص بعد تحويل الأرقام) ، D = عربيزي بأرقام (3ars ، ka7ba) */
  const mkG = function () { return { N: { plain: [], tok: [] }, D: { plain: [], tok: [] } }; };
  const G = mkG();           // القائمة المدمجة
  let CG = mkG();            // قائمة المشرف (تُبنى من setCustom)
  let CALLOW = {};           // أسماء يسمح بها المشرف
  let CUSTOM = { block: [], allow: [] };
  const LIST = [];           // للعرض في لوحة المشرف فقط

  function compile(tier, c, tail) {
    const ar = AR.test(c), t = tail || "";
    if (tier === "S") return { plain: true, re: new RegExp(loose(c, ar) + t) };
    const p = pat(c) + t; let s;
    if (tier === "E") s = p;
    else if (tier === "R") s = (ar ? PRE : "") + p;
    else if (tier === "P") s = ar ? PRE + p + SUFP : p + SUFE;
    else if (tier === "A") s = ar ? PRE + p + SUFA : p + SUFE;
    else if (tier === "L") s = ar ? PRE + p + SUFA : PREL + p + SUFL;
    else return null;
    return { re: new RegExp("^" + s + "$") };
  }
  function add(tier, w, tail, GG, noList) {
    GG = GG || G;
    const c = clean(w); if (!c) return;
    const vs = [c];
    // من يكتب القاف كافاً (قحبة ← كحبة) في الكلمات الطويلة
    if (tier === "S" && AR.test(c) && c.length >= 4 && c.indexOf("ق") > -1) vs.push(c.replace(/ق/g, "ك"));
    vs.forEach(function (v) {
      const o = compile(tier, v, tail); if (!o) return;
      const g = /[0-9]/.test(v) ? GG.D : GG.N;
      g[o.plain ? "plain" : "tok"].push({ re: o.re, w: w });
      // كلمة من 4 أحرف: نقبل حرفاً زائداً من أي نوع (قحخبة) لكن داخل الكلمة الواحدة فقط حتى لا نخلط كلمتين متجاورتين
      if (tier === "S" && AR.test(v) && v.length === 4 && !/[0-9]/.test(v))
        g.tok.push({ re: new RegExp(runs(v).map(runPat).join("(?:[اويa-z]{0,2}|[\\u0621-\\u064A])")), w: w });
    });
    if (!noList && GG === G) LIST.push({ w: String(w), t: tier });
  }
  const addAll = function (tier, list) { list.forEach(function (w) { add(tier, w); }); };

  /* توليد "ابن/بنت/ولد ... + الكلب/الحرام/القحبة ..." دفعة واحدة */
  function combo(rels, arts, tails) {
    LIST.push({ t: "C", w: rels.join(" / ") + "  +  " + tails.map(function (x) { return Array.isArray(x) ? x[0] : x; }).join(" / ") });
    [false, true].forEach(function (dig) {
      const t = tails.filter(function (x) { return /[0-9]/.test(clean(x[0] || x)) === dig; });
      if (!t.length) return;
      const r = "(?:" + rels.map(function (x) { return pat(clean(x)); }).join("|") + ")";
      const a = "(?:" + arts.map(function (x) { return pat(clean(x)); }).join("|") + ")?";
      const tl = "(?:" + t.map(function (x) { return Array.isArray(x) ? pat(clean(x[0])) + x[1] : pat(clean(x)); }).join("|") + ")";
      (dig ? G.D : G.N).plain.push({ re: new RegExp(r + a + tl), w: "عبارة نسب (ابن/بنت + شتيمة)" });
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


  /* =====================================================================
     إضافات موسّعة (لهجة ليبية + عربي + إنجليزي + عربيزي)
     ===================================================================== */
  addAll("S", [
    "كسمكم", "كسامكم", "كسمها", "كسمهم", "كسراسك", "كسراسو", "كسامين", "كسامه", "كسعرضك", "كسخلقك",
    "دينربك", "دينربي", "دينراسك", "دينجدك", "دينعرضك", "دينامه", "دينامها", "دينخلقك",
    "يلعنابو", "يلعنامك", "يلعندين", "يلعنربك", "يلعنخلقك", "يلعنوالد", "يلعنعرض", "يلعنراس",
    "نيكامك", "نيكاختك", "نيكربك", "نيكعرضك", "نيكخلقك", "نيكابوك", "نيكراسك", "نيكمكم",
    "تناك", "منايك", "قحبات", "قحبتك", "شرمطه", "هتلر", "بنلادن",
    "عرصات", "عرصين", "ديوثين", "زناه"
  ]);
  addAll("E", [
    "كوال", "كواله", "كوالين", "كوالات", "كوالة", "كوالي",
    "زاملين", "زاملات", "زمله", "زملين", "زمالي", "زاملي",
    "خوله", "بزازك", "بزازي", "بزازها", "بزازهم",
    "متخلف", "متخلفه", "منحرف", "منحرفه", "واطي", "واطيه", "تافه", "وقح", "وقحه", "سافله",
    "ممحون", "ممحونه", "مومس", "مومسه", "بغيه", "داعر", "داعره", "مثلي", "مثليه", "مثليين",
    "قضيب", "مهبل", "ثدي", "ثديين", "شرج", "زنا", "طز", "جزمه", "مهبول", "مهبوله", "عيري", "عيرك",
    "دواعش", "الدواعش", "ارهابي", "ارهابيه", "ارهابيين", "وصيف", "اوصيف", "وصيفه", "عبيد",
    "نايك", "ناكه", "ناكوه", "كسسك", "منيوكه", "قحبه", "كحبه", "كحاب"
  ]);
  addAll("A", ["قحب", "كحب", "ملعن", "لعنه", "عاهرون", "زبالين"]);
  combo(
    ["ابن", "بنت", "ولد", "اولاد", "ولاد", "اخو", "اخت", "ابو", "ام"],
    ["ال", "ل"],
    ["زامل", "زامله", "كوال", "كواله", "معرص", "مخنث", "خنيث", "منيك", "كحبه", "زباله", "قوادين", "قواد", "جحش"]
  );

  /* إنجليزي: S */
  addAll("S", [
    "motherfucker", "cocksucker", "fuckyou", "fuckoff", "fuckface", "fucker", "fuckin", "clitoris", "whorebag",
    "wanker", "bellend", "knobhead", "cumslut", "cumdump", "facefuck", "gangbang", "threesome", "creampie",
    "bukkake", "cunnilingus", "fellatio", "sodomi", "bestial", "zoophil", "necrophil", "pornhub", "xvideos",
    "xnxx", "xhamster", "redtube", "youporn", "prostitut", "slut", "wetback", "towelhead", "raghead",
    "camel jockey", "nibba", "taliban", "alqaeda", "binladen", "kikes", "dafuq", "dumbfuck", "assfuck", "shitty",
    "bitches", "bitchy", "bastards", "pssy", "pusy", "pusi", "phuck", "fxck", "fucc", "shyt", "cocksucker", "tosser", "twatwaffle"
  ]);
  addAll("E", [
    "negro", "homo", "lesbo", "dyke", "paki", "kkk", "isil", "gtfo", "damn", "sperm", "boner", "bdsm", "fetish", "escort",
    "nipple", "nipples", "vibrator", "incel", "cuck", "fuc", "fucc", "hentai", "ecchi", "bich", "sht", "fck", "azz", "arsch"
  ]);
  addAll("A", ["nutsack", "ballsack", "scrotum", "testicle", "foreskin", "buttplug", "queef", "smegma", "dong", "knob", "schlong"]);

  /* عربيزي ليبي: S */
  addAll("S", [
    "ksomak", "ksmak", "ksmek", "ksomek", "ksemak", "ksamak", "kussomak", "kusomak", "kosomkom", "kosomha", "kosoma",
    "kosommek", "kosamek", "kosemak", "kosmek", "gosomak", "qusomak",
    "mtnak", "metnak", "mitnak", "mtnaak", "mtnek", "mitnek", "metnek", "mtnayak", "mtnayek",
    "charmouta", "charmota", "sharmoota", "sharmouti", "sharameet", "sharmoot", "sharmouch",
    "gahba", "gahbe", "kahbeh", "qahbeh", "qa7beh", "ka7beh", "qa7bat", "ka7bat",
    "dinamak", "dinemak", "dinomak", "dinabook", "dinabouk", "dinamek", "dinakhtak", "dinarabak", "dinrabak",
    "yilan", "yelan", "yel3an", "yil3an", "yel3an", "yin3al", "yen3al",
    "nikomak", "nikmak", "neekmak", "neikmak", "nikmek", "nikmk", "nikhtak", "nikrabak",
    "zamilat", "zamelat", "zamelin", "zamilin", "mkhanath", "mkhanet", "mkhanith", "mkhannath", "khanith", "khaneeth"
  ]);
  /* عربيزي ليبي: L (كلمة كاملة + ya / el / al + لواحق) */
  addAll("L", [
    "kos", "kosa", "kelb", "7mar", "7mara", "hmar", "hmara", "3ars", "3rs", "3ers", "m3ars", "m3rs", "m3ers", "3arsa",
    "zamel", "zaml", "zamil", "zamyl", "zameel", "kwal", "kawal", "kuwal", "kewal", "kwaal",
    "zeb", "zebb", "zbi", "tiz", "tizi", "teez", "nayek", "nayik", "nayak", "nayyak", "mnayek", "mnayak", "mnayik",
    "khawal", "5awal", "5awel", "khawel", "khowal", "7ayawan", "hayawan", "ghabi", "ghaby", "7mara", "wsikh", "wasikh", "wsikha"
  ]);
  combo(
    ["ibn", "ebn", "ibin", "wld", "wled", "walad", "weld", "ould", "wlid", "bint", "bnt", "bent", "ebnt", "akho", "okht", "ukht", "wlad", "awlad"],
    ["el", "al", "l", "il"],
    [["kelb", "(?!i)"], "haram", "7aram", "qahba", "qa7ba", "9a7ba", "kahba", "ka7ba", "zamel", "zaml", "kwal", "kawal", "metnak", "mtnak", "mnayak", "manyak", "mnayek", "3ars", "3rs", "m3ars", "sharmouta", "gahba", "khawal", "5awal"]
  );

  /* أسماء مسموحة بالاسم الكامل حتى لو أثارت الفلتر (يمكن للمشرف إضافة المزيد من اللوحة) */
  const ALLOW = [];
  const ALLOW_SET = {}; ALLOW.forEach(function (n) { ALLOW_SET[clean(n)] = 1; });

  /* =====================================================================
     قائمة المشرف: {block:[{w, m}], allow:[اسم]}
       m = auto | s (في أي موضع) | a (مع بادئات ولواحق) | e (كلمة كاملة)
     ===================================================================== */
  function setCustom(cfg) {
    cfg = cfg || {};
    const ng = mkG(), al = {}, blk = [], alw = [];
    (cfg.block || []).forEach(function (it) {
      const w = String(typeof it === "string" ? it : (it && it.w) || "").replace(/\s+/g, " ").trim().slice(0, 40);
      let m = (it && it.m) || "auto"; if (["auto", "s", "a", "e"].indexOf(m) < 0) m = "auto";
      const c = clean(w); if (c.length < 2) return;
      let t = m === "s" ? "S" : m === "a" ? "A" : m === "e" ? "E" : (c.length >= 5 ? "S" : c.length >= 3 ? "A" : "E");
      if (/\s/.test(w) && t !== "S") t = "S";                   // عبارة من عدة كلمات
      add(t, w, "", ng, true); blk.push({ w: w, m: m });
    });
    (cfg.allow || []).forEach(function (n) {
      const w = String(n || "").replace(/\s+/g, " ").trim().slice(0, 30), c = clean(w);
      if (c) { al[c] = 1; alw.push(w); }
    });
    CG = ng; CALLOW = al; CUSTOM = { block: blk, allow: alw };
  }

  /* =====================================================================
     الفحص
     ===================================================================== */
  function prep(s, re) {
    const t = s.split(re).filter(Boolean);
    const out = t.slice(), run = [];
    const flush = function () { if (run.length > 1) out.push(run.join("")); run.length = 0; };
    t.forEach(function (x) { if (x.length === 1) run.push(x); else flush(); });
    flush();
    return { tok: out, comp: t.join("") };
  }
  function find(g, v) {
    for (let i = 0; i < g.plain.length; i++) if (g.plain[i].re.test(v.comp)) return g.plain[i].w;
    for (let i = 0; i < g.tok.length; i++) for (let j = 0; j < v.tok.length; j++) if (g.tok[i].re.test(v.tok[j])) return g.tok[i].w;
    return "";
  }
  /* يعيد null إن كان الاسم مقبولاً، وإلا {w: الكلمة المطابقة, src: "built-in" | "custom"} */
  function check(name) {
    const b = base(String(name || "")).slice(0, 80);
    const key = b.replace(/[^a-z0-9\u0621-\u064A]/g, "");
    if (ALLOW_SET[key] || CALLOW[key]) return null;
    const L = /[^a-z\u0621-\u064A]+/, LD = /[^a-z0-9\u0621-\u064A]+/;
    const v1 = prep(b.replace(/[0134578@$!€]/g, function (c) { return LEET1[c]; }), L);   // أرقام → حروف (f4ck ، sh1t)
    const v3 = prep(b.replace(/[0-9]/g, " "), L);                                         // أرقام → فواصل (kos123)
    const v2 = prep(b.replace(/[014@$!€]/g, function (c) { return LEET2[c]; }), LD);      // عربيزي (3ars ، ka7ba)
    let w = find(G.N, v1) || find(G.N, v3) || find(G.D, v2);
    if (w) return { w: w, src: "built-in" };
    w = find(CG.N, v1) || find(CG.N, v3) || find(CG.D, v2);
    return w ? { w: w, src: "custom" } : null;
  }
  const isBad = function (name) { return !!check(name); };

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

  root.SuperFilter = {
    isBad: isBad, check: check, nameError: nameError, cleanName: cleanName, norm: norm, hid: hid,
    setCustom: setCustom, getCustom: function () { return CUSTOM; },
    builtIn: function () { return LIST.slice(); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

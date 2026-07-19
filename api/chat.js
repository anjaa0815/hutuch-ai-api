/* ============================================================
   ХӨТӨЧ — AI зөвлөгөөний Vercel Serverless Function
   Google billing огт шаардахгүй. Provider сэлгэдэг:
   Gemini / Groq / Claude / OpenAI-нийцтэй ямар ч API.

   Vercel Environment Variables (Settings → Environment Variables):
     CHAT_API_KEY   = API түлхүүр (нууц)
     CHAT_BASE_URL  = провайдерын endpoint
     CHAT_MODEL     = моделийн нэр
   ============================================================ */

const SYSTEM_PROMPT = `Чи бол hutuch.com сайтын барилгын зөвлөх AI. Зөвхөн монголоор, дүрмийн алдаагүй, товч бөгөөд ойлгомжтой хариулна.

Чиний мэргэжлийн хүрээ: Монголын нөхцөл дэх барилгын материал, хийц, технологи (суурь, хана, дулаалга, дээвэр, халаалт, цахилгаан, сантехник), БНБД норм дүрмийн ерөнхий чиглэл, өртөг зардлын ойлголт, Улаанбаатарын эрс тэс уур амьсгал (-40°C хүйтэн, дулаалгын чухал ач холбогдол).

Дүрэм:
- Хариултаа 2-6 өгүүлбэрт багтаа; шаардлагатай бол богино жагсаалт хэрэглэ.
- Тоон утга ойролцоо гэдгийг тэмдэглэж, нарийн тооцоог hutuch.com-ын Тооцоолуур, Инженерийн тооцоо хэсгээр хийхийг санал болго.
- Даацын бүтээц, цахилгааны угсралт, галын аюулгүй байдал зэрэг сэдэвт мэргэжлийн инженерээр баталгаажуулахыг заавал сануул.
- Мэдэхгүй зүйлдээ мэдэхгүй гэж шударга хэл, таамаг бүү зохио.
- Барилгаас хамааргүй асуултад маш товч хариулаад барилгын сэдэв рүү чиглүүл.
- Хэрэглэгч холбоо барих талаар асуувал: утас 9978-7222, имэйл hutuchshop@gmail.com гэж хэл. Хуурамч дугаар, хаяг ЗОХИОХ ЁСГҮЙ.`;

/* ---------- Өдрийн лимит (Firestore REST API-аар) ----------
   FIREBASE_PROJECT_ID, FIREBASE_API_KEY env-ээр өгнө. Хоёуланг өгөөгүй бол
   лимит идэвхгүй — чат хязгааргүй ажиллана. */
const LIMIT_GUEST = 5;
const LIMIT_USER = 10;

function todayKey() { return new Date().toISOString().slice(0, 10); }

async function checkLimit(uid, ip) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  const key = process.env.FIREBASE_API_KEY;
  if (!pid || !key) return { ok: true, remaining: null }; // лимит идэвхгүй

  // Pro хэрэглэгч эсэхийг шалгах (users/{uid}.isPro)
  let isPro = false;
  if (uid) {
    try {
      const ur = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/proStatus/${uid}?key=${key}`);
      if (ur.ok) {
        const ud = await ur.json();
        isPro = ud.fields?.isPro?.booleanValue === true;
      }
    } catch { /* уншиж чадсангүй — энгийн хэрэглэгч */ }
  }
  if (isPro) return { ok: true, remaining: null, pro: true }; // Pro = хязгааргүй

  const limit = uid ? LIMIT_USER : LIMIT_GUEST;
  const idPart = uid ? ("u_" + uid) : ("ip_" + String(ip).replace(/[^a-zA-Z0-9]/g, ""));
  const docId = todayKey() + "_" + idPart;
  const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/aiUsage/${docId}`;

  // Одоогийн тоог унших
  let count = 0;
  try {
    const r = await fetch(`${base}?key=${key}`);
    if (r.ok) {
      const d = await r.json();
      count = Number(d.fields?.count?.integerValue || 0);
    }
  } catch { /* уншиж чадсангүй — 0-оос эхэлнэ */ }

  if (count >= limit) return { ok: false, remaining: 0, limit, uid: !!uid };

  // Нэмэгдүүлж бичих (PATCH — updateMask-тай учир документ байхгүй бол шинээр үүсгэнэ)
  try {
    const wr = await fetch(`${base}?key=${key}&updateMask.fieldPaths=count&updateMask.fieldPaths=updated`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: {
        count: { integerValue: String(count + 1) },
        updated: { timestampValue: new Date().toISOString() },
      }}),
    });
    if (!wr.ok) {
      const errText = await wr.text();
      console.error("aiUsage write failed:", wr.status, errText);
    }
  } catch (e) { console.error("aiUsage write error:", e.message); }

  return { ok: true, remaining: limit - (count + 1) };
}

export default async function handler(req, res) {
  // CORS — hutuch.com-оос дуудахыг зөвшөөрнө
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || messages.length === 0) { res.status(400).json({ error: "messages шаардлагатай" }); return; }

    const trimmed = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 4000),
    }));

    // --- Өдрийн лимит ---
    let uid = null;
    const authz = req.headers.authorization || "";
    if (authz.startsWith("Bearer ")) {
      // Firebase токеныг задлаад uid авах (шалгалтгүй — зөвхөн тоолуурын түлхүүр болгоно)
      try {
        const payload = JSON.parse(Buffer.from(authz.slice(7).split(".")[1], "base64").toString());
        uid = payload.user_id || payload.sub || null;
      } catch { /* хүчингүй токен = зочин */ }
    }
    const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
    const lim = await checkLimit(uid, ip);
    if (!lim.ok) {
      res.status(429).json({
        error: lim.uid
          ? `Өдрийн ${lim.limit} асуултын лимит дууслаа — маргааш дахин асуугаарай.`
          : `Зочны өдрийн ${lim.limit} асуултын лимит дууслаа — нэвтэрч илүү олон асуулт асуугаарай.`,
        remaining: 0,
      });
      return;
    }

    const baseUrl = process.env.CHAT_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const model = process.env.CHAT_MODEL || "gemini-2.0-flash";
    const key = process.env.CHAT_API_KEY;
    if (!key) { res.status(500).json({ error: "CHAT_API_KEY тохируулагдаагүй" }); return; }

    const isAnthropic = baseUrl.includes("api.anthropic.com");
    let reply = "";

    if (isAnthropic) {
      const r = await fetch(baseUrl, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM_PROMPT, messages: trimmed }),
      });
      const data = await r.json();
      if (!r.ok) { console.error("Provider error:", data); res.status(502).json({ error: "AI үйлчилгээ түр боломжгүй" }); return; }
      reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    } else {
      const r = await fetch(baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimmed] }),
      });
      const data = await r.json();
      if (!r.ok) { console.error("Provider error:", data); res.status(502).json({ error: "AI үйлчилгээ түр боломжгүй" }); return; }
      reply = data.choices?.[0]?.message?.content || "";
    }

    if (!reply) { res.status(502).json({ error: "Хоосон хариу ирлээ" }); return; }
    res.status(200).json({ reply, remaining: lim.remaining });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Серверийн алдаа" });
  }
}

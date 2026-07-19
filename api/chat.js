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
- Барилгаас хамааргүй асуултад маш товч хариулаад барилгын сэдэв рүү чиглүүл.`;

export default async function handler(req, res) {
  // CORS — hutuch.com-оос дуудахыг зөвшөөрнө
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
    res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Серверийн алдаа" });
  }
}

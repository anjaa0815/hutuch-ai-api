# Хөтөч AI API (Vercel)

hutuch.com сайтын AI зөвлөх чатын backend. Google billing шаардахгүй.

## Deploy хийх (нэг удаа)

1. github.com дээр шинэ repo үүсгэ (ж: hutuch-ai-api), энэ 4 файлыг push хий:
   - api/chat.js
   - package.json
   - vercel.json
   - README.md

2. vercel.com → GitHub-аар нэвтэр → Add New Project → энэ repo-г Import

3. Deploy дарахаас өмнө Environment Variables нэмэх:
   CHAT_API_KEY   = <API түлхүүр>
   CHAT_BASE_URL  = https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
   CHAT_MODEL     = gemini-2.0-flash

4. Deploy → дуусахад URL гарна: https://hutuch-ai-api.vercel.app
   Чатын endpoint: https://hutuch-ai-api.vercel.app/api/chat

## hutuch талд холбох

hutuch репогийн .env файлд:
   VITE_CHAT_API_URL=https://hutuch-ai-api.vercel.app/api/chat
дараа нь npm run build + firebase deploy --only hosting

## Provider солих

Vercel → Settings → Environment Variables дээр CHAT_BASE_URL, CHAT_MODEL солиод Redeploy:
- Gemini: .../v1beta/openai/chat/completions  |  gemini-2.0-flash
- Groq:   https://api.groq.com/openai/v1/chat/completions  |  llama-3.3-70b-versatile
- Claude: https://api.anthropic.com/v1/messages  |  claude-haiku-4-5-20251001

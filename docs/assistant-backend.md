# Бэкенд для ИИ-помощника (`POST /api/assistant`)

Фронт уже готов: помощник в CRM (меню **Сервисы → Помощник**) при каждом
вопросе сначала пробует этот эндпоинт, и только если его нет — откатывается
на локальный поиск по инструкциям. Как только эндпоинт появится на воркере,
помощник **сам** начнёт отвечать через Claude, без изменений во фронте.

Ключ Anthropic у вас уже есть (тот, что распознаёт УПД) — переиспользуем его.

## Что присылает фронт

```jsonc
POST /api/assistant      (Authorization: Bearer <token>)
{
  "question": "как создать договор",
  "context": [                         // топ-5 релевантных инструкций (RAG на клиенте)
    { "id": "sales-new-contract", "title": "…", "text": "…до 1600 символов…" }
  ],
  "history": [                         // последние реплики для контекста диалога
    { "role": "user", "text": "…" },
    { "role": "assistant", "text": "…" }
  ]
}
```

> Важно: база знаний целиком живёт во фронте и приходит в `context`. Бэкенду
> **не нужно** знать содержимое CRM — он просто передаёт инструкции в Claude.

## Что должен вернуть

```jsonc
{ "answer": "…текст ответа (можно markdown)…", "sources": ["sales-new-contract"] }
```

Фронт понимает `answer` (или `text`/`message`). `sources` — id инструкций,
на которые опирался ответ (покажутся кнопками «Источники»). Можно не возвращать.

## Готовый обработчик (Node + `@anthropic-ai/sdk`)

```js
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ASSISTANT_SYSTEM = `Ты — встроенный помощник CRM «Atom» для производства
холодильного оборудования. Отвечай по-русски, кратко и по делу, по шагам
(нумерованный список), и коротко поясняй, ЗАЧЕМ нужна функция.

Правила:
- Опирайся ТОЛЬКО на инструкции из блока «КОНТЕКСТ». Не выдумывай кнопки и пути,
  которых там нет.
- Если в контексте нет ответа — честно скажи об этом и предложи открыть раздел
  «Помощь» или спросить директора. Не фантазируй.
- Не давай советов вне CRM. Будь дружелюбным и конкретным.`;

// POST /api/assistant
export async function assistantHandler(req, res) {
  try {
    const { question, context = [], history = [] } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ message: 'Пустой вопрос' });
    }

    const ctxText = context
      .map((c, i) => `### [${c.id}] ${c.title}\n${c.text}`)
      .join('\n\n') || '(подходящих инструкций не найдено)';

    const messages = [
      ...history.slice(-6).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.text || ''),
      })),
      {
        role: 'user',
        content:
          `КОНТЕКСТ (инструкции CRM):\n${ctxText}\n\n` +
          `ВОПРОС ПОЛЬЗОВАТЕЛЯ: ${question}`,
      },
    ];

    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',   // быстро и дёшево; для сложных — claude-sonnet-4-6
      max_tokens: 900,
      system: [
        { type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages,
    });

    const answer = resp.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    // как «источники» отдаём первые 2 переданные инструкции
    const sources = context.slice(0, 2).map(c => c.id);

    res.json({ answer, sources });
  } catch (e) {
    console.error('assistant error', e);
    res.status(500).json({ message: 'Помощник временно недоступен' });
  }
}
```

Подключение роута (Express): `app.post('/api/assistant', authMiddleware, assistantHandler);`
— под той же авторизацией, что и остальные `/api/*`.

## Если воркер на Python

Та же логика через `anthropic` SDK: собрать `system` + `messages`
(история + «КОНТЕКСТ… ВОПРОС…»), вызвать `client.messages.create(model=...,
max_tokens=900, system=..., messages=...)`, вернуть `{"answer": ..., "sources": ...}`.

## Заметки

- **Стоимость**: Haiku 4.5 очень дёшев; типичный ответ ~ доли копейки.
- **Кэширование промпта**: системный промпт помечен `cache_control` — экономит
  токены при потоке вопросов.
- **Безопасность**: эндпоинт под Bearer-токеном, как все `/api/*`. Ключ Anthropic
  остаётся на сервере и никогда не попадает во фронт.

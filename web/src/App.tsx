import {
  useCallback,
  useEffect,
  useState,
  type InputHTMLAttributes,
} from 'react'

type HistoryItem = {
  id: number
  action: string
  detail: unknown
  created_at: number
}

type BatchItem = {
  url: string
  originalName: string
  relativePath?: string
  bytes: number
}

type LlmResponse = {
  jsonPretty: string
  curl: string
  python: string
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function App() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [b64Result, setB64Result] = useState<{
    mime: string
    base64: string
  } | null>(null)

  const [b64Input, setB64Input] = useState('')
  const [b64Mime, setB64Mime] = useState('image/png')
  const [savedUrl, setSavedUrl] = useState<string | null>(null)

  const [singleUrl, setSingleUrl] = useState<string | null>(null)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyIp, setHistoryIp] = useState<string>('')

  const [llmModel, setLlmModel] = useState('gpt-4o')
  const [llmPrompt, setLlmPrompt] = useState(
    '请根据图片内容进行描述，并提取可能对后续工具调用或推理有帮助的结构化要点。'
  )
  const [llmUrlsText, setLlmUrlsText] = useState('')
  const [llmOut, setLlmOut] = useState<LlmResponse | null>(null)
  const [llmTab, setLlmTab] = useState<'json' | 'curl' | 'py'>('curl')

  const refreshHistory = useCallback(async () => {
    const r = await fetch('/api/history?limit=80')
    if (!r.ok) return
    const j = (await r.json()) as { ip: string; items: HistoryItem[] }
    setHistoryIp(j.ip)
    setHistory(j.items)
  }, [])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null)
    setBusy(key)
    try {
      await fn()
      await refreshHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const onImageToB64 = (file: File | undefined) => {
    if (!file) return
    void run('b64', async () => {
      const dataUrl = await readFileAsDataUrl(file)
      const r = await fetch('/api/convert/image-to-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as { mime: string; base64: string }
      setB64Result(j)
    })
  }

  const onB64ToImage = () => {
    void run('save', async () => {
      const r = await fetch('/api/convert/base64-to-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: b64Input, mime: b64Mime }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as { url: string }
      setSavedUrl(j.url)
      setLlmUrlsText((t) => (t ? `${t}\n${j.url}` : j.url))
    })
  }

  const onSingleUpload = (file: File | undefined) => {
    if (!file) return
    void run('up1', async () => {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/upload', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as { url: string }
      setSingleUrl(j.url)
      setLlmUrlsText((t) => (t ? `${t}\n${j.url}` : j.url))
    })
  }

  const onBatchUpload = (files: FileList | null) => {
    if (!files?.length) return
    void run('batch', async () => {
      const fd = new FormData()
      for (const f of Array.from(files)) {
        const path =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name
        fd.append('files', f, path)
      }
      const r = await fetch('/api/upload/batch', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as { items: BatchItem[] }
      setBatchItems(j.items)
      const lines = j.items.map((i) => i.url).join('\n')
      setLlmUrlsText((t) => (t ? `${t}\n${lines}` : lines))
    })
  }

  const buildOpenai = () => {
    const urls = llmUrlsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    void run('llm', async () => {
      const r = await fetch('/api/llm/openai-chat-vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmModel,
          prompt: llmPrompt,
          imageUrls: urls,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = (await r.json()) as LlmResponse
      setLlmOut(j)
      setLlmTab('curl')
    })
  }

  const busyBtn = (id: string) => busy === id

  return (
    <>
      <header>
        <h1>InnerImg</h1>
        <p>
          图片与 Base64 互转、生成可访问的完整图片 URL、文件夹批量上传，以及一键生成{' '}
          <strong>OpenAI Chat Completions（视觉）</strong> 调用示例。
        </p>
      </header>

      <div className="layout">
        <div className="stack">
          {error ? (
            <div className="card err" role="alert">
              {error}
            </div>
          ) : null}

          <section className="card">
            <h2>图片 → Base64</h2>
            <div className="stack">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onImageToB64(e.target.files?.[0])}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!b64Result}
                  onClick={() => b64Result && void copy(b64Result.base64)}
                >
                  复制 Base64
                </button>
                {busyBtn('b64') ? (
                  <span className="hint">处理中…</span>
                ) : null}
              </div>
              {b64Result ? (
                <pre className="block">
                  {b64Result.base64.length > 4000
                    ? `${b64Result.base64.slice(0, 4000)}\n… （已截断展示）`
                    : b64Result.base64}
                </pre>
              ) : null}
            </div>
          </section>

          <section className="card">
            <h2>Base64 → 图片（存盘并返回 URL）</h2>
            <div className="stack">
              <label className="field">
                MIME
                <select
                  value={b64Mime}
                  onChange={(e) => setB64Mime(e.target.value)}
                >
                  <option value="image/png">image/png</option>
                  <option value="image/jpeg">image/jpeg</option>
                  <option value="image/webp">image/webp</option>
                  <option value="image/gif">image/gif</option>
                </select>
              </label>
              <textarea
                placeholder="粘贴 base64（可带或不带 data URL 前缀，服务器按纯 base64 处理）"
                value={b64Input}
                onChange={(e) => setB64Input(e.target.value)}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={busyBtn('save')}
                  onClick={() => onB64ToImage()}
                >
                  解码并上传
                </button>
              </div>
              {savedUrl ? (
                <>
                  <div className="url-pill">{savedUrl}</div>
                  <img className="preview-img" src={savedUrl} alt="结果预览" />
                </>
              ) : null}
            </div>
          </section>

          <section className="card">
            <h2>单文件上传</h2>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onSingleUpload(e.target.files?.[0])}
            />
            {singleUrl ? (
              <>
                <div className="url-pill">{singleUrl}</div>
                <img
                  className="preview-img"
                  src={singleUrl}
                  alt="上传预览"
                />
              </>
            ) : null}
          </section>

          <section className="card">
            <h2>文件夹批量上传</h2>
            <p className="hint">
              选择本地文件夹后，会为每张图生成唯一文件名并保留子目录结构；返回完整 URL
              列表，可直接用于大模型 <code>image_url</code>。
            </p>
            <input
              type="file"
              multiple
              {...({ webkitdirectory: '' } as InputHTMLAttributes<HTMLInputElement>)}
              onChange={(e) => onBatchUpload(e.target.files)}
            />
            {batchItems.length ? (
              <ul className="history-list">
                {batchItems.map((it) => (
                  <li key={it.url}>
                    <div>
                      <strong>{it.relativePath || it.originalName}</strong>
                    </div>
                    <code>{it.url}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card">
            <h2>OpenAI 视觉调用（一键生成）</h2>
            <p className="hint">
              生成符合{' '}
              <a
                href="https://platform.openai.com/docs/api-reference/chat/create"
                target="_blank"
                rel="noreferrer"
              >
                Chat Completions
              </a>{' '}
              多模态 <code>messages</code> 的请求体，以及可执行的{' '}
              <code>curl</code> / Python 示例。将{' '}
              <code>OPENAI_API_KEY</code> 注入环境后即可调用。
            </p>
            <div className="stack">
              <label className="field">
                模型
                <input
                  type="text"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                />
              </label>
              <label className="field">
                文本提示
                <textarea
                  value={llmPrompt}
                  onChange={(e) => setLlmPrompt(e.target.value)}
                  rows={3}
                />
              </label>
              <label className="field">
                图片 URL 列表（每行一个，来自上方上传结果或任意公网可访问地址）
                <textarea
                  value={llmUrlsText}
                  onChange={(e) => setLlmUrlsText(e.target.value)}
                  rows={5}
                />
              </label>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={busyBtn('llm')}
                  onClick={() => buildOpenai()}
                >
                  生成 OpenAI 调用策略
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!llmOut}
                  onClick={() => {
                    const t =
                      llmTab === 'json'
                        ? llmOut!.jsonPretty
                        : llmTab === 'curl'
                          ? llmOut!.curl
                          : llmOut!.python
                    void copy(t)
                  }}
                >
                  复制当前标签内容
                </button>
              </div>
              {llmOut ? (
                <>
                  <div className="tabs">
                    <button
                      type="button"
                      className={llmTab === 'json' ? 'active' : ''}
                      onClick={() => setLlmTab('json')}
                    >
                      JSON 请求体
                    </button>
                    <button
                      type="button"
                      className={llmTab === 'curl' ? 'active' : ''}
                      onClick={() => setLlmTab('curl')}
                    >
                      cURL
                    </button>
                    <button
                      type="button"
                      className={llmTab === 'py' ? 'active' : ''}
                      onClick={() => setLlmTab('py')}
                    >
                      Python
                    </button>
                  </div>
                  <pre className="block">
                    {llmTab === 'json'
                      ? llmOut.jsonPretty
                      : llmTab === 'curl'
                        ? llmOut.curl
                        : llmOut.python}
                  </pre>
                </>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="card">
          <h2>当前 IP 历史</h2>
          <p className="hint">
            服务端按 <code>req.ip</code> /{' '}
            <code>X-Forwarded-For</code> 记录操作，便于审计与回溯。
          </p>
          <p className="hint">
            当前解析 IP：<strong>{historyIp || '—'}</strong>
          </p>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void refreshHistory()}
          >
            刷新
          </button>
          <ul className="history-list">
            {history.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{h.action}</strong>{' '}
                  <span className="hint">
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                </div>
                <code>{JSON.stringify(h.detail)}</code>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  )
}

export default App

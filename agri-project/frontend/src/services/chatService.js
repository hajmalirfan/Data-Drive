import api, { API_BASE_URL } from './api'

export const getChatStatus = () => api.get('/api/chat/status').then((r) => r.data)

export const listConversations = () =>
  api.get('/api/chat/conversations').then((r) => r.data)

export const createConversation = (title) =>
  api.post('/api/chat/conversations', { title }).then((r) => r.data)

export const getConversation = (id) =>
  api.get(`/api/chat/conversations/${id}`).then((r) => r.data)

export const renameConversation = (id, title) =>
  api.patch(`/api/chat/conversations/${id}`, { title }).then((r) => r.data)

export const deleteConversation = (id) =>
  api.delete(`/api/chat/conversations/${id}`)

function parseEvent(block) {
  let event = 'message'
  const dataLines = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

async function readError(response) {
  try {
    const data = await response.json()
    return data?.detail || 'Request failed'
  } catch {
    return `Request failed (${response.status})`
  }
}

export async function streamMessage(
  conversationId,
  content,
  language,
  provider = 'gemini',
  handlers = {}
) {
  const token = localStorage.getItem('token')
  let response
  try {
    response = await fetch(
      `${API_BASE_URL}/api/chat/conversations/${conversationId}/messages/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content, language, provider }),
      }
    )
  } catch {
    throw new Error('Network error. Check that the backend is running and try again.')
  }

  if (!response.ok) {
    throw new Error(await readError(response))
  }
  if (!response.body) {
    throw new Error('Streaming is not supported by this browser')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processBlock = (block) => {
    const parsed = parseEvent(block)
    if (!parsed) return
    if (parsed.event === 'start') handlers.onStart?.(parsed.data)
    else if (parsed.event === 'delta') handlers.onDelta?.(parsed.data)
    else if (parsed.event === 'done') handlers.onDone?.(parsed.data)
    else if (parsed.event === 'error') {
      const error = new Error(parsed.data?.detail || 'The assistant could not reply')
      error.isStreamError = true
      throw error
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        if (block.trim()) processBlock(block)
      }
    }
    if (buffer.trim()) processBlock(buffer)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
}

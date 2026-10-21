import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import {
  createConversation,
  deleteConversation,
  getChatStatus,
  getConversation,
  listConversations,
  streamMessage,
} from '../services/chatService'
import Icon from '../components/Icons'
import './Chat.css'

function TypingDots() {
  return (
    <span className="typing" aria-label="Assistant is typing">
      <span />
      <span />
      <span />
    </span>
  )
}

export default function Chat() {
  const { t, lang } = useLanguage()

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const scrollRef = useRef(null)
  const textareaRef = useRef(null)

  const refreshStatus = () => {
    getChatStatus().then(setStatus).catch(() => setStatus({ available: false }))
  }

  useEffect(() => {
    refreshStatus()
    listConversations()
      .then(setConversations)
      .catch(() => setError(t('chatError')))
      .finally(() => setLoadingList(false))
  }, []) // eslint-disable-line

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  const focusInput = () => setTimeout(() => textareaRef.current?.focus(), 30)

  const upsertConversation = (list, conversation) => [
    conversation,
    ...list.filter((item) => item.id !== conversation.id),
  ]

  const startNewChat = () => {
    setActiveId(null)
    setMessages([])
    setError('')
    setSidebarOpen(false)
    focusInput()
  }

  const openConversation = async (id) => {
    if (id === activeId && messages.length) {
      setSidebarOpen(false)
      return
    }
    setActiveId(id)
    setSidebarOpen(false)
    setError('')
    setLoadingMessages(true)
    try {
      const detail = await getConversation(id)
      setMessages(detail.messages || [])
    } catch (err) {
      setError(err.response?.data?.detail || t('chatError'))
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm(`${t('chatDelete')}?`)) return
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((item) => item.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setMessages([])
      }
    } catch (err) {
      setError(err.response?.data?.detail || t('chatError'))
    }
  }

  const handleSend = async () => {
    const content = input.trim()
    if (!content || sending) return

    setError('')
    setInput('')
    setSending(true)

    const optimisticId = `temp-user-${Date.now()}`
    const assistantTempId = `temp-assistant-${Date.now()}`
    const optimistic = { id: optimisticId, role: 'user', content }
    const assistantPlaceholder = { id: assistantTempId, role: 'assistant', content: '' }
    setMessages((prev) => [...prev, optimistic])

    let conversationId = activeId
    try {
      if (!conversationId) {
        const conversation = await createConversation()
        conversationId = conversation.id
        setActiveId(conversation.id)
        setConversations((prev) => upsertConversation(prev, conversation))
      }

      await streamMessage(conversationId, content, lang, {
        onStart: ({ user_message, conversation }) => {
          setMessages((prev) => [
            ...prev.filter((item) => item.id !== optimisticId),
            user_message,
            assistantPlaceholder,
          ])
          setConversations((prev) => upsertConversation(prev, conversation))
        },
        onDelta: ({ content: chunk }) => {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantTempId
                ? { ...item, content: item.content + chunk }
                : item
            )
          )
        },
        onDone: ({ assistant_message, conversation }) => {
          setMessages((prev) =>
            prev.map((item) => (item.id === assistantTempId ? assistant_message : item))
          )
          setConversations((prev) => upsertConversation(prev, conversation))
        },
      })
    } catch (err) {
      setError(err.message || t('chatError'))
      if (conversationId) {
        try {
          const detail = await getConversation(conversationId)
          setMessages(detail.messages || [])
        } catch {
          setMessages((prev) => prev.filter((item) => item.id !== assistantTempId))
        }
      } else {
        setMessages((prev) => prev.filter((item) => item.id !== optimisticId))
        setInput(content)
      }
    } finally {
      setSending(false)
      listConversations().then(setConversations).catch(() => {})
      focusInput()
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleSuggestion = (text) => {
    setInput(text)
    focusInput()
  }

  const suggestions = [
    t('chatSuggestion1'),
    t('chatSuggestion2'),
    t('chatSuggestion3'),
    t('chatSuggestion4'),
  ]

  const lastMessage = messages[messages.length - 1]

  return (
    <div className="chat-page">
      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="chat-sidebar-head">
          <div className="chat-brand">
            <span className="chat-brand-mark"><Icon name="sparkles" size={17} /></span>
            <span>
              <strong>SmartAg AI</strong>
              <small>Farm & market assistant</small>
            </span>
          </div>
          <button type="button" className="chat-new" onClick={startNewChat}>
            <span className="chat-new-plus"><Icon name="plus" size={16} /></span> {t('chatNew')}
          </button>
        </div>

        <div className="chat-history-label">{t('chatHistory')}</div>

        <div className="chat-conversations">
          {loadingList && <p className="chat-muted">{t('wait')}</p>}
          {!loadingList && conversations.length === 0 && (
            <p className="chat-muted">{t('chatNoChats')}</p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              role="button"
              tabIndex={0}
              className={`chat-conv ${activeId === conversation.id ? 'active' : ''}`}
              onClick={() => openConversation(conversation.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openConversation(conversation.id)
                }
              }}
            >
              <span className="chat-conv-title">{conversation.title}</span>
              <button
                type="button"
                className="chat-conv-delete"
                title={t('chatDelete')}
                aria-label={t('chatDelete')}
                onClick={(event) => {
                  event.stopPropagation()
                  handleDelete(conversation.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="chat-sidebar-foot">
          <div className="chat-status">
            <span className={`status-dot ${status?.available ? 'ok' : 'bad'}`} />
            <span>
              {status?.available ? status.model : status ? t('chatOffline') : t('wait')}
            </span>
          </div>
          <p className="chat-side-note">
            Answers are generated locally by Ollama using your SmartAg context.
          </p>
        </div>
      </aside>

      {sidebarOpen && <div className="chat-overlay" onClick={() => setSidebarOpen(false)} />}

      <main className="chat-main">
        <header className="chat-topbar">
          <button
            type="button"
            className="chat-menu"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label="Toggle conversations"
          >
            <Icon name="menu" size={18} />
          </button>
          <div className="chat-topbar-title">
            <strong>{t('chatTitle')}</strong>
            <small>{status?.available ? `${status.model} · connected` : 'Checking Ollama connection'}</small>
          </div>
          <div className="chat-topbar-actions">
            <span className={`chat-connection ${status?.available ? 'ok' : 'bad'}`}>
              <i /> {status?.available ? 'Online' : 'Offline'}
            </span>
          </div>
        </header>

        {status && !status.available && (
          <div className="chat-warning">
            <span>{status.detail || t('chatOfflineD')}</span>
            <button type="button" onClick={refreshStatus}>{t('chatRetry')}</button>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-thread">
            {loadingMessages ? (
              <div className="chat-loading">{t('wait')}</div>
            ) : messages.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-empty-logo"><Icon name="sparkles" size={25} /></div>
                <h1>{t('chatEmptyTitle')}</h1>
                <p>{t('chatEmptySub')}</p>
                <div className="chat-suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="chat-suggestion"
                      onClick={() => handleSuggestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`chat-msg ${message.role}`}>
                  {message.role === 'assistant' && (
                    <div className="chat-avatar"><Icon name="leaf" size={15} /></div>
                  )}
                  <div className="chat-bubble">
                    {message.content ? message.content : <TypingDots />}
                  </div>
                </div>
              ))
            )}
            {sending && lastMessage?.role === 'user' && (
              <div className="chat-msg assistant">
                <div className="chat-avatar"><Icon name="leaf" size={15} /></div>
                <div className="chat-bubble"><TypingDots /></div>
              </div>
            )}
          </div>
        </div>

        <div className="chat-composer-wrap">
          <div className="chat-composer-block">
            {error && <div className="chat-error" role="alert">{error}</div>}
            <div className="chat-composer">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                placeholder={t('chatPlaceholder')}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                aria-label={t('chatPlaceholder')}
              />
              <button
                type="button"
                className="chat-send"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                aria-label={t('chatSend')}
                title={t('chatSend')}
              >
                <Icon name="send" size={16} />
              </button>
            </div>
            <p className="chat-hint">{t('chatHint')}</p>
          </div>
        </div>
      </main>
    </div>
  )
}

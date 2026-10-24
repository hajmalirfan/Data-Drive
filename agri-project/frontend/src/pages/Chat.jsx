import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import {
  createConversation,
  deleteConversation,
  getChatStatus,
  getConversation,
  listConversations,
  streamMessage,
  transcribeAudio,
} from '../services/chatService'
import Icon from '../components/Icons'
import useVoiceInput, { MAX_RECORD_SECONDS } from '../hooks/useVoiceInput'
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
  const { t, lang, languages } = useLanguage()

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // Shown under the typing dots when the first words take longer than usual.
  const [slowReply, setSlowReply] = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [provider, setProvider] = useState(() =>
    localStorage.getItem('chat_provider') === 'ollama' ? 'ollama' : 'gemini'
  )

  const scrollRef = useRef(null)
  const textareaRef = useRef(null)

  // Voice input: record, transcribe on the backend in the app language, append to the draft.
  const voice = useVoiceInput(async (wav) => {
    const { text } = await transcribeAudio(wav, lang).catch((err) => {
      throw new Error(err.response?.data?.detail || t('voice.errFailed'))
    })
    if (!text?.trim()) throw new Error(t('voice.errNoSpeech'))
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text.trim()}` : text.trim()))
    setTimeout(() => textareaRef.current?.focus(), 30)
  })
  const voiceErrorText = {
    unsupported: t('voice.errUnsupported'),
    denied: t('voice.errDenied'),
    nomic: t('voice.errNoMic'),
  }[voice.error] || voice.error
  const recording = voice.state === 'recording'
  const transcribing = voice.state === 'processing'
  const voiceLanguage = languages.find((item) => item.code === lang)?.native || lang

  const refreshStatus = () => {
    getChatStatus().then(setStatus).catch(() => setStatus({ available: false }))
  }

  const selectProvider = (next) => {
    setProvider(next)
    localStorage.setItem('chat_provider', next)
    setError('')
  }

  const providerInfo = status?.providers?.find((item) => item.name === provider)
  const providerAvailable = providerInfo
    ? providerInfo.available
    : provider === 'gemini' && Boolean(status?.available)
  const providerModel =
    providerInfo?.model || (provider === 'gemini' ? status?.model : '') || ''
  const providerDetail = providerInfo?.detail || (provider === 'gemini' ? status?.detail : '')
  const providerOfflineLabel =
    provider === 'ollama' ? 'Ollama offline' : t('chatOffline')

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
    setSlowReply(false)
    const slowTimer = setTimeout(() => setSlowReply(true), 12000)

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

      await streamMessage(conversationId, content, lang, provider, {
        onStart: ({ user_message, conversation }) => {
          setMessages((prev) => [
            ...prev.filter((item) => item.id !== optimisticId),
            user_message,
            assistantPlaceholder,
          ])
          setConversations((prev) => upsertConversation(prev, conversation))
        },
        onDelta: ({ content: chunk }) => {
          clearTimeout(slowTimer)
          setSlowReply(false)
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
      clearTimeout(slowTimer)
      setSlowReply(false)
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
            <span className={`status-dot ${providerAvailable ? 'ok' : 'bad'}`} />
            <span>
              {providerInfo
                ? providerAvailable
                  ? providerModel
                  : providerOfflineLabel
                : t('wait')}
            </span>
          </div>
          <p className="chat-side-note">
            Answers come from Gemini or your local Ollama model using your SmartAg context.
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
            <small>
              {providerModel
                ? `${providerModel} · ${providerAvailable ? 'configured' : 'offline'}`
                : 'Checking AI configuration'}
            </small>
          </div>
          <div className="chat-topbar-actions">
            <div className="chat-provider-switch" role="group" aria-label="AI provider">
              <button
                type="button"
                className={provider === 'gemini' ? 'active' : ''}
                aria-pressed={provider === 'gemini'}
                onClick={() => selectProvider('gemini')}
                disabled={sending}
              >
                Gemini
              </button>
              <button
                type="button"
                className={provider === 'ollama' ? 'active' : ''}
                aria-pressed={provider === 'ollama'}
                onClick={() => selectProvider('ollama')}
                disabled={sending}
              >
                Ollama
              </button>
            </div>
            <span className={`chat-connection ${providerAvailable ? 'ok' : 'bad'}`}>
              <i /> {providerAvailable ? 'Online' : 'Offline'}
            </span>
          </div>
        </header>

        {status && !providerAvailable && (
          <div className="chat-warning">
            <span>
              {providerDetail ||
                (provider === 'ollama'
                  ? 'Start Ollama and make sure the model is pulled.'
                  : t('chatOfflineD'))}
            </span>
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
                    {message.content ? message.content : (
                      <>
                        <TypingDots />
                        {slowReply && <small className="chat-slow">{t('chatSlow')}</small>}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            {sending && lastMessage?.role === 'user' && (
              <div className="chat-msg assistant">
                <div className="chat-avatar"><Icon name="leaf" size={15} /></div>
                <div className="chat-bubble">
                  <TypingDots />
                  {slowReply && <small className="chat-slow">{t('chatSlow')}</small>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="chat-composer-wrap">
          <div className="chat-composer-block">
            {error && <div className="chat-error" role="alert">{error}</div>}
            {voiceErrorText && (
              <div className="chat-error" role="alert">
                {voiceErrorText}
                <button type="button" className="chat-voice-dismiss" onClick={() => voice.setError('')} aria-label={t('common.close')}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            )}
            <div className={`chat-composer ${recording ? 'is-recording' : ''}`}>
              {recording ? (
                <div className="chat-voice-live" role="status" aria-live="polite">
                  <span className="chat-voice-dot" aria-hidden="true" />
                  <span>{t('voice.listening', [voiceLanguage])}</span>
                  <span className="chat-voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                  <b>0:{String(voice.seconds).padStart(2, '0')} / 0:{MAX_RECORD_SECONDS}</b>
                  <button type="button" className="chat-voice-cancel" onClick={voice.cancel}>{t('common.cancel')}</button>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  placeholder={transcribing ? t('voice.transcribing') : t('chatPlaceholder')}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending || transcribing}
                  aria-label={t('chatPlaceholder')}
                />
              )}
              <button
                type="button"
                className={`chat-mic ${recording ? 'recording' : ''}`}
                onClick={recording ? voice.stop : voice.start}
                disabled={sending || transcribing || !voice.supported}
                aria-label={recording ? t('voice.stop') : t('voice.start', [voiceLanguage])}
                title={recording ? t('voice.stop') : t('voice.start', [voiceLanguage])}
                aria-pressed={recording}
              >
                {transcribing ? (
                  <span className="ui-spinner chat-mic-spinner" />
                ) : recording ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" /></svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="chat-send"
                onClick={handleSend}
                disabled={!input.trim() || sending || recording || transcribing}
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

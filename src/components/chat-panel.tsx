"use client"

import { Bot, Loader2, Send, User } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button.tsx"
import { Input } from "@/components/ui/input.tsx"
import { cn } from "@/lib/utils.ts"

export interface ChatMessage {
  id: string
  from: "replik" | "user"
  text: string
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void>
  pending: boolean
  className?: string
}

export function ChatPanel({ messages, onSend, pending, className }: ChatPanelProps) {
  const [input, setInput] = React.useState("")
  const listRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when message count changes
  const messageCount = messages.length
  React.useEffect(() => {
    const el = listRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messageCount])

  async function handleSend() {
    const text = input.trim()
    if (!text || pending) return
    setInput("")
    await onSend(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-card border border-border bg-surface-elevated shadow-tight overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot className="size-4 text-mode-live" strokeWidth={1.8} />
        <span className="text-callout font-semibold text-fg-1">Chat con Replik</span>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className="flex flex-col gap-3 overflow-y-auto p-4"
        style={{ minHeight: 180, maxHeight: 320 }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex items-start gap-2 max-w-[90%]",
              msg.from === "user" ? "self-end flex-row-reverse" : "self-start",
            )}
          >
            <div
              className={cn(
                "size-6 shrink-0 rounded-full flex items-center justify-center",
                msg.from === "replik" ? "bg-mode-live text-white" : "bg-surface-muted text-fg-2",
              )}
            >
              {msg.from === "replik" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
            </div>
            <div
              className={cn(
                "rounded-control px-3 py-2 text-body leading-snug",
                msg.from === "replik"
                  ? "bg-surface text-fg-1 border border-border"
                  : "bg-mode-live text-white",
              )}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 self-start">
            <div className="size-6 rounded-full bg-mode-live flex items-center justify-center">
              <Loader2 className="size-3.5 animate-spin text-white" />
            </div>
            <div className="rounded-control px-3 py-2 bg-surface border border-border">
              <div className="flex gap-1 items-center">
                <div className="size-1.5 rounded-full bg-fg-3 animate-bounce [animation-delay:0ms]" />
                <div className="size-1.5 rounded-full bg-fg-3 animate-bounce [animation-delay:150ms]" />
                <div className="size-1.5 rounded-full bg-fg-3 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Escribe qué quieres cambiar…"
          disabled={pending}
          className="flex-1"
        />
        <Button
          type="button"
          size="icon"
          onClick={() => {
            void handleSend()
          }}
          disabled={!input.trim() || pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  )
}

"use client";

import { useState, useRef, useEffect } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (text.trim() && !disabled) {
      onSend(text.trim());
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'; // Reset height
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  return (
    <div className={cn(
      "bg-white rounded-3xl p-2 border border-neutral-200 shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-end gap-2 transition-all focus-within:ring-2 focus-within:ring-primary/20",
      disabled ? "opacity-70" : ""
    )}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your data..."
        disabled={disabled}
        className="flex-1 max-h-[150px] min-h-[44px] bg-transparent resize-none outline-none py-2.5 px-4 text-neutral-800 placeholder:text-neutral-400 custom-scrollbar disabled:cursor-not-allowed"
        rows={1}
      />
      <button
        onClick={handleSubmit}
        disabled={!text.trim() || disabled}
        className="w-[44px] h-[44px] shrink-0 rounded-full bg-primary flex items-center justify-center text-white hover:bg-primary/90 disabled:bg-neutral-100 disabled:text-neutral-400 transition-colors"
      >
        <SendHorizontal className="w-5 h-5" />
      </button>
    </div>
  );
}

"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { MockRibbon } from "@/components/ui/MockRibbon";
import type { ChatEntry } from "@/lib/mock-data";

export function TeamChatWidget({
  entries,
  onSend,
}: {
  entries: ChatEntry[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div>
      <MockRibbon>DEMO — local-only · ไม่มี backend (ข้อความไม่ถูกบันทึก)</MockRibbon>
      <div className="mb-2 max-h-32 min-h-8 overflow-y-auto scrollbar-thin text-xs">
        {entries.length === 0 ? (
          <div className="text-[10px] text-muted-foreground">
            ยังไม่มีบทสนทนา — สลับ &quot;คุยกันเอง&quot; เปิด หรือจิ้มตัวละครให้พูด
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="py-0.5">
              <span className="font-semibold text-foreground">{e.author}: </span>
              <span className="text-muted-foreground">{e.text}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Type a message..."
          className="min-w-0 flex-1 rounded-sm border border-border/60 bg-black/30 px-2 py-1.5 text-xs outline-none focus:border-primary/60"
        />
        <button
          type="button"
          onClick={submit}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-primary/80 text-primary-foreground hover:bg-primary"
          aria-label="send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

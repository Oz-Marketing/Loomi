'use client';

import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

export interface SmsThreadMessage {
  message: string;
  mediaUrls: string[];
}

interface IphoneSmsPreviewProps {
  dealerName: string;
  /** Thread of messages — rendered as stacked incoming bubbles (a conversation).
   *  When omitted, falls back to the single-message props below. */
  messages?: SmsThreadMessage[];
  message?: string;
  mediaUrls?: string[];
  isMms?: boolean;
}

/**
 * Phone-mockup preview of outbound SMS/MMS. Used by the SMS Message step (single
 * message) and the campaign overview (a whole campaign's texts stacked as a
 * conversation thread). Renders the content as incoming bubbles — the
 * recipient's perspective.
 */
export function IphoneSmsPreview({
  dealerName,
  messages,
  message,
  mediaUrls,
  isMms,
}: IphoneSmsPreviewProps) {
  const items: SmsThreadMessage[] = messages ?? [
    { message: message ?? '', mediaUrls: mediaUrls ?? [] },
  ];
  const hasContent = items.some((i) => i.message.trim() || i.mediaUrls.length > 0);
  const showMms = isMms ?? items.some((i) => i.mediaUrls.length > 0);
  const initials = dealerName
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  return (
    <div className="mx-auto" style={{ width: 320 }}>
      <div className="relative rounded-[44px] bg-black p-[10px] shadow-2xl">
        <div className="relative rounded-[34px] bg-white overflow-hidden" style={{ height: 600 }}>
          {/* Dynamic island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[100px] h-[28px] rounded-full bg-black z-20" />

          {/* iOS status bar */}
          <div className="absolute inset-x-0 top-0 z-10 pt-3 pb-2 flex items-center justify-between px-6 text-[11px] font-semibold text-black">
            <span className="tabular-nums">9:41</span>
            <span className="opacity-0">{initials}</span>
            <span className="inline-flex items-center gap-1.5 text-black">
              {/* signal */}
              <span className="inline-flex items-end gap-[1.5px] h-2.5">
                <span className="w-[2px] h-1 bg-black rounded-[0.5px]" />
                <span className="w-[2px] h-1.5 bg-black rounded-[0.5px]" />
                <span className="w-[2px] h-2 bg-black rounded-[0.5px]" />
                <span className="w-[2px] h-2.5 bg-black rounded-[0.5px]" />
              </span>
              {/* wifi */}
              <svg viewBox="0 0 16 12" className="w-3.5 h-3" fill="currentColor" aria-hidden>
                <path d="M8 11.5l1.8-1.8a2.5 2.5 0 00-3.6 0L8 11.5zM3.4 6.9l1.5 1.5a4.4 4.4 0 016.2 0l1.5-1.5a6.5 6.5 0 00-9.2 0zM.5 4l1.5 1.5a8.5 8.5 0 0112 0L15.5 4a10.5 10.5 0 00-15 0z" />
              </svg>
              {/* battery */}
              <span className="inline-flex items-center">
                <span className="w-5 h-2.5 border border-black rounded-[2px] p-[1px]">
                  <span className="block w-full h-full bg-black rounded-[1px]" />
                </span>
                <span className="w-[1.5px] h-1.5 bg-black rounded-r-[0.5px] -ml-[0.5px]" />
              </span>
            </span>
          </div>

          {/* Conversation header */}
          <div className="pt-12 pb-3 px-4 border-b border-gray-200 bg-white">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-base font-semibold flex items-center justify-center">
                {initials || '?'}
              </div>
              <p className="text-[11px] font-medium text-black text-center max-w-[200px] truncate">
                {dealerName}
              </p>
              <p className="text-[9px] text-gray-500 -mt-0.5">
                {showMms ? 'MMS' : 'Text Message'}
              </p>
            </div>
          </div>

          {/* Messages — each item is an incoming bubble; multiple stack as a thread */}
          <div className="flex flex-col gap-2 px-3 py-4 overflow-auto" style={{ height: 'calc(100% - 168px)' }}>
            {hasContent ? (
              items.map((item, idx) => {
                if (!item.message.trim() && item.mediaUrls.length === 0) return null;
                return (
                  <div key={idx} className="flex flex-col gap-1 max-w-[80%] self-start">
                    {item.mediaUrls.length > 0 && (
                      <div className={`grid gap-1 ${item.mediaUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        {item.mediaUrls.map((url) => (
                          <div
                            key={url}
                            className="rounded-2xl overflow-hidden border border-gray-200 bg-gray-100"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="w-full h-auto object-cover" />
                          </div>
                        ))}
                      </div>
                    )}
                    {item.message.trim() && (
                      <div className="bg-[#e5e5ea] text-black text-[13px] leading-snug rounded-2xl px-3 py-2 whitespace-pre-wrap break-words">
                        {item.message}
                      </div>
                    )}
                    {idx === items.length - 1 && (
                      <span className="text-[9px] text-gray-400 mt-0.5 ml-2">Delivered</span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 text-gray-400">
                <ChatBubbleLeftRightIcon className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-[11px]">Your message will appear here</p>
              </div>
            )}
          </div>

          {/* iMessage input footer */}
          <div className="absolute inset-x-0 bottom-0 bg-white border-t border-gray-200 px-3 py-2.5 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-xs">
              +
            </div>
            <div className="flex-1 h-7 rounded-full border border-gray-300 px-3 flex items-center text-[11px] text-gray-400">
              iMessage
            </div>
            <svg viewBox="0 0 16 16" className="w-5 h-5 text-gray-400" fill="currentColor" aria-hidden>
              <path d="M8 1a2 2 0 00-2 2v4a2 2 0 104 0V3a2 2 0 00-2-2zm-3 6a3 3 0 006 0h1a4 4 0 01-3.5 3.97V13H10v1H6v-1h1.5v-2.03A4 4 0 014 7h1z" />
            </svg>
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[100px] h-[4px] rounded-full bg-black/80" />
        </div>
      </div>
    </div>
  );
}

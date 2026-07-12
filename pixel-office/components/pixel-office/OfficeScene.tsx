import type { AgentsResponse } from "@/types/agent";
import { OfficeWorkers } from "./OfficeWorkers";

const NEON_LINES: Array<{ text: string; color: string }> = [
  { text: "EAT", color: "#ff3b6a" },
  { text: "SLEEP", color: "#ffd23b" },
  { text: "CODE", color: "#3bff7a" },
  { text: "REPEAT", color: "#ff8a3b" },
];

function NeonSign() {
  return (
    <div className="absolute left-[720px] top-[30px] flex flex-col gap-1 rounded border-2 border-white/10 bg-black/40 px-4 py-3">
      {NEON_LINES.map((line) => (
        <span
          key={line.text}
          className="font-pixel text-lg leading-none"
          style={{
            color: line.color,
            textShadow: `0 0 6px ${line.color}, 0 0 14px ${line.color}`,
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}

function StudioSign() {
  return (
    <div className="absolute left-[980px] top-[70px] w-[300px] rounded border-4 border-[#5a4632] bg-[#2a2018] px-4 py-3 text-center shadow-[0_0_25px_rgba(0,0,0,0.5)]">
      <div className="font-pixel text-xl leading-relaxed text-[#f2e6c9]">
        PIXEL
        <br />
        DREAM
      </div>
      <div className="mt-1 font-pixel text-[10px] tracking-widest text-[#c9a86a]">
        — GAMES —
      </div>
    </div>
  );
}

function Window() {
  return (
    <div className="absolute left-[600px] top-[10px] h-[220px] w-[300px] overflow-hidden rounded border-4 border-[#4a3a2a] bg-gradient-to-b from-[#7ec8f2] to-[#bfe7ff]">
      <div
        className="absolute inset-0"
        style={{
          clipPath:
            "polygon(0% 100%, 0% 70%, 10% 65%, 22% 72%, 35% 60%, 48% 68%, 60% 55%, 75% 66%, 88% 58%, 100% 68%, 100% 100%)",
          background: "#9fb3c8",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-full bg-[repeating-linear-gradient(0deg,rgba(90,70,50,0.25)_0px,rgba(90,70,50,0.25)_3px,transparent_3px,transparent_18px)]" />
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-[#4a3a2a]" />
    </div>
  );
}

function Bookshelf({ left, top }: { left: number; top: number }) {
  const colors = ["#c94f4f", "#4f8cc9", "#e0b03b", "#4fbf7a", "#9a5fc9"];
  return (
    <div
      className="absolute grid grid-cols-4 grid-rows-3 gap-1 rounded border-2 border-[#5a4632] bg-[#3a2c1e] p-2"
      style={{ left, top, width: 120, height: 110 }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[1px]"
          style={{ background: colors[i % colors.length], opacity: 0.85 }}
        />
      ))}
    </div>
  );
}

function Plant({ left, top }: { left: number; top: number }) {
  return (
    <div className="absolute" style={{ left, top }}>
      <div className="mx-auto h-10 w-10 rounded-full bg-[#2f7a4a]" />
      <div className="mx-auto -mt-3 h-8 w-8 rounded-full bg-[#3a9159]" />
      <div className="mx-auto h-6 w-8 rounded-b-md bg-[#7a5a3a]" />
    </div>
  );
}

export function Desk({
  left,
  top,
  monitors = 1,
}: {
  left: number;
  top: number;
  monitors?: number;
}) {
  return (
    <div className="absolute" style={{ left, top }}>
      <div className="flex gap-2">
        {Array.from({ length: monitors }).map((_, i) => (
          <div
            key={i}
            className="h-12 w-16 rounded-sm border-2 border-[#1a1a1a] bg-[#0a1a2a]"
            style={{ boxShadow: "0 0 8px rgba(59,180,255,0.35) inset" }}
          >
            <div className="mt-1 h-1 w-3/4 bg-[#3bd6ff]/70" />
          </div>
        ))}
      </div>
      <div className="mt-1 h-3 w-full rounded-sm bg-[#6b4a2f]" />
      <div className="h-8 w-full rounded-b-sm bg-[#4a3320]" />
    </div>
  );
}

function WaterCooler({ left, top }: { left: number; top: number }) {
  return (
    <div className="absolute" style={{ left, top }}>
      <div className="mx-auto h-8 w-8 rounded-full bg-[#8fd0ee] opacity-90" />
      <div className="mx-auto -mt-1 h-10 w-10 rounded-md bg-[#dfeff7]" />
      <div className="mx-auto h-6 w-12 rounded-sm bg-[#c9dbe6]" />
    </div>
  );
}

function Trophy({ left, top }: { left: number; top: number }) {
  return (
    <div
      className="absolute flex h-8 w-6 items-end justify-center rounded-t-full bg-[#e0b030] shadow-[0_0_10px_rgba(224,176,48,0.6)]"
      style={{ left, top }}
    />
  );
}

export function OfficeScene({
  agents,
}: {
  resetSignal: number;
  agents: AgentsResponse | null;
}) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #1c130c 0%, #2a1c12 38%, #4a3320 39%, #3a2515 100%)",
      }}
    >
      <div
        className="absolute inset-x-0 top-[260px] bottom-0"
        style={{
          background:
            "repeating-linear-gradient(90deg, #4a3320 0px, #4a3320 38px, #432d1c 38px, #432d1c 76px)",
        }}
      />

      <Window />
      <NeonSign />
      <StudioSign />

      <Bookshelf left={880} top={230} />
      <Bookshelf left={1010} top={230} />
      <Bookshelf left={40} top={220} />

      <Plant left={640} top={190} />
      <Plant left={1170} top={280} />
      <Plant left={1300} top={520} />

      <WaterCooler left={780} top={210} />
      <Trophy left={1120} top={330} />

      <Desk left={80} top={420} monitors={2} />
      <Desk left={320} top={460} monitors={1} />
      <Desk left={480} top={460} monitors={1} />
      <Desk left={1020} top={560} monitors={1} />

      <OfficeWorkers agents={agents} />
    </div>
  );
}

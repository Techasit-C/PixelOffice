export interface CharacterDef {
  id: string;
  name: string;
  kind: "human" | "robot";
  hairColor: string;
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
  lines: string[];
  home: { x: number; y: number };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "dev_orange",
    name: "dev_orange",
    kind: "human",
    hairColor: "#e07a2c",
    skinColor: "#f0c090",
    shirtColor: "#2b2b33",
    pantsColor: "#1a1a20",
    lines: ["พิมพ์โค้ดเร็วจังเลยนะ", "commit ก่อนนอนดีกว่า", "bug นี้แปลกมาก"],
    home: { x: 160, y: 430 },
    bounds: { minX: 90, maxX: 340, minY: 380, maxY: 470 },
  },
  {
    id: "dev_olive",
    name: "dev_olive",
    kind: "human",
    hairColor: "#3a3a3a",
    skinColor: "#f0c090",
    shirtColor: "#2f6b3a",
    pantsColor: "#20281f",
    lines: ["555 จริง เดี๋ยวลุยต่อ", "ใครรีวิว PR ให้หน่อย", "กาแฟหมดแล้ว"],
    home: { x: 260, y: 470 },
    bounds: { minX: 180, maxX: 420, minY: 420, maxY: 500 },
  },
  {
    id: "robo",
    name: "Housekeeper",
    kind: "robot",
    hairColor: "#c7d2e0",
    skinColor: "#c7d2e0",
    shirtColor: "#3b6bd6",
    pantsColor: "#2a3a55",
    lines: ["กำลังล้าง cache ครับ", "log เก่าลบแล้ว", "ทุกอย่างเรียบร้อย"],
    home: { x: 430, y: 400 },
    bounds: { minX: 360, maxX: 470, minY: 380, maxY: 430 },
  },
  {
    id: "dev_blue",
    name: "Jing",
    kind: "human",
    hairColor: "#221d1a",
    skinColor: "#e8b98a",
    shirtColor: "#254c8f",
    pantsColor: "#182238",
    lines: ["ว่างครับ มีงานส่งมาได้เลย", "รอ deploy อยู่", "อ่าน docs อยู่"],
    home: { x: 380, y: 470 },
    bounds: { minX: 300, maxX: 500, minY: 430, maxY: 510 },
  },
  {
    id: "dev_green",
    name: "Joe",
    kind: "human",
    hairColor: "#2a2a2a",
    skinColor: "#f0c090",
    shirtColor: "#1f7a4f",
    pantsColor: "#16321f",
    lines: ["ตรวจ backend อยู่", "trading bot รันปกติ", "ไปเดินเล่นแป๊บนึง"],
    home: { x: 680, y: 420 },
    bounds: { minX: 600, maxX: 760, minY: 380, maxY: 480 },
  },
];

const zlib = require("zlib");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CACHE = new Map();

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ];
}

function createCanvas(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

function putPixel(canvas, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || alpha <= 0) return;
  const index = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
  const sourceAlpha = Math.max(0, Math.min(1, alpha));
  const targetAlpha = canvas.pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;

  canvas.pixels[index] = clamp((color[0] * sourceAlpha + canvas.pixels[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  canvas.pixels[index + 1] = clamp((color[1] * sourceAlpha + canvas.pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  canvas.pixels[index + 2] = clamp((color[2] * sourceAlpha + canvas.pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  canvas.pixels[index + 3] = clamp(outAlpha * 255);
}

function fillRect(canvas, x, y, width, height, hex, alpha = 1) {
  const color = hexToRgb(hex);
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(canvas.width, Math.ceil(x + width));
  const bottom = Math.min(canvas.height, Math.ceil(y + height));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) putPixel(canvas, px, py, color, alpha);
  }
}

function fillGradient(canvas, topHex, bottomHex) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  for (let y = 0; y < canvas.height; y += 1) {
    const ratio = y / Math.max(1, canvas.height - 1);
    const color = top.map((channel, index) => channel + (bottom[index] - channel) * ratio);
    for (let x = 0; x < canvas.width; x += 1) putPixel(canvas, x, y, color, 1);
  }
}

function fillCircle(canvas, cx, cy, radius, hex, alpha = 1) {
  const color = hexToRgb(hex);
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) putPixel(canvas, x, y, color, alpha);
    }
  }
}

function fillEllipse(canvas, cx, cy, rx, ry, hex, alpha = 1) {
  const color = hexToRgb(hex);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      const distance = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry);
      if (distance <= 1) putPixel(canvas, x, y, color, alpha);
    }
  }
}

function glow(canvas, cx, cy, rx, ry, hex, strength = 0.7) {
  for (let step = 80; step >= 1; step -= 1) {
    const ratio = step / 80;
    fillEllipse(canvas, cx, cy, rx * ratio, ry * ratio, hex, strength * 0.035 * ratio * ratio);
  }
}

function strokeLine(canvas, x1, y1, x2, y2, hex, width = 1, alpha = 1) {
  const color = hexToRgb(hex);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const radius = Math.max(0, Math.floor(width / 2));
  for (let i = 0; i <= steps; i += 1) {
    const x = x1 + (dx * i) / steps;
    const y = y1 + (dy * i) / steps;
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy <= radius * radius + 1) putPixel(canvas, Math.round(x + ox), Math.round(y + oy), color, alpha);
      }
    }
  }
}


function fillPolygon(canvas, points, hex, alpha = 1) {
  const color = hexToRgb(hex);
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1]))));
  const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(...points.map((point) => point[1]))));
  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const left = Math.max(0, Math.ceil(intersections[i]));
      const right = Math.min(canvas.width - 1, Math.floor(intersections[i + 1]));
      for (let x = left; x <= right; x += 1) putPixel(canvas, x, y, color, alpha);
    }
  }
}

function roundedRect(canvas, x, y, width, height, radius, hex, alpha = 1) {
  fillRect(canvas, x + radius, y, width - radius * 2, height, hex, alpha);
  fillRect(canvas, x, y + radius, width, height - radius * 2, hex, alpha);
  fillCircle(canvas, x + radius, y + radius, radius, hex, alpha);
  fillCircle(canvas, x + width - radius, y + radius, radius, hex, alpha);
  fillCircle(canvas, x + radius, y + height - radius, radius, hex, alpha);
  fillCircle(canvas, x + width - radius, y + height - radius, radius, hex, alpha);
}

function strokeCircle(canvas, cx, cy, radius, hex, width = 1, alpha = 1) {
  const segments = Math.max(80, Math.floor(radius * 2));
  let previous = null;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    const point = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    if (previous) strokeLine(canvas, previous[0], previous[1], point[0], point[1], hex, width, alpha);
    previous = point;
  }
}

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"]
};

function drawText(canvas, text, x, y, size, hex, alpha = 1) {
  let cursor = x;
  const upper = text.toUpperCase();
  for (const character of upper) {
    const glyph = FONT[character] || FONT[" "];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((bit, columnIndex) => {
        if (bit === "1") fillRect(canvas, cursor + columnIndex * size, y + rowIndex * size, size, size, hex, alpha);
      });
    });
    cursor += (glyph[0].length + 1) * size;
  }
}

function drawCenteredText(canvas, text, y, size, hex, alpha = 1) {
  const width = text.length * 6 * size - size;
  drawText(canvas, text, Math.floor((canvas.width - width) / 2), y, size, hex, alpha);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(canvas) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = canvas.width * 4;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    canvas.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function drawBackground(canvas) {
  fillGradient(canvas, "#03040d", "#111024");
  glow(canvas, canvas.width * 0.7, canvas.height * 0.3, canvas.width * 0.46, canvas.height * 0.58, "#7c3aed", 0.8);
  glow(canvas, canvas.width * 0.18, canvas.height * 0.8, canvas.width * 0.42, canvas.height * 0.38, "#0891b2", 0.55);
  glow(canvas, canvas.width * 0.9, canvas.height * 0.72, canvas.width * 0.34, canvas.height * 0.32, "#be123c", 0.44);

  for (let y = 0; y < canvas.height; y += 1) {
    const vertical = Math.abs(y - canvas.height / 2) / (canvas.height / 2);
    fillRect(canvas, 0, y, canvas.width, 1, "#000000", 0.1 * vertical);
  }
  for (let x = -160; x < canvas.width + 220; x += 92) strokeLine(canvas, x, 0, x + 180, canvas.height, "#ffffff", 1, 0.018);
  for (let y = 78; y < canvas.height; y += 86) strokeLine(canvas, 0, y, canvas.width, y + 18, "#a78bfa", 1, 0.014);
}

function drawVinylHalo(canvas, cx, cy) {
  glow(canvas, cx, cy, 330, 285, "#2563eb", 0.5);
  fillCircle(canvas, cx, cy, 208, "#050612", 0.78);
  for (let radius = 78; radius <= 196; radius += 24) strokeCircle(canvas, cx, cy, radius, "#c4b5fd", 2, 0.13);
  strokeCircle(canvas, cx, cy, 214, "#67e8f9", 4, 0.16);
  fillCircle(canvas, cx, cy, 58, "#312e81", 0.8);
  fillCircle(canvas, cx, cy, 18, "#f8fafc", 0.92);
  strokeLine(canvas, cx - 176, cy + 116, cx - 92, cy + 78, "#67e8f9", 6, 0.28);
  strokeLine(canvas, cx + 84, cy - 132, cx + 168, cy - 172, "#f472b6", 6, 0.22);
}

function drawSpySilhouette(canvas) {
  const cx = 865;
  const base = 548;
  glow(canvas, cx + 28, 284, 210, 300, "#be123c", 0.56);
  glow(canvas, cx - 60, 268, 230, 260, "#2563eb", 0.46);

  fillEllipse(canvas, cx + 12, 460, 116, 150, "#050711", 0.96);
  fillPolygon(canvas, [[cx - 124, base], [cx - 70, 360], [cx - 4, 442], [cx + 44, 360], [cx + 122, base]], "#04050e", 0.98);
  fillPolygon(canvas, [[cx - 84, 362], [cx - 16, 430], [cx - 48, 536]], "#111827", 0.7);
  fillPolygon(canvas, [[cx + 52, 360], [cx + 6, 430], [cx + 62, 538]], "#111827", 0.64);
  fillEllipse(canvas, cx, 258, 68, 84, "#050711", 0.98);
  roundedRect(canvas, cx - 104, 188, 208, 36, 18, "#060711", 0.98);
  fillPolygon(canvas, [[cx - 58, 190], [cx - 32, 126], [cx + 56, 126], [cx + 86, 190]], "#060711", 0.98);
  strokeLine(canvas, cx - 76, 224, cx + 84, 224, "#67e8f9", 3, 0.58);
  strokeLine(canvas, cx - 34, 280, cx - 5, 280, "#f8fafc", 2, 0.6);
  strokeLine(canvas, cx + 16, 278, cx + 42, 278, "#f8fafc", 2, 0.54);
  strokeLine(canvas, cx - 90, 366, cx - 132, 548, "#67e8f9", 3, 0.24);
  strokeLine(canvas, cx + 72, 368, cx + 132, 548, "#f472b6", 3, 0.2);
}

function drawReactionBubble(canvas, x, y, width, label, accent) {
  roundedRect(canvas, x, y, width, 54, 20, "#070816", 0.72);
  roundedRect(canvas, x + 10, y + 12, 30, 30, 15, accent, 0.86);
  drawText(canvas, label, x + 52, y + 20, 3, "#f8fafc", 0.92);
}

function drawWaveform(canvas, x, y) {
  const bars = [24, 38, 30, 54, 34, 68, 42, 56, 28, 48, 32, 62, 36, 26, 44, 30, 52, 34];
  bars.forEach((bar, index) => {
    const color = ["#67e8f9", "#8b5cf6", "#f43f5e"][index % 3];
    strokeLine(canvas, x + index * 18, y - bar / 2, x + index * 18, y + bar / 2, color, 5, 0.62);
  });
}

function renderSocialPreview() {
  const canvas = createCanvas(1200, 630);
  drawBackground(canvas);

  fillPolygon(canvas, [[0, 0], [690, 0], [560, 630], [0, 630]], "#050711", 0.42);
  drawVinylHalo(canvas, 885, 326);
  drawSpySilhouette(canvas);

  roundedRect(canvas, 72, 72, 220, 46, 23, "#ffffff", 0.12);
  fillCircle(canvas, 96, 95, 9, "#67e8f9", 1);
  fillCircle(canvas, 96, 95, 3, "#f8fafc", 1);
  drawText(canvas, "PARTY GAME", 118, 86, 4, "#c4b5fd", 1);

  drawText(canvas, "MUSIC SPY", 78, 172, 11, "#0f172a", 0.72);
  drawText(canvas, "MUSIC SPY", 72, 164, 11, "#ffffff", 1);
  strokeLine(canvas, 78, 254, 454, 254, "#67e8f9", 4, 0.72);
  strokeLine(canvas, 78, 264, 354, 264, "#f43f5e", 3, 0.5);

  roundedRect(canvas, 78, 308, 478, 100, 26, "#080a18", 0.72);
  drawText(canvas, "FIND THE SPY", 112, 332, 5, "#f8fafc", 0.95);
  drawText(canvas, "AMONG FRIENDS", 112, 374, 4, "#c4b5fd", 0.92);

  roundedRect(canvas, 78, 438, 462, 74, 24, "#060817", 0.64);
  drawText(canvas, "TRACKS DISCUSS VOTE", 112, 464, 4, "#e2e8f0", 0.96);
  drawWaveform(canvas, 116, 560);

  drawReactionBubble(canvas, 954, 104, 182, "SUSPECT", "#f43f5e");
  drawReactionBubble(canvas, 944, 466, 160, "VOTE", "#8b5cf6");
  drawReactionBubble(canvas, 646, 92, 154, "TRACK", "#06b6d4");

  roundedRect(canvas, 980, 542, 132, 40, 20, "#ffffff", 0.12);
  drawText(canvas, "LIVE", 1008, 556, 4, "#f8fafc", 0.95);
  fillCircle(canvas, 1088, 562, 7, "#f43f5e", 1);

  return encodePng(canvas);
}

function renderIcon(size) {
  const canvas = createCanvas(size, size);
  drawBackground(canvas);
  const center = size / 2;
  fillCircle(canvas, center, center, size * 0.3, "#0d0b1f", 0.9);
  for (let radius = size * 0.1; radius <= size * 0.27; radius += size * 0.055) strokeCircle(canvas, center, center, radius, "#e9d5ff", Math.max(1, size * 0.008), 0.32);
  fillCircle(canvas, center, center, size * 0.08, "#f8fafc", 1);
  fillCircle(canvas, center, center, size * 0.18, "#7c3aed", 0.72);
  const scale = Math.max(4, Math.floor(size / 38));
  drawCenteredText(canvas, "MS", size * 0.72, scale, "#ffffff", 1);
  return encodePng(canvas);
}

function getSocialPreviewPng() {
  if (!PNG_CACHE.has("social")) PNG_CACHE.set("social", renderSocialPreview());
  return PNG_CACHE.get("social");
}

function getIconPng(size) {
  const key = `icon-${size}`;
  if (!PNG_CACHE.has(key)) PNG_CACHE.set(key, renderIcon(size));
  return PNG_CACHE.get(key);
}

function sendPng(response, buffer) {
  response.set({
    "Content-Type": "image/png",
    "Content-Length": buffer.length,
    "Cache-Control": "public, max-age=31536000, immutable"
  });
  response.send(buffer);
}

function registerSocialAssetRoutes(app) {
  app.get("/social-preview.png", (request, response) => sendPng(response, getSocialPreviewPng()));
  app.get("/social-preview-v2.png", (request, response) => sendPng(response, getSocialPreviewPng()));
  app.get("/icon-192.png", (request, response) => sendPng(response, getIconPng(192)));
  app.get("/icon-512.png", (request, response) => sendPng(response, getIconPng(512)));
  app.get("/apple-touch-icon.png", (request, response) => sendPng(response, getIconPng(180)));
}

module.exports = {
  getIconPng,
  getSocialPreviewPng,
  registerSocialAssetRoutes
};

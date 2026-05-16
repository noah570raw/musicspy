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
  fillGradient(canvas, "#070716", "#17102a");
  glow(canvas, canvas.width * 0.82, canvas.height * 0.18, canvas.width * 0.48, canvas.height * 0.5, "#8b5cf6", 0.95);
  glow(canvas, canvas.width * 0.16, canvas.height * 0.85, canvas.width * 0.45, canvas.height * 0.42, "#06b6d4", 0.72);
  glow(canvas, canvas.width * 0.66, canvas.height * 0.75, canvas.width * 0.36, canvas.height * 0.34, "#ec4899", 0.62);

  for (let x = -100; x < canvas.width + 160; x += 54) strokeLine(canvas, x, 0, x + 220, canvas.height, "#ffffff", 1, 0.035);
  for (let y = 42; y < canvas.height; y += 54) strokeLine(canvas, 0, y, canvas.width, y, "#ffffff", 1, 0.025);
}

function renderSocialPreview() {
  const canvas = createCanvas(1200, 630);
  drawBackground(canvas);

  const recordX = 1002;
  const recordY = 292;
  fillCircle(canvas, recordX, recordY, 196, "#0d0b1f", 0.92);
  for (let radius = 64; radius <= 186; radius += 30) strokeCircle(canvas, recordX, recordY, radius, "#a78bfa", 2, 0.2);
  fillCircle(canvas, recordX, recordY, 52, "#7c3aed", 0.86);
  fillCircle(canvas, recordX, recordY, 18, "#f8fafc", 0.95);
  strokeLine(canvas, 1060, 380, 1135, 458, "#facc15", 12, 0.86);
  strokeLine(canvas, 946, 232, 898, 286, "#67e8f9", 10, 0.86);
  strokeLine(canvas, 1048, 232, 1102, 286, "#67e8f9", 10, 0.86);

  roundedRect(canvas, 82, 66, 356, 50, 25, "#ffffff", 0.16);
  fillCircle(canvas, 105, 92, 10, "#22d3ee", 1);
  fillCircle(canvas, 105, 92, 4, "#f8fafc", 1);
  drawText(canvas, "SOCIAL DEDUCTION + MUSIC", 126, 82, 4, "#c4b5fd", 1);

  drawText(canvas, "MUSIC SPY", 78, 158, 13, "#ffffff", 1);
  drawText(canvas, "TRUST THE TRACK", 84, 282, 7, "#e9d5ff", 0.96);
  drawText(canvas, "FIND THE SPY", 84, 344, 9, "#67e8f9", 1);

  roundedRect(canvas, 80, 432, 652, 92, 30, "#080816", 0.68);
  drawText(canvas, "PLAY TRACKS. DEBATE CLUES.", 113, 462, 4, "#e2e8f0", 1);
  drawText(canvas, "EXPOSE THE SPY.", 113, 494, 4, "#cbd5e1", 1);

  const bars = [36, 64, 48, 86, 54, 112, 72, 96, 44, 80, 58, 102, 66, 42, 74, 56, 88, 50, 70, 106, 62, 84, 46, 92];
  bars.forEach((bar, index) => {
    const x = 94 + index * 20;
    const color = ["#67e8f9", "#a78bfa", "#f472b6"][index % 3];
    strokeLine(canvas, x, 582 - bar / 2, x, 582 + bar / 2, color, 7, 0.78);
  });

  [[82, "ONLINE ROOMS"], [440, "TRACK AS CLUE"], [830, "VOTE TO WIN"]].forEach(([x, label]) => {
    roundedRect(canvas, x, 544, label.length * 24 + 52, 50, 25, "#111827", 0.7);
    drawText(canvas, label, x + 26, 564, 4, "#f8fafc", 1);
  });

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
  app.get("/icon-192.png", (request, response) => sendPng(response, getIconPng(192)));
  app.get("/icon-512.png", (request, response) => sendPng(response, getIconPng(512)));
  app.get("/apple-touch-icon.png", (request, response) => sendPng(response, getIconPng(180)));
}

module.exports = {
  getIconPng,
  getSocialPreviewPng,
  registerSocialAssetRoutes
};

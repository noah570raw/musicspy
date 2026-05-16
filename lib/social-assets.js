const fs = require("fs");
const path = require("path");
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

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceAbove = Math.abs(estimate - above);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) return left;
  if (distanceAbove <= distanceUpperLeft) return above;
  return upperLeft;
}

function decodePngRgba(buffer) {
  if (!buffer.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error("Invalid PNG signature");

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (bitDepth !== 8 || colorType !== 6) throw new Error("Only 8-bit RGBA PNG assets are supported");

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * 4);
  let rawOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset + x];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let reconstructed = value;
      if (filter === 1) reconstructed += left;
      else if (filter === 2) reconstructed += above;
      else if (filter === 3) reconstructed += Math.floor((left + above) / 2);
      else if (filter === 4) reconstructed += paethPredictor(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
      pixels[y * stride + x] = reconstructed & 0xff;
    }
    rawOffset += stride;
  }

  return { width, height, pixels };
}

function readIconPng() {
  const icoPath = path.join(__dirname, "..", "public", "musicspyicon.ico");
  const ico = fs.readFileSync(icoPath);
  const iconCount = ico.readUInt16LE(4);
  for (let index = 0; index < iconCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const bytesInRes = ico.readUInt32LE(entryOffset + 8);
    const imageOffset = ico.readUInt32LE(entryOffset + 12);
    const image = ico.slice(imageOffset, imageOffset + bytesInRes);
    if (image.slice(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return decodePngRgba(image);
  }
  throw new Error("musicspyicon.ico does not contain a PNG image");
}

const ICON_IMAGE = readIconPng();

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


const STROKE_FONT = {
  " ": [],
  "A": [[[0.2, 7], [2.5, 0]], [[2.5, 0], [4.8, 7]], [[1.05, 4.35], [3.95, 4.35]]],
  "C": [[[4.7, 0.8], [3.7, 0.15]], [[3.7, 0.15], [1.2, 0.15]], [[1.2, 0.15], [0.25, 1.15]], [[0.25, 1.15], [0.25, 5.85]], [[0.25, 5.85], [1.2, 6.85]], [[1.2, 6.85], [3.7, 6.85]], [[3.7, 6.85], [4.7, 6.2]]],
  "E": [[[4.8, 0.25], [0.35, 0.25]], [[0.35, 0.25], [0.35, 6.75]], [[0.35, 3.5], [4.1, 3.5]], [[0.35, 6.75], [4.8, 6.75]]],
  "I": [[[0.8, 0.25], [4.2, 0.25]], [[2.5, 0.25], [2.5, 6.75]], [[0.8, 6.75], [4.2, 6.75]]],
  "M": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 0.25], [2.5, 3.25]], [[2.5, 3.25], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "P": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 0.25], [3.55, 0.25]], [[3.55, 0.25], [4.65, 1.25]], [[4.65, 1.25], [4.65, 3.15]], [[4.65, 3.15], [3.55, 4.05]], [[3.55, 4.05], [0.35, 4.05]]],
  "S": [[[4.65, 0.75], [3.75, 0.15]], [[3.75, 0.15], [1.15, 0.15]], [[1.15, 0.15], [0.35, 0.95]], [[0.35, 0.95], [0.35, 2.65]], [[0.35, 2.65], [1.15, 3.5]], [[1.15, 3.5], [3.85, 3.5]], [[3.85, 3.5], [4.65, 4.35]], [[4.65, 4.35], [4.65, 6.05]], [[4.65, 6.05], [3.75, 6.85]], [[3.75, 6.85], [1, 6.85]], [[1, 6.85], [0.2, 6.25]]],
  "U": [[[0.35, 0.25], [0.35, 5.45]], [[0.35, 5.45], [1.15, 6.75]], [[1.15, 6.75], [3.85, 6.75]], [[3.85, 6.75], [4.65, 5.45]], [[4.65, 5.45], [4.65, 0.25]]],
  "Y": [[[0.25, 0.25], [2.5, 3.45]], [[4.75, 0.25], [2.5, 3.45]], [[2.5, 3.45], [2.5, 6.75]]],
  "А": [[[0.2, 7], [2.5, 0]], [[2.5, 0], [4.8, 7]], [[1.05, 4.35], [3.95, 4.35]]],
  "Д": [[[0.15, 6.75], [4.85, 6.75]], [[0.85, 6.75], [1.4, 0.35]], [[1.4, 0.35], [4.05, 0.35]], [[4.05, 0.35], [4.6, 6.75]], [[0.15, 6.75], [0.15, 7.55]], [[4.85, 6.75], [4.85, 7.55]]],
  "Е": [[[4.8, 0.25], [0.35, 0.25]], [[0.35, 0.25], [0.35, 6.75]], [[0.35, 3.5], [4.1, 3.5]], [[0.35, 6.75], [4.8, 6.75]]],
  "З": [[[0.55, 0.75], [1.35, 0.15]], [[1.35, 0.15], [3.75, 0.15]], [[3.75, 0.15], [4.55, 0.95]], [[4.55, 0.95], [4.55, 2.65]], [[4.55, 2.65], [3.55, 3.5]], [[3.55, 3.5], [4.6, 4.35]], [[4.6, 4.35], [4.6, 6.05]], [[4.6, 6.05], [3.75, 6.85]], [[3.75, 6.85], [1.15, 6.85]], [[1.15, 6.85], [0.35, 6.25]]],
  "И": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 6.75], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "К": [[[0.35, 0.25], [0.35, 6.75]], [[4.65, 0.25], [0.35, 3.55]], [[0.35, 3.55], [4.75, 6.75]]],
  "Л": [[[0.15, 6.85], [1.65, 0.25]], [[1.65, 0.25], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "М": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 0.25], [2.5, 3.35]], [[2.5, 3.35], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "Ы": [[[0.35, 0.25], [0.35, 6.75]], [[0.35, 3.55], [2.7, 3.55]], [[2.7, 3.55], [3.55, 4.45]], [[3.55, 4.45], [3.55, 5.85]], [[3.55, 5.85], [2.7, 6.75]], [[2.7, 6.75], [0.35, 6.75]], [[4.65, 0.25], [4.65, 6.75]]],
  "Ь": [[[0.35, 0.25], [0.35, 6.75]], [[0.35, 3.55], [3.25, 3.55]], [[3.25, 3.55], [4.45, 4.45]], [[4.45, 4.45], [4.45, 5.85]], [[4.45, 5.85], [3.25, 6.75]], [[3.25, 6.75], [0.35, 6.75]]],
  "Я": [[[4.65, 6.75], [4.65, 0.25]], [[4.65, 0.25], [1.35, 0.25]], [[1.35, 0.25], [0.35, 1.25]], [[0.35, 1.25], [0.35, 3.05]], [[0.35, 3.05], [1.35, 4.05]], [[1.35, 4.05], [4.65, 4.05]], [[1.65, 4.05], [0.25, 6.75]]],
  "Й": [[[1.35, -0.7], [2.5, -0.25]], [[2.5, -0.25], [3.65, -0.7]], [[0.35, 6.75], [0.35, 0.25]], [[0.35, 6.75], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "Н": [[[0.35, 0.25], [0.35, 6.75]], [[4.65, 0.25], [4.65, 6.75]], [[0.35, 3.5], [4.65, 3.5]]],
  "О": [[[2.5, 0.15], [4.2, 0.75]], [[4.2, 0.75], [4.85, 2.1]], [[4.85, 2.1], [4.85, 4.9]], [[4.85, 4.9], [4.2, 6.25]], [[4.2, 6.25], [2.5, 6.85]], [[2.5, 6.85], [0.8, 6.25]], [[0.8, 6.25], [0.15, 4.9]], [[0.15, 4.9], [0.15, 2.1]], [[0.15, 2.1], [0.8, 0.75]], [[0.8, 0.75], [2.5, 0.15]]],
  "П": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 0.25], [4.65, 0.25]], [[4.65, 0.25], [4.65, 6.75]]],
  "Р": [[[0.35, 6.75], [0.35, 0.25]], [[0.35, 0.25], [3.55, 0.25]], [[3.55, 0.25], [4.65, 1.25]], [[4.65, 1.25], [4.65, 3.15]], [[4.65, 3.15], [3.55, 4.05]], [[3.55, 4.05], [0.35, 4.05]]],
  "С": [[[4.7, 0.8], [3.7, 0.15]], [[3.7, 0.15], [1.2, 0.15]], [[1.2, 0.15], [0.25, 1.15]], [[0.25, 1.15], [0.25, 5.85]], [[0.25, 5.85], [1.2, 6.85]], [[1.2, 6.85], [3.7, 6.85]], [[3.7, 6.85], [4.7, 6.2]]],
  "У": [[[0.2, 0.25], [2.3, 3.95]], [[4.8, 0.25], [2.3, 5.8]], [[2.3, 5.8], [1.1, 6.85]], [[1.1, 6.85], [0.45, 6.45]]],
  "Ш": [[[0.3, 0.25], [0.3, 6.75]], [[2.5, 0.25], [2.5, 6.75]], [[4.7, 0.25], [4.7, 6.75]], [[0.3, 6.75], [4.7, 6.75]]]
};

function drawStrokeText(canvas, text, x, y, size, hex, width, alpha = 1) {
  let cursor = x;
  const upper = text.toUpperCase();
  for (const character of upper) {
    const glyph = STROKE_FONT[character] || [];
    glyph.forEach(([from, to]) => {
      strokeLine(canvas, cursor + from[0] * size, y + from[1] * size, cursor + to[0] * size, y + to[1] * size, hex, width, alpha);
    });
    cursor += (character === " " ? 3 : 6) * size;
  }
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
  fillGradient(canvas, "#02030a", "#0b1022");

  glow(canvas, canvas.width * 0.7, canvas.height * 0.42, canvas.width * 0.34, canvas.height * 0.48, "#7c3aed", 0.48);
  glow(canvas, canvas.width * 0.78, canvas.height * 0.48, canvas.width * 0.26, canvas.height * 0.38, "#be123c", 0.34);
  glow(canvas, canvas.width * 0.2, canvas.height * 0.2, canvas.width * 0.3, canvas.height * 0.3, "#1d4ed8", 0.22);

  for (let y = 0; y < canvas.height; y += 1) {
    const top = y / Math.max(1, canvas.height - 1);
    const vignette = Math.abs(top - 0.5) * 0.28;
    fillRect(canvas, 0, y, canvas.width, 1, "#000000", 0.1 + vignette);
  }

  for (let x = 0; x < canvas.width; x += 1) {
    const edge = Math.max(Math.abs(x - canvas.width / 2) / (canvas.width / 2) - 0.48, 0);
    if (edge > 0) fillRect(canvas, x, 0, 1, canvas.height, "#000000", edge * 0.44);
  }
}

function drawVinylHalo(canvas, cx, cy) {
  glow(canvas, cx, cy, 360, 310, "#7c3aed", 0.34);
  glow(canvas, cx + 16, cy + 8, 275, 245, "#be123c", 0.2);
  fillCircle(canvas, cx, cy, 230, "#03040d", 0.56);
  for (let radius = 118; radius <= 216; radius += 28) strokeCircle(canvas, cx, cy, radius, "#c4b5fd", 2, 0.09);
  strokeCircle(canvas, cx, cy, 238, "#f472b6", 4, 0.13);
  strokeCircle(canvas, cx, cy, 252, "#60a5fa", 2, 0.08);
  fillCircle(canvas, cx, cy, 74, "#0b1022", 0.82);
  fillCircle(canvas, cx, cy, 22, "#f8fafc", 0.9);
  strokeLine(canvas, cx - 202, cy + 138, cx - 108, cy + 92, "#f472b6", 4, 0.14);
  strokeLine(canvas, cx + 112, cy - 156, cx + 190, cy - 196, "#93c5fd", 4, 0.12);
}

function drawOfficialMascot(canvas) {
  const crop = { x: 54, y: 24, width: 150, height: 232 };
  const target = { x: 742, y: 98, width: 336, height: 520 };
  const eyeLeft = {
    x: target.x + ((112 - crop.x) / crop.width) * target.width,
    y: target.y + ((112 - crop.y) / crop.height) * target.height
  };
  const eyeRight = {
    x: target.x + ((146 - crop.x) / crop.width) * target.width,
    y: target.y + ((112 - crop.y) / crop.height) * target.height
  };

  glow(canvas, target.x + target.width * 0.54, target.y + target.height * 0.52, 250, 340, "#be123c", 0.42);
  glow(canvas, target.x + target.width * 0.36, target.y + target.height * 0.5, 235, 320, "#2563eb", 0.28);
  glow(canvas, (eyeLeft.x + eyeRight.x) / 2, eyeLeft.y, 54, 24, "#f8fafc", 0.25);

  for (let dy = 0; dy < target.height; dy += 1) {
    const sy = crop.y + Math.floor((dy / target.height) * crop.height);
    for (let dx = 0; dx < target.width; dx += 1) {
      const sx = crop.x + Math.floor((dx / target.width) * crop.width);
      const sourceIndex = (sy * ICON_IMAGE.width + sx) * 4;
      const red = ICON_IMAGE.pixels[sourceIndex];
      const green = ICON_IMAGE.pixels[sourceIndex + 1];
      const blue = ICON_IMAGE.pixels[sourceIndex + 2];
      const alpha = ICON_IMAGE.pixels[sourceIndex + 3] / 255;
      if (alpha <= 0) continue;

      const isMascotSilhouette = red < 48 && green < 48 && blue < 48;
      const isEye = red > 220 && green > 220 && blue > 220 && sx >= 96 && sx <= 160 && sy >= 102 && sy <= 122;
      if (!isMascotSilhouette && !isEye) continue;

      const rimLight = dx / target.width;
      const color = isEye
        ? [248, 250, 252]
        : [
          clamp(red + rimLight * 9),
          clamp(green + 2),
          clamp(blue + (1 - rimLight) * 12)
        ];
      putPixel(canvas, target.x + dx, target.y + dy, color, alpha * (isEye ? 1 : 0.98));
    }
  }

  strokeLine(canvas, target.x + 64, target.y + 168, target.x + 92, target.y + 420, "#60a5fa", 3, 0.14);
  strokeLine(canvas, target.x + 254, target.y + 168, target.x + 286, target.y + 420, "#f472b6", 3, 0.16);
}

function drawReactionBubble(canvas, x, y, radius, accent) {
  fillCircle(canvas, x, y, radius, "#090b17", 0.58);
  strokeCircle(canvas, x, y, radius + 2, accent, 2, 0.2);
  fillCircle(canvas, x, y, Math.max(5, radius * 0.22), accent, 0.72);
}

function drawWaveform(canvas, x, y) {
  const bars = [22, 36, 28, 48, 30, 54, 34, 44, 26, 38];
  bars.forEach((bar, index) => {
    strokeLine(canvas, x + index * 16, y - bar / 2, x + index * 16, y + bar / 2, "#c4b5fd", 4, 0.18);
  });
}

function renderSocialPreview() {
  const canvas = createCanvas(1200, 630);
  drawBackground(canvas);

  fillPolygon(canvas, [[0, 0], [650, 0], [525, 630], [0, 630]], "#02030a", 0.52);
  fillPolygon(canvas, [[1120, 0], [1200, 0], [1200, 630], [1000, 630]], "#000000", 0.18);

  drawVinylHalo(canvas, 840, 322);
  drawOfficialMascot(canvas);

  drawWaveform(canvas, 610, 516);

  drawStrokeText(canvas, "MUSIC SPY", 78, 158, 10, "#0b1022", 13, 0.82);
  drawStrokeText(canvas, "MUSIC SPY", 72, 150, 10, "#ffffff", 10, 1);
  strokeLine(canvas, 78, 242, 456, 242, "#e879f9", 3, 0.5);
  strokeLine(canvas, 78, 252, 334, 252, "#60a5fa", 2, 0.35);

  drawStrokeText(canvas, "НАЙДИ ШПИОНА", 78, 334, 6, "#f8fafc", 5, 0.94);
  drawStrokeText(canvas, "ИСПОЛЬЗУЯ", 78, 392, 6, "#c4b5fd", 5, 0.9);
  drawStrokeText(canvas, "МУЗЫКУ", 78, 450, 6, "#f0abfc", 5, 0.86);

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
  app.get("/social-preview-v3.png", (request, response) => sendPng(response, getSocialPreviewPng()));
  app.get("/icon-192.png", (request, response) => sendPng(response, getIconPng(192)));
  app.get("/icon-512.png", (request, response) => sendPng(response, getIconPng(512)));
  app.get("/apple-touch-icon.png", (request, response) => sendPng(response, getIconPng(180)));
}

module.exports = {
  getIconPng,
  getSocialPreviewPng,
  registerSocialAssetRoutes
};

import sharp from "sharp";

export type MediaFixtureKind =
  | "photo"
  | "text-packaging"
  | "fine-texture"
  | "dark-gradient"
  | "transparent"
  | "icc-profile";

async function createPhotoFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * channels;
      // Sky/warm gradient background
      let r = Math.floor(40 + 180 * nx);
      let g = Math.floor(60 + 120 * ny);
      let b = Math.floor(220 - 150 * nx);

      // Add a central shaded sphere for edge and tonal transition
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist < 0.25) {
        const factor = Math.cos((dist / 0.25) * (Math.PI / 2));
        r = Math.min(255, Math.floor(r + 100 * factor));
        g = Math.min(255, Math.floor(g + 80 * factor));
        b = Math.max(0, Math.floor(b - 50 * factor));
      }

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

async function createTextPackagingFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      // Cream/white background
      let val = 245;

      // High-contrast horizontal text bars
      const inTextBand = (y % 40 >= 10 && y % 40 <= 25);
      const inTextColumn = (x % 30 < 20);
      const isHeader = (y < height * 0.2 && x > width * 0.1 && x < width * 0.9 && y % 20 < 14);

      if ((inTextBand && inTextColumn) || isHeader) {
        val = 15; // Near-black text element
      }

      buffer[idx] = val;
      buffer[idx + 1] = val;
      buffer[idx + 2] = val;
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

async function createFineTextureFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      // High-frequency alternating weave pattern
      const p1 = (x % 2 === 0) ? 50 : 200;
      const p2 = (y % 2 === 0) ? 30 : 180;
      const noise = ((x * 37 + y * 73) % 40) - 20;

      buffer[idx] = Math.min(255, Math.max(0, p1 + noise));
      buffer[idx + 1] = Math.min(255, Math.max(0, p2 + noise));
      buffer[idx + 2] = Math.min(255, Math.max(0, ((p1 + p2) >> 1) + noise));
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

async function createDarkGradientFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * channels;
      // Dark range: 10 to ~65 (strictly < 90)
      const r = Math.floor(10 + 45 * nx);
      const g = Math.floor(12 + 35 * ny);
      const b = Math.floor(15 + 50 * ((nx + ny) * 0.5));

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

async function createTransparentFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 4;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * channels;

      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const dist = Math.sqrt(cx * cx + cy * cy);

      // Center solid circle, feathering border, transparent background
      if (dist < 0.25) {
        buffer[idx] = 40;
        buffer[idx + 1] = 160;
        buffer[idx + 2] = 220;
        buffer[idx + 3] = 255; // Opaque
      } else if (dist < 0.35) {
        buffer[idx] = 40;
        buffer[idx + 1] = 160;
        buffer[idx + 2] = 220;
        const alpha = Math.floor(255 * (1 - (dist - 0.25) / 0.10));
        buffer[idx + 3] = Math.max(1, Math.min(254, alpha)); // Partial alpha
      } else {
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0; // Fully transparent
      }
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

async function createIccProfileFixture(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const buffer = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const idx = (y * width + x) * channels;
      buffer[idx] = Math.floor(180 * nx);
      buffer[idx + 1] = Math.floor(180 * ny);
      buffer[idx + 2] = Math.floor(200 * (1 - nx));
    }
  }

  const png = await sharp(buffer, {
    raw: { width, height, channels },
  })
    .withMetadata({ icc: "srgb" })
    .png()
    .toBuffer();

  return new Uint8Array(png);
}

export async function createPhase6MediaFixture(
  kind: MediaFixtureKind,
  width: number,
  height: number
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("MEDIA_FIXTURE_DIMENSIONS_INVALID");
  }

  switch (kind) {
    case "photo":
      return createPhotoFixture(width, height);
    case "text-packaging":
      return createTextPackagingFixture(width, height);
    case "fine-texture":
      return createFineTextureFixture(width, height);
    case "dark-gradient":
      return createDarkGradientFixture(width, height);
    case "transparent":
      return createTransparentFixture(width, height);
    case "icc-profile":
      return createIccProfileFixture(width, height);
  }
}

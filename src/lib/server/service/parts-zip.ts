/**
 * Minimal ZIP (store-only) codec — no compression dependency.
 * Sufficient for Owlery DB parts packs (JSON + binary assets).
 */

type ZipEntry = { path: string; data: Uint8Array };

function crc32(buf: Uint8Array): number {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i]!;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
		}
	}
	return ~c >>> 0;
}

function u16(n: number): Buffer {
	const b = Buffer.alloc(2);
	b.writeUInt16LE(n, 0);
	return b;
}

function u32(n: number): Buffer {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(n >>> 0, 0);
	return b;
}

export function createZip(entries: ZipEntry[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.path, 'utf8');
		const data = Buffer.from(entry.data);
		const crc = crc32(entry.data);
		const local = Buffer.concat([
			u32(0x04034b50),
			u16(20),
			u16(0),
			u16(0),
			u16(0),
			u16(0),
			u32(crc),
			u32(data.length),
			u32(data.length),
			u16(name.length),
			u16(0),
			name,
			data
		]);
		const central = Buffer.concat([
			u32(0x02014b50),
			u16(20),
			u16(20),
			u16(0),
			u16(0),
			u16(0),
			u16(0),
			u32(crc),
			u32(data.length),
			u32(data.length),
			u16(name.length),
			u16(0),
			u16(0),
			u16(0),
			u16(0),
			u32(0),
			u32(offset),
			name
		]);
		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}

	const centralDir = Buffer.concat(centrals);
	const end = Buffer.concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(entries.length),
		u16(entries.length),
		u32(centralDir.length),
		u32(offset),
		u16(0)
	]);

	return Buffer.concat([...locals, centralDir, end]);
}

export function readZip(buf: Buffer): Map<string, Buffer> {
	const out = new Map<string, Buffer>();
	let i = 0;
	while (i + 4 <= buf.length) {
		const sig = buf.readUInt32LE(i);
		if (sig !== 0x04034b50) break;
		const compression = buf.readUInt16LE(i + 8);
		const compSize = buf.readUInt32LE(i + 18);
		const nameLen = buf.readUInt16LE(i + 26);
		const extraLen = buf.readUInt16LE(i + 28);
		const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
		const dataStart = i + 30 + nameLen + extraLen;
		const data = buf.subarray(dataStart, dataStart + compSize);
		if (compression !== 0) {
			throw new Error(`Unsupported ZIP compression for ${name} (only store is supported)`);
		}
		out.set(name, Buffer.from(data));
		i = dataStart + compSize;
	}
	return out;
}

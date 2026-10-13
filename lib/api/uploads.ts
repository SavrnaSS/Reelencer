import { ApiError } from "./errors";

export async function validateUpload(file: File, allowed: string[], maxBytes: number) {
  if (!allowed.includes(file.type)) throw new ApiError(415, "This file type is not supported.");
  if (file.size <= 0 || file.size > maxBytes) throw new ApiError(413, "The file is empty or exceeds the upload limit.");
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
  const matches: Record<string, boolean> = {
    "image/jpeg": starts(0xff, 0xd8, 0xff),
    "image/png": starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    "image/webp": ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP",
    "application/pdf": ascii(0, 5) === "%PDF-",
    "video/mp4": ascii(4, 8) === "ftyp",
    "video/quicktime": ["ftyp", "moov"].includes(ascii(4, 8)),
    "video/webm": starts(0x1a, 0x45, 0xdf, 0xa3),
  };
  if (!matches[file.type]) throw new ApiError(415, "The file content does not match its type.");
}

export function ownedStoragePath(path: string, prefix: string) {
  return path.startsWith(prefix) && !path.includes("..") && !/[\\\x00-\x1f]/.test(path) && path.length < 500;
}

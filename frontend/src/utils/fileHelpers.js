import { createSHA256 } from "hash-wasm";

const CHUNK_SIZE = 5 * 1024 * 1024;

export const calculateFileHash = async (file) => {
  const hasher = await createSHA256();
  const hashReadSize = 8 * 1024 * 1024;

  for (let start = 0; start < file.size; start += hashReadSize) {
    const buffer = await file
      .slice(start, Math.min(start + hashReadSize, file.size))
      .arrayBuffer();
    hasher.update(new Uint8Array(buffer));
  }

  return hasher.digest();
};

export const createChunkMap = (fileSize, completedIndices = []) => {
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  return Array.from({ length: totalChunks }, (_, i) => {
    const isDone = completedIndices.includes(i);
    return {
      index: i,
      status: isDone ? "success" : "pending",
      start: i * CHUNK_SIZE,
      end: Math.min((i + 1) * CHUNK_SIZE, fileSize),
      size: Math.min((i + 1) * CHUNK_SIZE, fileSize) - i * CHUNK_SIZE,
    };
  });
};

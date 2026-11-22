import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    chunked_uploads: {
      executor: "constant-vus",
      vus: 20,
      duration: "30s",
    },
  },
};

const baseUrl = __ENV.BACKEND_URL || "http://localhost:3002";
const chunk = new Uint8Array(1024 * 1024);

export default function () {
  const uploadId = `${__VU}-${__ITER}`;
  const fileHash = uploadId.padEnd(64, "0");
  const statusResponse = http.get(`${baseUrl}/upload/status?fileHash=${fileHash}&fileName=load-test.mp4&fileSize=${chunk.byteLength}`);
  check(statusResponse, { "upload status creates session": (result) => result.status === 200 });
  const session = statusResponse.json();
  const response = http.post(`${baseUrl}/upload/chunk`, chunk, {
    headers: {
      "Content-Type": "application/octet-stream",
      "x-upload-id": session.uploadId,
      "x-chunk-index": "0",
      "x-chunk-start": "0",
    },
  });
  check(response, { "chunk endpoint accepts chunk": (result) => result.status === 200 });
  sleep(1);
}
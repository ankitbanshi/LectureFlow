import axios from "axios";

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3002";

export const videoService = {
  list: () => axios.get(`${BACKEND_URL}/videos`),
  get: (id) => axios.get(`${BACKEND_URL}/videos/${id}`),
  searchTranscript: (id, query) =>
    axios.get(`${BACKEND_URL}/videos/${id}/search`, { params: { q: query } }),
};

export const mediaUrl = (url) =>
  url?.startsWith("http") ? url : `${BACKEND_URL}${url || ""}`;

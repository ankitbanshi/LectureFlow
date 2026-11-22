const test = require("node:test");
const assert = require("node:assert/strict");

const videoFilePattern = /\.(mp4|mkv|mov|webm)$/i;

test("accepts supported lecture video extensions", () => {
  for (const filename of ["lecture.mp4", "lecture.MKV", "lecture.mov", "lecture.webm"]) {
    assert.equal(videoFilePattern.test(filename), true);
  }
});

test("rejects non-video uploads", () => {
  for (const filename of ["lecture.zip", "notes.pdf", "audio.mp3"]) {
    assert.equal(videoFilePattern.test(filename), false);
  }
});
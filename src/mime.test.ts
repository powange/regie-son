import { describe, it, expect } from "vitest";
import { audioMimeType } from "./mime";

describe("audioMimeType", () => {
  it("returns correct MIME for common formats", () => {
    expect(audioMimeType("song.mp3")).toBe("audio/mpeg");
    expect(audioMimeType("track.ogg")).toBe("audio/ogg");
    expect(audioMimeType("sample.wav")).toBe("audio/wav");
    expect(audioMimeType("file.flac")).toBe("audio/flac");
    expect(audioMimeType("file.m4a")).toBe("audio/mp4");
    expect(audioMimeType("file.aac")).toBe("audio/aac");
    expect(audioMimeType("file.webm")).toBe("audio/webm");
  });

  it("is case-insensitive", () => {
    expect(audioMimeType("Song.MP3")).toBe("audio/mpeg");
    expect(audioMimeType("TRACK.Ogg")).toBe("audio/ogg");
  });

  it("handles filenames with multiple dots", () => {
    expect(audioMimeType("my.song.v2.mp3")).toBe("audio/mpeg");
    expect(audioMimeType("a.b.c.d.flac")).toBe("audio/flac");
  });

  it("handles UUID-style filenames (as used by copy_audio_file)", () => {
    expect(audioMimeType("550e8400-e29b-41d4-a716-446655440000.mp3")).toBe("audio/mpeg");
  });

  it("falls back to audio/mpeg for unknown extension", () => {
    expect(audioMimeType("file.xyz")).toBe("audio/mpeg");
    expect(audioMimeType("noextension")).toBe("audio/mpeg");
    expect(audioMimeType("")).toBe("audio/mpeg");
  });

  it("opus includes codec hint", () => {
    expect(audioMimeType("voice.opus")).toBe("audio/ogg; codecs=opus");
  });
});

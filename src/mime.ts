// Détermine le MIME type audio à partir de l'extension du fichier.
// Utilisé pour créer les Blob URLs avec le bon type, ce qui permet
// à l'élément <audio> de choisir le bon décodeur.

const MIME_MAP: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wma: "audio/x-ms-wma",
  opus: "audio/ogg; codecs=opus",
  webm: "audio/webm",
};

export function audioMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "audio/mpeg";
}

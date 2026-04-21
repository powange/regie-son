export interface AudioFile {
  type: "audio";
  id: string;
  filename: string;
  original_name: string;
  volume: number; // 0–100
  startTime?: number; // secondes
  endTime?: number;   // secondes
  fadeIn?: number;    // secondes
  fadeOut?: number;   // secondes
  cue?: string;       // top de départ (indication pour le régisseur)
}

export interface PauseItem {
  type: "pause";
  id: string;
  cue?: string;       // top de départ (indication pour le régisseur)
}

export type PlaylistItem = AudioFile | PauseItem;

export type NumeroType = "numero" | "entracte" | "presentation";

export interface Numero {
  id: string;
  type: NumeroType;
  name: string;
  items: PlaylistItem[];
}

export interface Project {
  name: string;
  path: string;
  numeros: Numero[];
  singleNumero?: boolean;
}

import { describe, it, expect } from "vitest";
import { friendlyError } from "./friendlyError";

describe("friendlyError", () => {
  it("returns default message for empty input", () => {
    expect(friendlyError("")).toBe("Une erreur inconnue est survenue.");
    expect(friendlyError(null)).toBe("Une erreur inconnue est survenue.");
    expect(friendlyError(undefined)).toBe("Une erreur inconnue est survenue.");
  });

  it("maps yt-dlp private video", () => {
    expect(friendlyError("ERROR: Private video")).toBe(
      "Cette vidéo est privée et ne peut pas être téléchargée.",
    );
  });

  it("maps yt-dlp video unavailable", () => {
    expect(friendlyError("ERROR: Video unavailable")).toBe(
      "Cette vidéo n'est plus disponible.",
    );
    expect(friendlyError("This video is unavailable")).toBe(
      "Cette vidéo n'est plus disponible.",
    );
  });

  it("maps age restriction", () => {
    expect(friendlyError("Sign in to confirm your age")).toBe(
      "Cette vidéo est soumise à une restriction d'âge.",
    );
  });

  it("maps network timeouts", () => {
    expect(friendlyError("request timed out")).toBe(
      "Délai d'attente dépassé. Vérifiez votre connexion.",
    );
    expect(friendlyError("operation timed out after 30s")).toBe(
      "Délai d'attente dépassé. Vérifiez votre connexion.",
    );
  });

  it("maps DNS errors", () => {
    expect(friendlyError("dns error: failed to lookup address info")).toBe(
      "Impossible de résoudre l'adresse du serveur.",
    );
  });

  it("maps connection refused", () => {
    expect(friendlyError("tcp connect error: connection refused")).toBe(
      "Impossible de se connecter au serveur.",
    );
  });

  it("maps HTTP status errors", () => {
    expect(friendlyError("Erreur HTTP 404 : http://example.com")).toBe(
      "URL introuvable (404).",
    );
    expect(friendlyError("Erreur HTTP 403 : http://x.com")).toBe(
      "Accès refusé par le serveur (403).",
    );
    expect(friendlyError("Erreur HTTP 503 : http://x.com")).toBe(
      "Erreur côté serveur, réessayez plus tard.",
    );
  });

  it("recognises cancellation message", () => {
    expect(friendlyError("Téléchargement annulé.")).toBe("Téléchargement annulé.");
  });

  it("passes through already-French Rust messages", () => {
    const msg = "Fichier trop volumineux (limite : 500 Mo).";
    expect(friendlyError(msg)).toBe(msg);
  });

  it("passes through Erreur/Impossible prefixes", () => {
    expect(friendlyError("Erreur de sérialisation")).toBe("Erreur de sérialisation");
    expect(friendlyError("Impossible de lire le fichier")).toBe(
      "Impossible de lire le fichier",
    );
  });

  it("wraps unknown English messages with Erreur prefix", () => {
    expect(friendlyError("something went wrong")).toBe("Erreur : something went wrong");
  });

  it("handles Error objects via String coercion", () => {
    expect(friendlyError(new Error("Private video detected"))).toBe(
      "Cette vidéo est privée et ne peut pas être téléchargée.",
    );
  });
});

// Mappe les erreurs brutes (Rust, yt-dlp, reqwest, HTTP) vers des messages
// utilisateur en français. Utilisé dans les modals de téléchargement.

const PATTERNS: Array<[RegExp, string]> = [
  // yt-dlp
  [/private video/i, "Cette vidéo est privée et ne peut pas être téléchargée."],
  [/video unavailable/i, "Cette vidéo n'est plus disponible."],
  [/sign in to confirm your age/i, "Cette vidéo est soumise à une restriction d'âge."],
  [/unsupported url/i, "Ce lien n'est pas pris en charge."],
  [/video is unavailable/i, "Cette vidéo n'est plus disponible."],
  [/members-only content/i, "Cette vidéo est réservée aux membres."],
  [/requested format (is )?not available/i, "Aucune piste audio compatible trouvée."],

  // reqwest / réseau
  [/request timed out|operation timed out|timed out/i, "Délai d'attente dépassé. Vérifiez votre connexion."],
  [/dns error|failed to lookup address|name resolution/i, "Impossible de résoudre l'adresse du serveur."],
  [/tcp connect error|connection refused|connection reset/i, "Impossible de se connecter au serveur."],
  [/certificate|ssl|tls handshake/i, "Erreur de sécurité TLS avec le serveur."],
  [/error decoding response/i, "Réponse serveur invalide."],

  // HTTP
  [/erreur http 404/i, "URL introuvable (404)."],
  [/erreur http 403/i, "Accès refusé par le serveur (403)."],
  [/erreur http 401/i, "Authentification requise (401)."],
  [/erreur http 5\d\d/i, "Erreur côté serveur, réessayez plus tard."],

  // Annulation
  [/t[ée]l[ée]chargement annul[ée]/i, "Téléchargement annulé."],
];

export function friendlyError(raw: unknown): string {
  const msg = String(raw ?? "").trim();
  if (!msg) return "Une erreur inconnue est survenue.";
  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(msg)) return friendly;
  }
  // Déjà en français (messages Rust custom) — on garde tel quel
  if (/[éèêàâîôûç]/i.test(msg) || /^(Erreur|Impossible|Fichier|Session|yt-dlp|Aucune)/i.test(msg)) {
    return msg;
  }
  // Fallback générique — on expose quand même le message brut en dernier recours
  return `Erreur : ${msg}`;
}

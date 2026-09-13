import i18next from "i18next";

// Ce qu'une commande Tauri renvoie quand elle échoue : un code du catalogue
// `errors`, ses paramètres d'interpolation, et le message brut de l'OS ou de la
// bibliothèque. Le `detail` n'est jamais traduit — c'est ce qu'on lit pour
// déboguer, et c'est ce que les motifs ci-dessous reconnaissent.
interface AppError {
  code: string;
  detail?: string;
  params?: Record<string, string>;
}

// yt-dlp et reqwest ne nous donnent pas de codes, seulement des phrases en
// anglais. Ces motifs restent donc des regex — mais ils ne s'appliquent plus
// qu'au `detail`, jamais à un message produit par notre propre code Rust.
const DETAIL_PATTERNS: Array<[RegExp, string]> = [
  // yt-dlp
  [/private video/i, "friendly.privateVideo"],
  [/video unavailable/i, "friendly.videoUnavailable"],
  [/video is unavailable/i, "friendly.videoUnavailable"],
  [/sign in to confirm your age/i, "friendly.ageRestricted"],
  [/unsupported url/i, "friendly.unsupportedUrl"],
  [/members-only content/i, "friendly.membersOnly"],
  [/requested format (is )?not available/i, "friendly.noCompatibleAudio"],

  // reqwest / réseau
  [/request timed out|operation timed out|timed out/i, "friendly.timeout"],
  [/dns error|failed to lookup address|name resolution/i, "friendly.dnsFailed"],
  [/tcp connect error|connection refused|connection reset/i, "friendly.connectionRefused"],
  [/certificate|ssl|tls handshake/i, "friendly.tlsError"],
  [/error decoding response/i, "friendly.invalidResponse"],
];

// Les deux seuls codes qui portent un statut HTTP. Les autres messages HTTP
// n'ont jamais eu de traitement particulier et n'en prennent pas.
const HTTP_STATUS_CODES = new Set(["download.httpStatus", "download.httpStatusUpdate"]);

function translate(key: string, params?: Record<string, unknown>): string {
  // La clé vient de Rust : le typage ne peut pas la vérifier. Le garde-fou est
  // errorMessage.test.ts, qui relit les sources Rust et vérifie que chaque code
  // émis existe bien dans le catalogue.
  const t = i18next.getFixedT(null, "errors") as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;
  return t(key, params);
}

function matchDetail(detail: string): string | null {
  for (const [pattern, key] of DETAIL_PATTERNS) {
    if (pattern.test(detail)) return key;
  }
  return null;
}

function httpStatusKey(status: string | undefined): string | null {
  const code = Number(status);
  if (!Number.isFinite(code)) return null;
  if (code === 401) return "friendly.http401";
  if (code === 403) return "friendly.http403";
  if (code === 404) return "friendly.http404";
  if (code >= 500 && code <= 599) return "friendly.http5xx";
  return null;
}

function asAppError(raw: unknown): AppError | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as { code?: unknown; detail?: unknown; params?: unknown };
  if (typeof candidate.code !== "string") return null;
  return {
    code: candidate.code,
    detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
    params:
      typeof candidate.params === "object" && candidate.params !== null
        ? (candidate.params as Record<string, string>)
        : undefined,
  };
}

// Lit i18next directement plutôt que de recevoir un `t`, contrairement à
// preflightMessage : un message d'erreur est calculé une fois au moment du
// `catch` puis rangé dans un state, donc il n'a pas à être réactif — et les
// appelants sont autant des hooks que des composants.
export function translateError(raw: unknown): string {
  // set_show_mode renvoie un code par volet en échec : couper les notifications
  // et bloquer la veille sont indépendants, et l'opérateur doit savoir lequel
  // des deux a renoncé.
  if (Array.isArray(raw)) {
    const parts = raw.map((item) => translateError(item)).filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : translate("unknown");
  }

  const err = asAppError(raw);
  if (!err) {
    const message = String(raw ?? "").trim();
    if (!message) return translate("unknown");
    const key = matchDetail(message);
    return key ? translate(key) : translate("raw", { detail: message });
  }

  if (err.detail) {
    const key = matchDetail(err.detail);
    if (key) return translate(key);
  }
  if (HTTP_STATUS_CODES.has(err.code)) {
    const key = httpStatusKey(err.params?.status);
    if (key) return translate(key);
  }
  return translate(err.code, { ...err.params, detail: err.detail ?? "" });
}

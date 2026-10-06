// Android and iOS builds share the web frontend with the desktop apps. The
// features whose backend only exists on desktop (yt-dlp, the updater, folder
// pickers, audio output routing) are hidden there rather than failing.
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

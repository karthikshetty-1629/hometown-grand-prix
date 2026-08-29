// Resolves the game server's base URL.
//
// Web dev (`npm run dev`): defaults to localhost, since the browser and the
// server run on the same machine.
//
// Native app (Capacitor, iOS/Android): "localhost" means the phone itself,
// not your laptop, so there is no safe default. The app asks for a server
// address on first launch (see serverSetup.js) and remembers it on-device.
// A build-time default can still be baked in via VITE_API_BASE_URL for a
// cloud-hosted server that never changes.

import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'apiBaseUrl';
const BUILD_TIME_URL = import.meta.env.VITE_API_BASE_URL || '';
const DEFAULT_WEB_URL = 'http://localhost:3001';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function getApiBaseUrl() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  if (BUILD_TIME_URL) return BUILD_TIME_URL;
  if (isNativeApp()) return '';
  return DEFAULT_WEB_URL;
}

export function setApiBaseUrl(url) {
  const trimmed = url.trim().replace(/\/$/, '');
  localStorage.setItem(STORAGE_KEY, trimmed);
  return trimmed;
}

export function needsServerSetup() {
  return !getApiBaseUrl();
}

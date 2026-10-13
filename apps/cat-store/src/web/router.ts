import { store } from "./store";
import { setRoute } from "./store/ui-slice";

import type { OnNavigateCb } from "./types";

const listeners = new Set<OnNavigateCb>();

function syncRoute(route: string): void {
  store.dispatch(setRoute(route));
  listeners.forEach((cb) => cb(route));
}

export function toRelative(path: string): string {
  if (path.startsWith("#")) {
    path = path.slice(1);
  }
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return path === "" ? "/" : path;
}

export function currentPath(): string {
  if (typeof location === "undefined") return "/";
  const hash = location.hash;
  if (hash.startsWith("#/")) {
    return hash.slice(1);
  }
  if (hash.startsWith("#")) {
    const rel = hash.slice(1);
    return rel.startsWith("/") ? rel : "/" + rel;
  }
  return "/";
}

export function navigate(path: string): void {
  const relPath = toRelative(path);
  const targetHash = "#" + relPath;

  if (typeof location !== "undefined" && location.hash !== targetHash) {
    location.hash = targetHash;
  } else {
    syncRoute(relPath);
  }
}

export function registerOnNavigate(cb: OnNavigateCb): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    syncRoute(currentPath());
  });
}

export function getAbsoluteBaseURL(baseURL: string): string {
  if (baseURL.startsWith("/")) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}${baseURL}`;
    }
    return `http://localhost:8080${baseURL}`;
  }
  return baseURL;
}

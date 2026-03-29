const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(url, {
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  timeoutMessage = null,
  ...options
} = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(timeoutMessage || `Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

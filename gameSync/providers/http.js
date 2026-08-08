export class ProviderHttpError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchWithRetry(url, options = {}, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      if (response.status === 429) {
        throw new ProviderHttpError("The provider rate limit is active. Please retry later.", 429);
      }
      if (response.status < 500 || attempt === 2) return response;
      lastError = new ProviderHttpError(`Provider request failed (${response.status}).`, response.status);
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 429) throw error;
      lastError = error;
    }
    await pause(200 * (2 ** attempt));
  }
  throw lastError || new ProviderHttpError("Provider request failed.");
}

export async function jsonResponse(response, notFoundMessage) {
  if (response.status === 404 || response.status === 410) {
    throw new ProviderHttpError(notFoundMessage, 404);
  }
  if (!response.ok) {
    throw new ProviderHttpError(`Provider request failed (${response.status}).`, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderHttpError("Provider returned malformed JSON.");
  }
}

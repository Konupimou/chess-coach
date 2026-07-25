function cleanHeader(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function siteIdentityFromHeaders(headers) {
  if (!headers || typeof headers.get !== "function") {
    return { authenticated: false, user: null };
  }
  const email = cleanHeader(headers.get("oai-authenticated-user-email"), 254).toLowerCase();
  if (!email || !email.includes("@")) {
    return { authenticated: false, user: null };
  }
  const fullName = cleanHeader(headers.get("oai-authenticated-user-full-name"), 100);
  return {
    authenticated: true,
    user: {
      email,
      name: fullName || email.split("@")[0],
    },
  };
}

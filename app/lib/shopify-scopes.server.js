import db from "../db.server";

const APP_INSTALLATION_SCOPES_QUERY = `#graphql
  query AppInstallationAccessScopes {
    appInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

export const REQUIRED_MARKET_SCOPES = ["read_markets", "write_markets"];

export async function hasRequiredMarketScopes(admin, session) {
  const liveScopes = await loadAppInstallationScopes(admin);

  if (liveScopes) {
    await refreshSessionScopes(session, liveScopes);
    return hasScopes(liveScopes, REQUIRED_MARKET_SCOPES);
  }

  return true;
}

async function loadAppInstallationScopes(admin) {
  try {
    const response = await admin.graphql(APP_INSTALLATION_SCOPES_QUERY);
    const payload = await response.json();

    if (payload.errors) return null;

    return (payload.data?.appInstallation?.accessScopes || [])
      .map((scope) => scope?.handle)
      .filter(Boolean);
  } catch {
    return null;
  }
}

async function refreshSessionScopes(session, scopes) {
  if (!session?.id || !Array.isArray(scopes) || !scopes.length) return;

  const scopeString = scopes.join(",");
  if (scopeString === session.scope) return;

  await db.session.updateMany({
    where: { id: session.id },
    data: { scope: scopeString },
  });
}

function hasScopes(grantedScopes, requiredScopes) {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
}

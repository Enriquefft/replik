import "server-only";

export const META_GRAPH_VERSION = "v21.0";
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export class MetaAuthError extends Error {
  constructor(message = "Token Meta inválido o sin permisos") {
    super(message);
    this.name = "MetaAuthError";
  }
}

export interface MetaAccount {
  id: string;
  account_id: string;
}

interface AccountsResponse {
  data?: MetaAccount[];
  error?: { code?: number; message?: string };
}

export async function accountsList(creds: {
  token: string;
}): Promise<MetaAccount[]> {
  const url = `${META_GRAPH_BASE}/me/adaccounts?access_token=${encodeURIComponent(creds.token)}&fields=id,account_id`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new MetaAuthError("No se pudo conectar con Meta.");
  }
  if (!response.ok) {
    throw new MetaAuthError();
  }
  const body = (await response.json()) as AccountsResponse;
  if (body.error || !Array.isArray(body.data)) {
    throw new MetaAuthError();
  }
  return body.data;
}

export interface MetaPixel {
  id: string;
  name?: string;
}

interface PixelsResponse {
  data?: MetaPixel[];
  error?: { code?: number; message?: string };
}

export async function pixelsList(creds: {
  token: string;
  ad_account_id: string;
}): Promise<MetaPixel[]> {
  const url = `${META_GRAPH_BASE}/act_${encodeURIComponent(creds.ad_account_id)}/adspixels?access_token=${encodeURIComponent(creds.token)}&fields=id,name`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new MetaAuthError("No se pudo conectar con Meta.");
  }
  if (!response.ok) {
    throw new MetaAuthError();
  }
  const body = (await response.json()) as PixelsResponse;
  if (body.error || !Array.isArray(body.data)) {
    throw new MetaAuthError();
  }
  return body.data;
}

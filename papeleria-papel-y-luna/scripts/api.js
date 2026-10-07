const API_URL = "https://script.google.com/macros/s/AKfycbwUUDFPAQusFgvtwTyQa2CY3IWV8kyNznt7BvwGyGaDPMsH4bxEiNEn8PuwWH40ZPL_7Q/exec";

async function apiGet(resource) {
  const res = await fetch(`${API_URL}?resource=${encodeURIComponent(resource)}`);
  const json = await readResponse(res);
  return json.data;
}

async function apiPost(resource, action, data) {
  const res = await fetch(`${API_URL}?resource=${encodeURIComponent(resource)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, data })
  });
  const json = await readResponse(res);
  return json.data;
}

async function readResponse(response) {
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`El servicio respondió con un formato inesperado (HTTP ${response.status}).`);
  }
  if (!response.ok || !json.success) {
    throw new Error(json.message || `Error de conexión con el servicio (HTTP ${response.status}).`);
  }
  return json;
}

export const api = {
  list: apiGet,
  create: (resource, data) => apiPost(resource, "create", data),
  update: (resource, data) => apiPost(resource, "update", data),
  remove: (resource, id) => apiPost(resource, "delete", { id })
};

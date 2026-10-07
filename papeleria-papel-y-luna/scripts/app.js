import { api } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { productos: [], ventas: [], compras: [], clientes: [], proveedores: [], categorias: [], lines: [], purchaseLines: [], currentSaleId: null, purchaseId: null, selectedSale: null, busy: false };
const stockDone = {}; // id de operación -> productos cuyo stock ya se actualizó en el servicio (evita descontar dos veces al reintentar)
const paymentMethods = ["Efectivo", "Nequi", "Debe"];
const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const cash = (value) => money.format(Number(value) || 0);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const uid = () => crypto.randomUUID();
const product = (id) => state.productos.find((item) => item.id === id);
const categoryName = (id) => state.categorias.find((item) => item.id === id)?.nombre || "Sin categoría";
const linesJson = (value) => { if (Array.isArray(value)) return value; try { return JSON.parse(value || "[]"); } catch { return []; } };
const total = () => state.lines.reduce((sum, line) => sum + Number(line.precio) * Number(line.cantidad), 0);

function toast(message, error = false) {
  const box = $("#toast"); box.textContent = message; box.classList.toggle("is-error", error); box.classList.add("is-visible");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove("is-visible"), 4000);
}
function busy(value) {
  state.busy = value; document.querySelectorAll("button").forEach((button) => {
    if (button.matches(".nav-button, [data-view]")) return;
    button.disabled = value || button.hasAttribute("data-soldout");
  });
}
function setStatus(message, error = false) {
  const status = $("#appStatus"), badge = $("#connectionBadge");
  clearTimeout(setStatus.timer);
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle("is-error", error);
  const connected = !error && message.toLocaleLowerCase().startsWith("conectado");
  badge.hidden = !connected;
  if (connected) setStatus.timer = setTimeout(() => { status.hidden = true; }, 20000);
}
async function refresh(resources = ["productos", "ventas", "compras", "clientes", "proveedores", "categorias"]) {
  busy(true); setStatus("Sincronizando datos…");
  try {
    const values = await Promise.all(resources.map((resource) => api.list(resource)));
    resources.forEach((resource, index) => { state[resource] = values[index].map((record) => normalize(resource, record)); });
    renderAll(); setStatus("Conectado al servicio de Papel y Luna.");
  } catch (error) { setStatus(error.message, true); toast(error.message, true); }
  finally { busy(false); }
}
const asText = (value) => (value === undefined || value === null ? "" : String(value));
function normalize(resource, data) {
  const base = { ...data };
  // Sheets puede devolver como número un id, código o teléfono que "parece número": se comparan siempre como texto
  ["id", "codigo", "nombre", "telefono", "correo", "categoriaId", "clienteId", "proveedorId"].forEach((key) => { if (key in base) base[key] = asText(base[key]); });
  if (resource === "productos") return { ...base, precio: Number(base.precio) || 0, costo: Number(base.costo) || 0, stock: Number(base.stock) || 0, seguimientoInventario: base.seguimientoInventario === true || String(base.seguimientoInventario).toLowerCase() === "true" };
  if (resource === "ventas") return { ...base, total: Number(base.total) || 0, subtotal: Number(base.subtotal) || 0, valorRecibido: Number(base.valorRecibido) || 0, cambio: Number(base.cambio) || 0, itemsJson: linesJson(base.itemsJson) };
  if (resource === "compras") return { ...base, total: Number(base.total) || 0, itemsJson: linesJson(base.itemsJson) };
  return base;
}
// Crea; si el id ya existe (reintento tras un fallo a mitad de camino) actualiza en lugar de duplicar
async function upsert(resource, record, exists) {
  if (exists) return api.update(resource, record);
  try { return await api.create(resource, record); }
  catch (error) { if (/Ya existe un registro/i.test(error.message)) return api.update(resource, record); throw error; }
}
async function applyInventory(opId, lines, change) {
  const done = (stockDone[opId] = stockDone[opId] || new Set());
  for (const line of lines) {
    if (done.has(line.productoId)) continue;
    const item = product(line.productoId); if (!item) continue;
    const next = change(item, line);
    if (next) { await api.update("productos", next); state.productos[state.productos.findIndex((old) => old.id === item.id)] = next; }
    done.add(line.productoId);
  }
  delete stockDone[opId];
}
async function save(resource, record, editing = false) {
  busy(true);
  try {
    const result = editing ? await api.update(resource, record) : await api.create(resource, record);
    const saved = normalize(resource, result || record);
    const at = state[resource].findIndex((item) => item.id === saved.id);
    if (at >= 0) state[resource][at] = saved; else state[resource].unshift(saved);
    renderAll(); toast(editing ? "Cambios guardados." : "Registro creado."); return saved;
  } catch (error) { toast(error.message, true); throw error; }
  finally { busy(false); }
}
async function removeRecord(resource, record) {
  const related = resource === "categorias" ? state.productos.some((item) => item.categoriaId === record.id) :
    resource === "proveedores" ? state.compras.some((item) => item.proveedorId === record.id) :
      state.ventas.some((item) => item.clienteId === record.id);
  if (related) return toast("No se puede eliminar: hay registros relacionados.", true);
  if (!window.confirm(`¿Eliminar ${record.nombre || record.codigo || "este registro"}?`)) return;
  busy(true);
  try { await api.remove(resource, record.id); state[resource] = state[resource].filter((item) => item.id !== record.id); renderAll(); toast("Registro eliminado."); }
  catch (error) { toast(error.message, true); }
  finally { busy(false); }
}
function renderAll() {
  renderCatalog(); renderCart(); renderProducts(); renderHistory(); renderPurchases(); renderPurchaseLines(); renderEntityList(); fillRelations();
}
function setOptions(select, html) { const previous = select.value; select.innerHTML = html; if ([...select.options].some((option) => option.value === previous)) select.value = previous; }
function fillRelations() {
  setOptions($("#saleCustomer"), `<option value="">Venta sin cliente</option>${state.clientes.map((item) => `<option value="${esc(item.id)}">${esc(item.nombre)}</option>`).join("")}`);
  setOptions($("#purchaseSupplier"), `<option value="">Selecciona proveedor</option>${state.proveedores.map((item) => `<option value="${esc(item.id)}">${esc(item.nombre)}</option>`).join("")}`);
  setOptions($("#purchaseProduct"), state.productos.map((item) => `<option value="${esc(item.id)}">${esc(item.nombre)} · ${cash(item.costo)}</option>`).join(""));
  if ($("#purchaseCost").value === "") syncPurchaseCost();
  $("#openSalesSelect").innerHTML = `<option value="">Retomar venta abierta…</option>${state.ventas.filter((sale) => sale.estado === "abierta").map((sale) => `<option value="${esc(sale.id)}">Venta ${esc(sale.id.slice(0, 8))} · ${cash(sale.total)}</option>`).join("")}`;
  const catSelect = $("#productFormContainer select[name='categoriaId']"); if (catSelect) catSelect.innerHTML = categoryOptions(catSelect.value || catSelect.dataset.value);
}
function syncPurchaseCost() { const item = product($("#purchaseProduct").value); if (item) $("#purchaseCost").value = item.costo; }
function categoryOptions(selected = "") { return `<option value="">Sin categoría</option>${state.categorias.map((item) => `<option value="${esc(item.id)}" ${item.id === selected ? "selected" : ""}>${esc(item.nombre)}</option>`).join("")}`; }
function renderCatalog() {
  const term = $("#searchInput").value.trim().toLocaleLowerCase();
  const matches = state.productos.filter((item) => `${item.nombre} ${item.codigo} ${categoryName(item.categoriaId)}`.toLocaleLowerCase().includes(term));
  $("#catalogCount").textContent = `${matches.length} producto(s)`;
  $("#catalogGrid").innerHTML = matches.map((item) => `<article class="product-card"><div class="product-body"><div class="product-meta"><span class="category">${esc(categoryName(item.categoriaId))}</span><span class="price">${cash(item.precio)}</span></div><h3>${esc(item.nombre)}</h3><p class="product-code">${esc(item.codigo)} · ${item.seguimientoInventario ? `${item.stock} disponibles` : "Sin seguimiento"}</p><div class="card-actions"><input class="quantity-input" type="number" min="1" value="1" aria-label="Cantidad" data-quantity="${esc(item.id)}"><button class="add-button" data-add="${esc(item.id)}" ${item.seguimientoInventario && item.stock < 1 ? "disabled data-soldout" : ""}>Agregar</button><button class="text-button" data-hot-edit="${esc(item.id)}">Editar</button></div></div></article>`).join("") || '<p class="no-results">No hay productos para mostrar.</p>';
}
function renderCart() {
  $("#invoiceContent").innerHTML = state.lines.map((line) => `<article class="invoice-line"><div class="line-detail"><strong>${esc(line.nombre)}</strong><span>${cash(line.precio)} c/u</span><div class="line-subtotal">${cash(line.precio * line.cantidad)}</div></div><input class="line-quantity" type="number" min="1" value="${line.cantidad}" data-line="${esc(line.productoId)}"><button class="remove-button" data-remove-line="${esc(line.productoId)}">×</button></article>`).join("") || '<div class="empty-state"><h3>Carrito vacío</h3><p>Agrega productos para iniciar una venta.</p></div>';
  const amount = total(); $("#subtotalValue").textContent = cash(amount); $("#totalValue").textContent = cash(amount); $("#headerTotal").textContent = cash(amount);
  $("#lineCount").textContent = `${state.lines.length} ${state.lines.length === 1 ? "línea" : "líneas"}`; updateChange();
}
function addLine(id, quantity) {
  const item = product(id); if (!item) return;
  const found = state.lines.find((line) => line.productoId === id); const next = (found?.cantidad || 0) + quantity;
  if (item.seguimientoInventario && next > item.stock) return toast(`Stock insuficiente para ${item.nombre}.`, true);
  if (found) found.cantidad = next; else state.lines.push(snapshot(item, quantity)); renderCart();
}
function snapshot(item, quantity) { return { productoId: item.id, nombre: item.nombre, precio: Number(item.precio), costo: Number(item.costo), cantidad: Number(quantity) }; }
function updateChange() {
  const cashPayment = $("#paymentMethod").value === "Efectivo"; $("#receivedField").hidden = !cashPayment;
  const change = $("#changeValue"); change.hidden = !cashPayment;
  if (cashPayment) { const received = Number($("#receivedAmount").value) || 0, due = total(); change.textContent = received >= due ? `Cambio: ${cash(received - due)}` : `Faltan: ${cash(due - received)}`; }
}
function renderProducts() {
  $("#productsTableBody").innerHTML = state.productos.map((item) => `<tr><td>${esc(item.codigo)}</td><td>${esc(item.nombre)}</td><td>${esc(categoryName(item.categoriaId))}</td><td>${cash(item.precio)}</td><td>${cash(item.costo)}</td><td>${item.seguimientoInventario ? item.stock : "—"}</td><td class="table-actions"><button class="text-button" data-edit-product="${esc(item.id)}">Editar</button><button class="text-button danger" data-delete-product="${esc(item.id)}">Eliminar</button></td></tr>`).join("");
}
function renderHistory() {
  $("#historyList").innerHTML = [...state.ventas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((sale) => `<article class="history-item"><div><strong>Venta ${esc(sale.id.slice(0, 8))} · ${esc(sale.estado)}</strong><span>${new Date(sale.fecha).toLocaleString("es-CO")}</span></div><div><strong>${cash(sale.total)}</strong><span>${esc(sale.metodoPago || "Sin cobrar")}</span></div><button class="secondary-button" data-sale-detail="${esc(sale.id)}">${sale.estado === "cerrada" ? "Ver factura" : "Retomar"}</button></article>`).join("") || '<p class="no-results">Aún no hay ventas.</p>';
}
function renderPurchases() {
  $("#purchaseList").innerHTML = [...state.compras].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((buy) => {
    const supplier = state.proveedores.find((item) => item.id === buy.proveedorId)?.nombre || "Proveedor";
    return `<article class="history-item"><div><strong>${esc(supplier)}</strong><span>${new Date(buy.fecha).toLocaleString("es-CO")}</span></div><strong>${cash(buy.total)}</strong><button class="secondary-button" data-purchase-detail="${esc(buy.id)}">Ver detalle</button></article>`;
  }).join("") || '<p class="no-results">Aún no hay compras.</p>';
}
function renderEntityList() {
  const resource = $("#entityResource").value, term = $("#entitySearch").value.trim().toLocaleLowerCase();
  const records = state[resource].filter((item) => `${item.nombre} ${item.telefono || ""} ${item.correo || ""}`.toLocaleLowerCase().includes(term));
  $("#entityList").innerHTML = records.map((item) => `<article class="history-item"><div><strong>${esc(item.nombre)}</strong><span>${esc(item.telefono || item.correo || "")}</span></div><div class="inline-actions"><button class="text-button" data-edit-entity="${esc(item.id)}">Editar</button><button class="text-button danger" data-delete-entity="${esc(item.id)}">Eliminar</button></div></article>`).join("") || '<p class="no-results">No hay registros.</p>';
}
function productForm(item = null) {
  return `<form id="productForm" class="product-form" data-id="${esc(item?.id || "")}"><h3>${item ? "Editar producto" : "Nuevo producto"}</h3><label>Nombre<input name="nombre" required value="${esc(item?.nombre || "")}"></label><label>Categoría<select name="categoriaId" data-value="${esc(item?.categoriaId || "")}">${categoryOptions(item?.categoriaId)}</select></label><label>Precio de venta<input name="precio" type="number" min="0" required value="${item?.precio ?? ""}"></label><label>Costo<input name="costo" type="number" min="0" required value="${item?.costo ?? ""}"></label><label>Código interno<input name="codigo" required value="${esc(item?.codigo || "")}"></label><label class="checkbox-label"><input name="seguimientoInventario" type="checkbox" ${item?.seguimientoInventario !== false ? "checked" : ""}> Controlar inventario</label><label>Stock<input name="stock" type="number" min="0" value="${item?.stock ?? 0}"></label><div class="inline-actions"><button class="primary-button">Guardar producto</button><button type="button" class="secondary-button" data-cancel-form>Cancelar</button></div></form>`;
}
function entityForm(resource, item = null) {
  const fields = resource === "categorias" ? [["nombre", "Nombre", true]] : [["nombre", "Nombre", true], ["telefono", "Teléfono", false], ["correo", "Correo", false]];
  return `<form id="entityForm" class="product-form" data-id="${esc(item?.id || "")}"><h3>${item ? "Editar registro" : "Nuevo registro"}</h3>${fields.map(([key, label, required]) => `<label>${label}<input name="${key}" ${required ? "required" : ""} value="${esc(item?.[key] || "")}" ${key === "correo" ? "type=email" : ""}></label>`).join("")}<div class="inline-actions"><button class="primary-button">Guardar</button><button type="button" class="secondary-button" data-cancel-form>Cancelar</button></div></form>`;
}
function changeView(view) {
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("is-active", section.id === `${view}View`));
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (view === "entities") renderEntityList(); window.scrollTo({ top: 0, behavior: "smooth" });
}
async function persistSale(status) {
  if (state.busy) return;
  if (!state.lines.length) return toast("Agrega al menos un producto.", true);
  const method = $("#paymentMethod").value, amount = total(), received = Number($("#receivedAmount").value) || 0;
  const clientId = $("#saleCustomer").value;
  if (status === "cerrada" && method === "Debe" && !clientId) return toast("El método Debe requiere asociar un cliente.", true);
  if (status === "cerrada" && method === "Efectivo" && received < amount) return toast("El valor recibido no cubre el total.", true);
  const id = state.currentSaleId || (state.currentSaleId = uid()); // el id se conserva si hay que reintentar
  let registered = false;
  busy(true);
  try {
    if (status === "cerrada") { // el stock se valida contra el servicio, solo al cerrar (las ventas abiertas no lo modifican)
      state.productos = (await api.list("productos")).map((record) => normalize("productos", record));
      for (const line of state.lines) {
        const item = product(line.productoId);
        if (!stockDone[id]?.has(line.productoId) && item?.seguimientoInventario && line.cantidad > item.stock) { renderAll(); return toast(`Stock insuficiente para ${line.nombre}: disponible ${item.stock}.`, true); }
      }
    }
    const existing = state.ventas.find((item) => item.id === id), now = new Date().toISOString();
    const sale = { id, fecha: status === "cerrada" ? now : (existing?.fecha || now), estado: status, clienteId: clientId, metodoPago: status === "abierta" ? "" : method, subtotal: amount, total: amount, valorRecibido: method === "Efectivo" && status === "cerrada" ? received : 0, cambio: method === "Efectivo" && status === "cerrada" ? received - amount : 0, itemsJson: state.lines.map((line) => ({ ...line })), actualizadoEn: now };
    await upsert("ventas", sale, Boolean(existing));
    registered = true;
    const normalized = normalize("ventas", sale), at = state.ventas.findIndex((item) => item.id === id);
    if (at >= 0) state.ventas[at] = normalized; else state.ventas.unshift(normalized);
    if (status === "cerrada") await applyInventory(id, state.lines, (item, line) => (item.seguimientoInventario ? { ...item, stock: item.stock - line.cantidad } : null));
    state.selectedSale = normalized; state.lines = []; state.currentSaleId = null; $("#receivedAmount").value = ""; $("#saleCustomer").value = ""; renderAll();
    if (status === "cerrada") { renderReceipt(normalized); changeView("receipt"); toast("Venta cerrada y registrada."); } else toast("Venta guardada. Puedes retomarla cuando quieras.");
  } catch (error) {
    renderAll();
    toast(registered ? `La venta quedó registrada, pero falló la actualización del stock (${error.message}). Pulsa «Cerrar venta» otra vez para completarla.` : error.message, true);
  } finally { busy(false); }
}
function resumeSale(id) {
  const sale = state.ventas.find((item) => item.id === id && item.estado === "abierta"); if (!sale) return;
  state.currentSaleId = sale.id; state.lines = linesJson(sale.itemsJson).map((line) => ({ productoId: line.productoId, nombre: line.nombre, precio: Number(line.precio), costo: Number(line.costo), cantidad: Number(line.cantidad) }));
  $("#saleCustomer").value = sale.clienteId || ""; renderCart(); changeView("sale"); toast("Venta abierta retomada.");
}
function renderReceipt(sale) {
  const customer = state.clientes.find((item) => item.id === sale.clienteId)?.nombre;
  $("#receiptContent").innerHTML = `<div class="receipt-heading"><div><h3>Papelería Papel y Luna</h3><p>Gracias por tu compra.</p></div><p><strong>Factura de venta</strong><br>No. ${esc(sale.id)}<br>${new Date(sale.fecha).toLocaleString("es-CO")}</p></div><div class="receipt-meta"><span><strong>Cliente:</strong> ${esc(customer || "Venta sin cliente")}</span><span><strong>Método de pago:</strong> ${esc(sale.metodoPago || "—")}</span></div><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead><tbody>${linesJson(sale.itemsJson).map((line) => `<tr><td>${esc(line.nombre)}</td><td>${line.cantidad}</td><td>${cash(line.precio)}</td><td>${cash(line.precio * line.cantidad)}</td></tr>`).join("")}</tbody></table><div class="receipt-total"><span>Total</span><strong>${cash(sale.total)}</strong></div>${sale.metodoPago === "Efectivo" ? `<p class="receipt-payment">Recibido: ${cash(sale.valorRecibido)} · Cambio: ${cash(sale.cambio)}</p>` : ""}<p class="receipt-thanks">¡Gracias por elegir Papel y Luna!<br>Esperamos verte pronto.</p>`;
}
function printReceipt() {
  document.body.classList.add("printing-receipt");
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-receipt"), { once: true });
  window.print();
}

$("#searchInput").addEventListener("input", renderCatalog);
$("#catalogGrid").addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]"), edit = event.target.closest("[data-hot-edit]");
  if (add) addLine(add.dataset.add, Math.max(1, Number($(`[data-quantity="${CSS.escape(add.dataset.add)}"]`).value) || 1));
  if (edit) { const item = product(edit.dataset.hotEdit); const name = window.prompt("Nombre del producto", item.nombre); if (name === null || !name.trim()) return; const category = window.prompt(`Categoría (${state.categorias.map((entry) => entry.nombre).join(", ")})`, categoryName(item.categoriaId)); if (category === null) return; const categoryRecord = state.categorias.find((entry) => entry.nombre.toLocaleLowerCase() === category.trim().toLocaleLowerCase()); if (category.trim() && !categoryRecord) return toast("Selecciona el nombre de una categoría existente.", true); const price = Number(window.prompt("Precio de venta", item.precio)); const cost = Number(window.prompt("Costo de compra", item.costo)); if (![price, cost].every((value) => Number.isFinite(value) && value >= 0)) return toast("Precio o costo no válido.", true); const changed = { ...item, nombre: name.trim(), categoriaId: categoryRecord?.id || "", precio: price, costo: cost }; save("productos", changed, true).then(() => { state.lines.filter((line) => line.productoId === item.id).forEach((line) => { line.nombre = changed.nombre; line.precio = changed.precio; line.costo = changed.costo; }); renderCart(); }).catch(() => {}); }
});
$("#invoiceContent").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-line]"); if (button) { state.lines = state.lines.filter((line) => line.productoId !== button.dataset.removeLine); renderCart(); } });
$("#invoiceContent").addEventListener("change", (event) => { const id = event.target.dataset.line; if (!id) return; const line = state.lines.find((item) => item.productoId === id), item = product(id), quantity = Number(event.target.value); if (!line || !Number.isInteger(quantity) || quantity < 1 || (item?.seguimientoInventario && quantity > item.stock)) return toast("Cantidad no válida o superior al stock.", true); line.cantidad = quantity; renderCart(); });
$("#paymentMethod").addEventListener("change", updateChange); $("#receivedAmount").addEventListener("input", updateChange);
$("#saveOpenSale").addEventListener("click", () => persistSale("abierta")); $("#paymentForm").addEventListener("submit", (event) => { event.preventDefault(); persistSale("cerrada"); });
$("#openSalesSelect").addEventListener("change", (event) => resumeSale(event.target.value));
$("#newSaleButton").addEventListener("click", () => { if (state.lines.length && !window.confirm("¿Descartar los cambios del carrito actual?")) return; state.lines = []; state.currentSaleId = null; $("#receivedAmount").value = ""; $("#saleCustomer").value = ""; renderCart(); });
$("#newProductButton").addEventListener("click", () => { $("#productFormContainer").innerHTML = productForm(); fillRelations(); });
$("#productFormContainer").addEventListener("click", (event) => { if (event.target.closest("[data-cancel-form]")) $("#productFormContainer").innerHTML = ""; });
$("#productFormContainer").addEventListener("submit", async (event) => {
  if (event.target.id !== "productForm") return; event.preventDefault(); const form = event.target, data = new FormData(form), id = form.dataset.id;
  const item = { id: id || uid(), nombre: data.get("nombre").trim(), categoriaId: data.get("categoriaId") || "", precio: Number(data.get("precio")), costo: Number(data.get("costo")), codigo: data.get("codigo").trim(), seguimientoInventario: data.get("seguimientoInventario") === "on", stock: Number(data.get("stock")) };
  if (!item.nombre || !item.codigo || [item.precio, item.costo, item.stock].some((value) => !Number.isFinite(value) || value < 0)) return toast("Verifica los campos y los valores no negativos.", true);
  if (state.productos.some((old) => old.codigo.toLowerCase() === item.codigo.toLowerCase() && old.id !== id)) return toast("El código interno ya está registrado.", true);
  try { await save("productos", item, Boolean(id)); $("#productFormContainer").innerHTML = ""; } catch {}
});
$("#productsTableBody").addEventListener("click", (event) => { const edit = event.target.closest("[data-edit-product]"), del = event.target.closest("[data-delete-product]"); if (edit) { $("#productFormContainer").innerHTML = productForm(product(edit.dataset.editProduct)); fillRelations(); window.scrollTo({ top: 0, behavior: "smooth" }); } if (del) removeRecord("productos", product(del.dataset.deleteProduct)); });
$("#entityResource").addEventListener("change", renderEntityList); $("#entitySearch").addEventListener("input", renderEntityList);
$("#newEntityButton").addEventListener("click", () => { $("#entityFormContainer").innerHTML = entityForm($("#entityResource").value); });
$("#entityFormContainer").addEventListener("click", (event) => { if (event.target.closest("[data-cancel-form]")) $("#entityFormContainer").innerHTML = ""; });
$("#entityFormContainer").addEventListener("submit", async (event) => { if (event.target.id !== "entityForm") return; event.preventDefault(); const resource = $("#entityResource").value, form = event.target, data = Object.fromEntries(new FormData(form)); data.id = form.dataset.id || uid(); try { await save(resource, data, Boolean(form.dataset.id)); $("#entityFormContainer").innerHTML = ""; } catch {} });
$("#entityList").addEventListener("click", (event) => { const resource = $("#entityResource").value, edit = event.target.closest("[data-edit-entity]"), del = event.target.closest("[data-delete-entity]"); if (edit) $("#entityFormContainer").innerHTML = entityForm(resource, state[resource].find((item) => item.id === edit.dataset.editEntity)); if (del) removeRecord(resource, state[resource].find((item) => item.id === del.dataset.deleteEntity)); });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const purchaseTotal = () => state.purchaseLines.reduce((sum, line) => sum + line.costo * line.cantidad, 0);
function renderPurchaseLines() {
  $("#purchaseLines").innerHTML = state.purchaseLines.map((line) => `<article class="invoice-line"><div class="line-detail"><strong>${esc(line.nombre)}</strong><span>${line.cantidad} × ${cash(line.costo)}</span><div class="line-subtotal">${cash(line.cantidad * line.costo)}</div></div><button type="button" class="remove-button" data-remove-purchase-line="${esc(line.productoId)}">×</button></article>`).join("") || '<p class="helper-text">Aún no agregas productos a la compra.</p>';
  $("#purchaseTotal").textContent = cash(purchaseTotal());
}
$("#purchaseProduct").addEventListener("change", syncPurchaseCost);
$("#addPurchaseLine").addEventListener("click", () => {
  const item = product($("#purchaseProduct").value), quantity = Number($("#purchaseQuantity").value), cost = Number($("#purchaseCost").value);
  if (!item || $("#purchaseCost").value === "" || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(cost) || cost < 0) return toast("Selecciona un producto, una cantidad entera y un costo válidos.", true);
  const found = state.purchaseLines.find((line) => line.productoId === item.id);
  if (found) { found.cantidad += quantity; found.costo = cost; } else state.purchaseLines.push({ productoId: item.id, nombre: item.nombre, precio: item.precio, costo: cost, cantidad: quantity });
  $("#purchaseQuantity").value = 1; renderPurchaseLines();
});
$("#purchaseLines").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-purchase-line]"); if (button) { state.purchaseLines = state.purchaseLines.filter((line) => line.productoId !== button.dataset.removePurchaseLine); renderPurchaseLines(); } });
$("#purchaseForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.busy) return;
  const supplierId = $("#purchaseSupplier").value, date = $("#purchaseDate").value;
  if (!supplierId || !date) return toast("Selecciona el proveedor y la fecha de la compra.", true);
  if (!state.purchaseLines.length) return toast("Agrega al menos un producto a la compra.", true);
  const id = state.purchaseId || (state.purchaseId = uid()); let registered = false;
  const purchase = { id, fecha: date === todayStr() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString(), proveedorId: supplierId, total: purchaseTotal(), itemsJson: state.purchaseLines.map((line) => ({ ...line })) };
  busy(true);
  try {
    await upsert("compras", purchase, state.compras.some((item) => item.id === id));
    registered = true;
    const normalized = normalize("compras", purchase), at = state.compras.findIndex((item) => item.id === id);
    if (at >= 0) state.compras[at] = normalized; else state.compras.unshift(normalized);
    // stock solo si hay seguimiento; el costo se actualiza con el de la compra
    await applyInventory(id, state.purchaseLines, (item, line) => ({ ...item, costo: line.costo, stock: item.seguimientoInventario ? item.stock + line.cantidad : item.stock }));
    state.purchaseLines = []; state.purchaseId = null; $("#purchaseCost").value = ""; $("#purchaseDate").value = todayStr(); renderAll(); toast("Compra registrada e inventario actualizado.");
  } catch (error) {
    renderAll();
    toast(registered ? `La compra quedó registrada, pero falló la actualización del inventario (${error.message}). Pulsa «Registrar compra» otra vez para completarla.` : error.message, true);
  } finally { busy(false); }
});
$("#purchaseList").addEventListener("click", (event) => { const button = event.target.closest("[data-purchase-detail]"); if (!button) return; const buy = state.compras.find((item) => item.id === button.dataset.purchaseDetail); const rows = linesJson(buy.itemsJson).map((line) => `${line.nombre}: ${line.cantidad} × ${cash(line.costo)}`).join("\n"); window.alert(`${rows}\nTotal: ${cash(buy.total)}`); });
$("#historyList").addEventListener("click", (event) => { const button = event.target.closest("[data-sale-detail]"); if (!button) return; const sale = state.ventas.find((item) => item.id === button.dataset.saleDetail); if (sale.estado === "abierta") resumeSale(sale.id); else { renderReceipt(sale); changeView("receipt"); } });
$("#printReceiptButton").addEventListener("click", printReceipt);
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
$("#purchaseDate").value = todayStr();
refresh();

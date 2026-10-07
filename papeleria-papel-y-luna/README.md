# Papel y Luna · POS MVP 2

Punto de venta responsive para una papelería, creado con HTML, CSS y JavaScript vanilla. Los datos de productos, ventas, compras, categorías, proveedores y clientes se consultan y guardan en Google Sheets mediante la API de Google Apps Script.

## Configurar y ejecutar

1. Crea y publica el Apps Script siguiendo la guía backend Google Sheets entregada para el proyecto. La hoja debe tener las pestañas y columnas de esa guía.
2. Abre `scripts/api.js` y reemplaza `PEGA_AQUI_TU_URL_DE_APPS_SCRIPT` por la URL de la aplicación web que termina en `/exec`.
3. Ejecuta la carpeta con un servidor estático local (por ejemplo, Live Server) o publícala en GitHub Pages. Los módulos JavaScript y `crypto.randomUUID()` requieren un origen seguro como `localhost` o HTTPS.

## Funciones

- Catálogo dinámico con búsqueda y carrito editable.
- Ventas abiertas guardadas en el servicio, retomables y editables; cierre con métodos Efectivo, Nequi y Debe. Debe requiere cliente y el efectivo calcula el cambio.
- Comprobante imprimible/guardable como PDF e historial de ventas desde el servicio.
- CRUD de productos con categoría relacionada, código, costo, precio y seguimiento de inventario.
- Edición rápida de nombre y precio en el catálogo de ventas.
- Compras con proveedor, producto, cantidad y costo; la compra confirmada suma stock y actualiza el costo para productos con seguimiento.
- CRUD de categorías, proveedores y clientes. Se bloquea localmente la eliminación si hay relaciones conocidas.
- Cargas asíncronas y mensajes de error/sincronización.

## Estructura

- `index.html`: vistas y navegación.
- `styles/main.css`: estilos responsive y de impresión.
- `scripts/api.js`: URL y acceso centralizado mediante `fetch` al contrato de Apps Script.
- `scripts/app.js`: estado de interfaz, validaciones, reglas de venta e inventario y renderizado.

## Consideraciones del MVP 2

La guía entrega lectura y creación. El Apps Script debe tener implementadas las acciones `update` y `delete` que define el contrato antes de usar las operaciones correspondientes. La URL del servicio no se incluyó en los archivos entregados, por lo que debe configurarse en `scripts/api.js` antes de cargar datos. Este MVP no implementa descuentos, reembolsos, corrección de ventas cerradas, autenticación ni roles.

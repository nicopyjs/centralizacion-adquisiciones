# Centralización Adquisiciones

App interna (Next.js 16 + App Router, Tailwind v4) para centralizar el proceso de
adquisiciones. Se despliega en Vercel.

Producción: https://centralizacion-adquisiciones.vercel.app

## Módulos

| Pestaña        | Ruta              | Estado |
| -------------- | ----------------- | ------ |
| Enviar Pedido  | `/enviar-pedido`  | ✅ En uso |

### Enviar Pedido

Formulario para armar un pedido:

1. **Datos del pedido**: `Solicitante` (obligatorio), `Área destino`
   (obligatorio), `Centro de negocio` (obligatorio, se elige de una lista
   **filtrada por el área**), `Fecha de entrega` (mínimo 10 días hábiles; con
   **Pedido urgente** se puede elegir una fecha anterior), `Clasificador 1/2`,
   `Despacho` y `Comentario` (opcionales).
   - El área destino filtra los centros por el prefijo del código: `RCT`
     (Refacciones), `SST` (Servicio Técnico), `INT` (Instalaciones). Al cambiar
     de área se limpia el centro elegido.
2. **Agregar artículos**: se elige **categoría** → **artículo** de esa categoría →
   **cantidad** y se agrega al detalle. Se repite para sumar **varios artículos**
   al mismo pedido; cada línea se puede quitar antes de enviar.
3. **Registrar y abrir correo en Gmail**: escribe una fila por artículo en la
   pestaña `Pedidos` del spreadsheet de artículos (se crea/actualiza con
   encabezados si hace falta), devuelve un folio `PED-<timestamp>` compartido por
   todas las líneas y **además** abre Gmail con el correo ya redactado: **Para**
   `adquisiciones@` y **CC** el correo del área. Si el pedido es urgente, el
   cuerpo lo indica (`*** PEDIDO URGENTE ***` y la fecha de entrega). «Solo abrir Gmail» y
   «Copiar correo» no tocan la planilla.

**Artículos** (spreadsheet `SHEET_ID`, primera pestaña) — columnas usadas:
`A Código`, `B Nombre`, `C Categoría ID`, `D Categoría`, `G Activo`, `I Unidad`.
Solo se muestran los que tienen `Activo = S`.

**Centros de negocio** (spreadsheet `CENTROS_SHEET_ID`, primera pestaña) — columnas:
`C Code`, `D Description`, `E Imputable`, `F Activo`.
Solo se ofrecen los que tienen `Imputable = S` **y** `Activo = S` (~205).

> **Nota sobre los datos:** ~3.800 artículos activos en 69 categorías. 11 artículos
> tienen en la columna `Categoría` el texto literal `(categoría desconocida)`; se
> agrupan bajo ese nombre tal cual. Si se corrigen en el Sheet, la app los reagrupa
> automáticamente (cache de 5 min; centros 30 min).

## Fuente de datos: Google Sheets + cuenta de servicio

La app lee y escribe los spreadsheets mediante una **cuenta de servicio** de Google.

1. En el proyecto de Google Cloud, la cuenta de servicio ya existe:
   `defontana-etl@defontana-centralizacion-datos.iam.gserviceaccount.com`
2. Genera (o reutiliza) una **clave JSON** de esa cuenta de servicio.
3. **Comparte ambos spreadsheets** (artículos y centros de negocio) con ese correo:
   - `Lector` es suficiente para listar artículos y centros.
   - `Editor` es necesario en el spreadsheet de artículos para que el módulo de
     pedidos pueda escribir en la pestaña `Pedidos`.
4. Habilita la **Google Sheets API** en el proyecto de Cloud.

### Variables de entorno

Copia `.env.example` a `.env.local` y completa:

| Variable                        | Descripción |
| ------------------------------- | ----------- |
| `SHEET_ID`                      | ID del spreadsheet de artículos / pedidos. |
| `CENTROS_SHEET_ID`              | ID del spreadsheet de centros de negocio. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`  | Correo de la cuenta de servicio. |
| `GOOGLE_PRIVATE_KEY`            | Campo `private_key` del JSON. Pega el valor entre comillas; los `\n` se convierten en tiempo de ejecución. |

En **Vercel** ya están cargadas en Production + Preview + Development
(*Project → Settings → Environment Variables*).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## API interna

| Método | Ruta             | Descripción |
| ------ | ---------------- | ----------- |
| GET    | `/api/articulos` | `{ categorias: [{ categoria, categoriaId, articulos: [...] }] }`. Cache 5 min. |
| GET    | `/api/centros`   | `{ centros: [{ codigo, descripcion }] }` (Imputable=S y Activo=S). Cache 30 min. |
| POST   | `/api/pedidos`   | Body `{ solicitante, area: { label, email }, centroNegocio: { codigo, descripcion }, fechaEntrega?, urgente?, clasificador1?, clasificador2?, despacho?, comentario?, items: [{ codigo, nombre, categoria, unidad, cantidad }] }`. Escribe una fila por ítem en la pestaña `Pedidos`. |

Pestaña `Pedidos` (20 columnas, A..T):
`Pedido ID · Fecha · Solicitante · Área · Centro de negocio · Centro Código · Fecha entrega · Clasificador 1 · Clasificador 2 · Despacho · Categoría · Código · Artículo · Unidad · Cantidad · Comentario · Cantidad recibida · Consumo interno · Recepcionado por · Urgente`

La columna `Urgente` vale `Sí` en los pedidos urgentes y queda vacía en el resto.

> Si la pestaña `Pedidos` ya existía con menos columnas, la primera escritura
> reescribe la fila de encabezados a las 20 actuales; las filas antiguas quedan
> como estaban (y cuentan como no urgentes).

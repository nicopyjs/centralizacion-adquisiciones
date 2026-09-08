# Centralización Adquisiciones

App interna (Next.js 16 + App Router, Tailwind v4) para centralizar el proceso de
adquisiciones. Se despliega en Vercel.

## Módulos

| Pestaña        | Ruta              | Estado |
| -------------- | ----------------- | ------ |
| Enviar Pedido  | `/enviar-pedido`  | ✅ En uso |

### Enviar Pedido

Formulario para armar un pedido:

1. Se eligen **datos del pedido** (solicitante obligatorio, área/proyecto y comentario opcionales).
2. Se selecciona **categoría** → **artículo** de esa categoría → **cantidad**, y se agrega a la lista.
3. Se pueden agregar varios artículos y quitarlos antes de enviar.
4. Al **Enviar Pedido**, cada línea se agrega a la pestaña `Pedidos` del mismo spreadsheet
   (se crea automáticamente con encabezados si no existe) y se devuelve un folio `PED-<timestamp>`.

Los artículos se leen desde el Google Sheet configurado. Columnas usadas de la hoja de artículos:
`A Código`, `B Nombre`, `C Categoría ID`, `D Categoría`, `G Activo`, `I Unidad`.
Solo se muestran los artículos con `Activo = S`.

> **Nota sobre los datos:** ~3.800 artículos activos en 69 categorías. 11 artículos
> tienen en la columna `Categoría` el texto literal `(categoría desconocida)`; se
> agrupan bajo ese nombre tal cual. Si se corrigen en el Sheet, la app los reagrupa
> automáticamente (cache de 5 min).

## Fuente de datos: Google Sheets + cuenta de servicio

La app lee y escribe el spreadsheet mediante una **cuenta de servicio** de Google.

1. En el proyecto de Google Cloud, la cuenta de servicio ya existe:
   `defontana-etl@defontana-centralizacion-datos.iam.gserviceaccount.com`
2. Genera (o reutiliza) una **clave JSON** de esa cuenta de servicio.
3. **Comparte el spreadsheet** con ese correo:
   - `Lector` es suficiente para listar artículos.
   - `Editor` es necesario para que el módulo de pedidos pueda escribir en la pestaña `Pedidos`.
4. Habilita la **Google Sheets API** en el proyecto de Cloud.

### Variables de entorno

Copia `.env.example` a `.env.local` y completa:

| Variable                        | Descripción |
| ------------------------------- | ----------- |
| `SHEET_ID`                      | ID del spreadsheet (ya viene con el valor actual). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`  | Correo de la cuenta de servicio. |
| `GOOGLE_PRIVATE_KEY`            | Campo `private_key` del JSON. Pega el valor entre comillas; los `\n` se convierten en tiempo de ejecución. |

En **Vercel**: agrega las tres variables en *Project → Settings → Environment Variables*
(para `GOOGLE_PRIVATE_KEY` pega el valor multilínea tal cual del JSON o con `\n` escapados).

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
| GET    | `/api/articulos` | Devuelve `{ categorias: [{ categoria, categoriaId, articulos: [...] }] }`. Cache 5 min. |
| POST   | `/api/pedidos`   | Body `{ solicitante, area?, comentario?, items: [{ codigo, nombre, categoria, unidad, cantidad }] }`. Escribe en la pestaña `Pedidos`. |

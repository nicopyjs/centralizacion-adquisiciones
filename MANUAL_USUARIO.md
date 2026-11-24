# Manual de Uso — Centralización de Adquisiciones NEB Chile

Este manual explica cómo usar el sistema según tu rol: **maestro / bodega / supervisor** (quienes solicitan materiales) o **adquisiciones** (quienes compran, reciben y entregan).

---

## Índice

1. [¿Qué es este sistema?](#1-qué-es-este-sistema)
2. [El recorrido completo de un pedido](#2-el-recorrido-completo-de-un-pedido)
3. [Para solicitantes: cómo hacer un pedido](#3-para-solicitantes-cómo-hacer-un-pedido)
4. [Para supervisores: aprobar pedidos de maestros](#4-para-supervisores-aprobar-pedidos-de-maestros)
5. [Para Adquisiciones: gestionar los pedidos](#5-para-adquisiciones-gestionar-los-pedidos)
6. [Crear una OC desde un pedido](#6-crear-una-oc-desde-un-pedido)
7. [Asociar una OC que ya existe](#7-asociar-una-oc-que-ya-existe)
8. [Recibir el material y registrar el gasto](#8-recibir-el-material-y-registrar-el-gasto)
9. [Cerrar, anular y reabrir](#9-cerrar-anular-y-reabrir)
10. [Preguntas frecuentes](#10-preguntas-frecuentes)

---

## 1. ¿Qué es este sistema?

Es una página web para pedir materiales y repuestos a Adquisiciones, y para que Adquisiciones los compre en Defontana (órdenes de compra), controle qué llegó, a quién se le entregó y a qué centro de negocio se imputó el gasto.

Secciones de la barra de arriba:

| Sección | Para quién | Qué hace |
|---|---|---|
| **Enviar Pedido** | Maestros, bodega, supervisores | Formulario para pedir cualquier material del catálogo |
| **Materiales Menores** | Maestros, bodega, supervisores | El mismo formulario con una lista acotada de categorías comunes (insumos, fijaciones, EPP, herramientas, eléctrico de tablero) |
| **Pedidos del Área** | Supervisores | Aprobar los pedidos de maestros y seguir los pedidos del área |
| **Gestión de Pedidos** | Adquisiciones | Panel de trabajo: compra (OC), recepción, consumo, entrega |
| **KPIs** | Adquisiciones | Indicadores de desempeño |

**"Enviar Pedido" y "Materiales Menores" no piden inicio de sesión.** Las secciones de gestión, KPIs y Pedidos del Área piden **entrar con Google usando tu cuenta @nebchile.cl** (ya no hay una contraseña compartida).

---

## 2. El recorrido completo de un pedido

```
Solicitante            Supervisor            Adquisiciones                        Defontana
───────────            ──────────            ─────────────                        ─────────
1. Envía el pedido ──► 2. Aprueba            3. Crea o asocia la OC  ───────────► OC (hay que aprobarla allá)
   (maestros)             (si lo hizo un        con los artículos
                           maestro)          4. Recepciona cuando llega ────────► Parte de entrada
                                             5. Registra el consumo interno ────► Gasto al centro de negocio
                                             6. Entrega al solicitante
                                             7. Pedido «Completo» (o lo cierra)
```

- Si el pedido lo hace una persona con cuenta **@nebchile.cl**, pasa directo a Adquisiciones. Si lo hace un **maestro** (sin cuenta @nebchile.cl), primero lo aprueba un supervisor del área.
- Un pedido puede tener **varias OC** (por ejemplo, una por proveedor). Una OC solo puede pertenecer a **un** pedido.
- Cada pedido tiene un **chat** entre el solicitante y Adquisiciones, para aclarar dudas sin salir del sistema.

---

## 3. Para solicitantes: cómo hacer un pedido

### 3.1 ¿"Enviar Pedido" o "Materiales Menores"?

- Algo de uso común y rápido (insumos, fijaciones, EPP, herramientas, material eléctrico de tablero) → **Materiales Menores**.
- Cualquier otro artículo del catálogo → **Enviar Pedido**.

El formulario es idéntico en ambas.

### 3.2 Paso 1: Datos del pedido

1. **Solicitante**: escribe tu nombre (el sistema sugiere nombres ya usados, pero puedes escribirlo completo a mano). *(Obligatorio)*
2. **Fecha de entrega**: el sistema propone 10 días hábiles desde hoy. Puedes elegir una posterior. Para una anterior, marca **Pedido urgente** (el correo avisará "PEDIDO URGENTE" y Adquisiciones lo prioriza).
3. **Área destino**: **Refacciones**, **Servicio Técnico**, **Instalaciones** o **Transición y Postventa**. *(Obligatorio)* Al cambiar de área se vacía el centro de negocio, porque las opciones cambian.
4. **Centro de negocio**: busca y elige el centro de costo de tu área. *(Obligatorio)*
5. **Clasificador 1 / Clasificador 2**: el motivo y el tipo de instalación del gasto (por ejemplo "06 RCT - Refacciones de Central Térmica" y "01 SDC - Sala de Calderas"). *(Obligatorios)*
6. **Despacho** (opcional): Retira Logística NEB, Retira Solicitante, Despacho Proveedor o Stock en Bodega.
7. **Comentario** (opcional): cualquier observación para Adquisiciones.

### 3.3 Paso 2: Artículos

1. Presiona **"Agregar artículo"**.
2. Busca el artículo por nombre (el campo **Categoría** es opcional, solo ayuda a acotar). Al elegirlo, la categoría se completa sola.
3. Escribe la **Cantidad**.
4. Si el artículo **no está en la lista**, usa **"¿No está en la lista? Escribirlo a mano"** y escribe su nombre y unidad. Queda marcado como *manual*: Adquisiciones lo revisa y, al comprarlo, lo crea en Defontana (ver sección 6.4).
5. Repite para cada artículo. El basurero elimina una fila.

Arriba verás un resumen de lo que falta completar y, si quieres, una **Vista previa del correo**.

### 3.4 Confirmar y enviar

1. Presiona **"Registrar y abrir correo en Gmail"** (queda gris mientras falte algo obligatorio).
2. Revisa el resumen en la ventana de confirmación. **Una vez confirmado el pedido no se puede editar.**
3. Presiona **"Sí, enviar"** (o **"No, volver a editar"**).

### 3.5 Qué pasa después

- El pedido queda registrado con un **folio por área**: `RCT-62`, `SST-32`, `INT-15`, `TYP-4`…
- Se abre Gmail con el correo ya redactado para Adquisiciones (con copia al área). **Debes presionar "Enviar" en Gmail tú mismo**: el sistema solo lo prepara. Si Gmail no se abre solo, usa el botón **"Abrir Gmail"**.
- El formulario se vacía (conservando tu nombre y el área) para no duplicar el pedido.
- Si el registro falla, igual se abre el correo y se te avisa: en ese caso avisa a Adquisiciones.
- Si tu pedido necesita aprobación, queda **pendiente** hasta que un supervisor lo apruebe (sección 4).

---

## 4. Para supervisores: aprobar pedidos de maestros

Cuando un maestro envía un pedido, le llega un aviso por correo al grupo del área y el pedido aparece en **Pedidos del Área**, como pendiente de aprobación. **Adquisiciones no lo ve hasta que se aprueba.**

Para cada pedido pendiente puedes:

- **Aprobar**: pasa a Adquisiciones tal como está.
- **Aprobar con cambios**: antes de aprobar, corrige las cantidades o quita artículos que no corresponden.
- **Rechazar**: debes escribir un motivo. El pedido queda como *Rechazado* (puedes reconsiderarlo después).

En la misma sección ves el avance de los pedidos ya aprobados de tu área.

---

## 5. Para Adquisiciones: gestionar los pedidos

### 5.1 Ingresar

1. Entra a **Gestión de Pedidos**.
2. Presiona **"Entrar con Google (cuenta @nebchile.cl)"**.
3. Para salir, usa **"Cerrar sesión"**. Si la sesión vence mientras trabajas, la página te pedirá entrar de nuevo: guarda tus cambios seguido.

### 5.2 Vista general

Arriba hay tarjetas que filtran con un clic: **Todos**, **Urgentes**, **Pendientes**, **Parciales**, **Completos**, además de **Por atender** (la vista por defecto). El indicador **"Entregas a tiempo"** mide el porcentaje de pedidos completos entregados dentro del plazo comprometido (amarillo bajo 80 %, verde desde 80 %).

### 5.3 Buscar y filtrar

- **Buscador**: folio, solicitante, área, centro de negocio, nombre o código de artículo (sin importar mayúsculas ni tildes).
- **Filtros**: Solicitante, Área, Centro de negocio, Despacho y rango de fechas "Pedido desde / hasta".
- **Actualizar** recarga la lista; **Limpiar filtros** borra todos los filtros.
- Los urgentes y pendientes aparecen primero; el resto, del más reciente al más antiguo.

### 5.4 El detalle de un pedido

Al abrir un pedido ves los datos generales (solicitante, fechas, área, centro, clasificadores, despacho, comentario), el **chat** con el solicitante y la tabla de artículos.

Por cada artículo puedes editar:

| Campo | Qué registrar |
|---|---|
| **Recibido** | Cantidad que llegó (botón "Todo" para la cantidad completa) |
| **Llegó a bodega** | Fecha en que llegó a la bodega de Adquisiciones |
| **Recepcionado por** | Quién lo recibió |
| **Entregado al solicitante** | Fecha de entrega física |
| **Consumo interno** | Referencia del consumo registrado |
| **OC** | La OC de Defontana asociada ("En gestión" si aún no tiene) |

Los campos de fecha se sugieren con la de hoy la primera vez, pero **nada se guarda solo**: presiona **Guardar** en la fila o **Guardar cambios** arriba. **Marcar todo recibido** completa las cantidades pendientes (hay que guardar igual). Si cierras la pestaña con cambios sin guardar, el navegador te avisa.

### 5.5 Corregir un pedido

Desde el detalle puedes editar cantidades, agregar o quitar artículos y cambiar datos del pedido. Si el área del pedido estaba mal, **cambiarla** actualiza también el folio (por ejemplo `RCT-62` pasa a `SST-32`) y lo siguen el chat, los archivos y las etiquetas. Quienes son de Servicio Técnico solo pueden elegir las áreas que les corresponden.

Para un artículo que ya no se necesita, **Anular artículo** (queda en la planilla, marcado y con su motivo; no cuenta para el avance del pedido).

---

## 6. Crear una OC desde un pedido

Sirve para comprar en Defontana todo el pedido o solo parte de él. Un pedido puede tener **varias OC**, así que se crean por grupos de artículos (típicamente, uno por proveedor).

### 6.1 Paso a paso

1. En el detalle del pedido, **marca con la casilla** los artículos que irán en la OC.
2. Presiona **Crear OC (n)**.
3. **Proveedor**: escribe el nombre, o el RUT completo (con puntos y guion), y elígelo de la lista. Solo aparecen proveedores activos en Defontana. Si es nuevo, créalo antes en Defontana.
4. **Condición de pago**: se propone la que el proveedor tiene en Defontana (por ejemplo `CONTADO`), pero puedes elegir otra de la lista.
5. **Fecha de recepción**: parte con la fecha de entrega del pedido; ajústala si hace falta.
6. **Precio neto unitario** de cada artículo. Los pedidos no traen precio, se escribe aquí. Si la compra es exenta, marca **Exenta de IVA**. Abajo ves neto, IVA y total.
7. Presiona **Crear OC en Defontana**.

La OC reutiliza del pedido: el **centro de negocio**, las **cantidades** y el **código del pedido** (el folio, que queda en el campo «Código Pedido» de la OC). Los artículos quedan asociados a la OC automáticamente.

### 6.2 Después de crearla

- La OC queda en estado **«Ingresado»**: **hay que aprobarla en Defontana** como siempre. Mientras no esté aprobada, no se puede recepcionar.
- **Clasificador 1 y Clasificador 2**: Defontana no permite enviarlos desde el sistema. Si el diálogo avisa que se omitieron, **complétalos a mano en la OC** (el aviso te recuerda los del pedido).
- Para el resto de los artículos del pedido, repite el proceso con otro proveedor.

### 6.3 Avisos y errores frecuentes

- **"Defontana en modo PRUEBAS"**: la OC no se crea en el Defontana real. Si ves este aviso en el uso diario, avisa a soporte.
- **«X» ya está en la OC N°**: ese artículo ya tiene OC. Si necesitas cambiarla, usa **Asociar OC → Quitar OC** primero.
- **El pedido está cerrado o anulado**: reábrelo primero.
- Si la OC se creó en Defontana pero no se pudo asociar al pedido, el mensaje indica el N° de OC: asóciala con **Asociar OC**.

### 6.4 Artículos manuales (que no están en el catálogo)

Si entre los artículos marcados hay uno escrito a mano por el solicitante, el diálogo muestra para ese artículo un recuadro **"Artículo manual"** con dos datos obligatorios:

- **Categoría**: la categoría correcta de Defontana (por ejemplo "FITTING COBRE" o "INSUMOS GENÉRICO"). Define el prefijo del código y la cuenta de gasto, así que elígela con cuidado.
- **Unidad**: parte con la que escribió el solicitante si existe en Defontana; si no, "UNIDAD". Puedes cambiarla.

Al crear la OC, el sistema **crea primero el artículo en Defontana** con el siguiente código libre de su categoría (por ejemplo `ITGN0366`: 4 letras de la categoría + correlativo), con el nombre en mayúsculas, y luego la OC con ese código. El pedido queda actualizado con el código y la categoría nuevos, y al final el diálogo te lista los códigos creados.

Importante:
- El artículo creado **no se puede borrar desde aquí**; si te equivocaste de categoría, corrígela en Defontana (maestro de artículos).
- El catálogo de artículos del formulario del solicitante se actualiza cuando se actualiza su planilla de artículos, no al instante.
- Revisa que el nombre esté bien escrito antes de crear la OC: es el nombre que quedará en el maestro de Defontana.

---

## 7. Asociar una OC que ya existe

Si la OC ya la creaste en Defontana (o te la entregó otra persona):

1. Marca los artículos que están en esa OC.
2. Presiona **Asociar OC (n)**.
3. Busca por proveedor para ver las OC de los últimos 12 meses, o escribe el **número** directamente.
4. Presiona **Asociar OC**.

Reglas:
- Solo se asocian OC en estado **Aprobado** o **Parcialmente Recepcionado**.
- Una OC solo puede estar asociada a **un** pedido.
- Todos los artículos marcados deben estar en la OC.
- Si un artículo ya tiene recepción o consumo registrado, su OC no se puede cambiar.
- **Quitar OC** deja los artículos "En gestión" otra vez.

---

## 8. Recibir el material y registrar el gasto

Cuando llega el material, en el detalle del pedido presiona **Consumo interno** (el botón se habilita cuando hay artículos recibidos y no hay cambios sin guardar). El diálogo pregunta **"¿Qué quieres registrar?"**:

| Opción | Cuándo usarla | Qué hace en Defontana |
|---|---|---|
| **Recepcionar OC + consumo interno** | Lo normal: llegó lo comprado con OC | Recepciona la OC (total o parcial → *parte de entrada*, con el costo de la OC) y enseguida descuenta lo recibido con un *consumo interno* imputado al centro de negocio |
| **Solo recepcionar OC** | Llegó, queda en stock y se consume después | Solo el parte de entrada |
| **Solo consumo interno** | Ya había stock en la bodega | Descuenta stock e imputa el gasto al centro |
| **Parte de entrada (costo directo)** | Material que entra sin OC y se gasta de inmediato | Imputa el gasto directo al centro en **un solo paso**. No se hace consumo interno después (duplicaría el gasto) |

Notas:
- Se pide el **N° de factura** y luego la **OC** de esa factura (de las asociadas al pedido).
- La OC debe estar aprobada para recepcionarla, y el artículo debe estar en ella. Defontana solo recepciona cantidades enteras y no maneja artículos con lotes desde aquí.
- El centro de negocio y los clasificadores salen del pedido.
- Después de recepcionar, el avance del pedido (Pendiente → Parcial → Completo) se calcula con lo recibido y entregado.

---

## 9. Cerrar, anular y reabrir

- **Cerrar pedido**: da por terminado un pedido aunque falte algo (por ejemplo, un artículo que no se comprará). Puedes cerrar varios a la vez.
- **Anular pedido**: para uno enviado por error; pide un motivo.
- **Reabrir**: devuelve un pedido cerrado o anulado a "en curso".
- Mientras un pedido está cerrado o anulado no se pueden crear ni asociar OC.

---

## 10. Preguntas frecuentes

**¿Puedo editar un pedido después de enviarlo?**
Quien lo envía no puede. Adquisiciones sí puede corregirlo desde Gestión de Pedidos. Si necesitas un cambio, usa el chat del pedido o escríbeles.

**¿Qué pasa si no encuentro mi nombre en Solicitante?**
Escríbelo igual a mano.

**¿Y si el artículo no está en el catálogo?**
Usa "Escribirlo a mano". Adquisiciones lo revisará y lo creará en Defontana al comprarlo.

**El correo de Gmail no se abrió solo.**
Usa el botón "Abrir Gmail" que aparece tras confirmar el pedido.

**¿Cómo sé si mi pedido ya llegó?**
Los supervisores lo ven en **Pedidos del Área**. Para los demás, pregunta a Adquisiciones por el chat del pedido o con tu folio.

**No puedo entrar a Gestión de Pedidos.**
Necesitas una cuenta de Google **@nebchile.cl** con acceso. Si te rechaza, pide que revisen tu perfil.

**Creé una OC y no aparece en Defontana como esperaba.**
Revisa el N° que mostró el sistema y busca esa OC en Defontana. Recuerda que queda «Ingresado» hasta que se apruebe, y que Clasificador 1 y 2 se completan a mano.

**Me equivoqué de proveedor o de precio al crear la OC.**
Corrígela directamente en Defontana. Si necesitas rehacerla, anula la OC allá y usa **Asociar OC → Quitar OC** para liberar los artículos.

---

*Última actualización: 24 de noviembre de 2026.*

# VII. Beneficios Esperados (v3.0)

> Esta sección corresponde a «VII. Beneficios Esperados» de `NPIC-QC-Proposal-ES-Phase2-v3.0`.

## Tabla resumen

| Beneficio | Impacto |
|---|---|
| Eliminar los reportes diarios manuales en Excel | ~2 horas/día de captura ahorradas por cada supervisor; visibilidad de producción en tiempo real |
| Datos en tiempo real a nivel de carro | Se genera un registro exacto y con marca de tiempo en cuanto se completa cada carro, sin capturas posteriores |
| Seguimiento del uso de materia prima por orden de trabajo | El consumo real se atribuye con exactitud por orden de trabajo; se elimina la distorsión por mezcla de material entre órdenes |
| Seguimiento exacto de cantidad y tiempos por carro | Carros reales = carros registrados; se elimina el subreporte; 100% de exactitud en el registro de producción |
| Registro del tiempo de espera tras la producción | Los datos de tiempo de espera acumulados sirven de base para optimizar el proceso a futuro |
| Sin captura manual de estación y horas de trabajo | La estación y las horas se capturan automáticamente, reemplazando la captura manual en papel/Excel |
| Productividad del empleado por carro | Se calcula de forma automática y exacta por empleado × carro; más detallado, objetivo y en tiempo real |
| Seguimiento de producción en tiempo real por orden de trabajo | El avance de cada orden es visible en tiempo real, apoyando un monitoreo y una planeación más precisos |
| Sin llenado manual de registros y reportes por carro | Los operadores de línea ya no llenan manualmente los registros y reportes de cada carro |

## Explicaciones detalladas

**7.1 Eliminar los reportes diarios manuales en Excel**
Hoy, cada supervisor consolida manualmente en Excel la producción del turno y elabora un reporte diario. Con el sistema en operación, el reporte se genera automáticamente a partir de la captura en tiempo real en piso, sin captura manual. A razón de aproximadamente **2 horas/día** por supervisor, con **10 supervisores × 22 días hábiles**, se ahorran cerca de **440 horas-hombre/mes (≈2.5 FTE)**; el reporte diario pasa de «disponible al día siguiente» a «disponible en tiempo real».

**7.2 Datos en tiempo real a nivel de carro**
Cada carro genera un registro con marca de tiempo en cuanto se completa, sin reconstrucción posterior de memoria. La captura posterior se aproxima a **0**; la **trazabilidad por carro alcanza el 100%**, con marcas de tiempo con precisión al minuto.

**7.3 Seguimiento del uso de materia prima por orden de trabajo**
La entrega y el consumo reales se registran **por cada orden de trabajo**. Problema actual: con frecuencia el material de una orden se usa en otra, por lo que el consumo real no puede atribuirse con exactitud. Al vincular el material a la orden de trabajo se elimina la distorsión causada por la **mezcla de material entre órdenes**, permitiendo calcular con exactitud el **consumo real / rendimiento (yield)** de cada orden, lo que respalda el costeo y la detección de sobreconsumo. 〔Si se proporciona una línea base (porcentaje de órdenes afectadas por la mezcla, o desviación de consumo), puede darse una cifra exacta.〕

**7.4 Seguimiento exacto de cantidad y tiempos por carro**
La cantidad real producida de cada carro y sus marcas de tiempo de inicio/fin se capturan en tiempo real. Problema actual: los empleados pueden **omitir o subreportar carros deliberadamente**, por lo que la cantidad realmente producida no coincide con la registrada. Con el conteo en tiempo real ambas coinciden. **Carros reales = carros registrados**, el subreporte baja a cero, la exactitud del registro de producción sube al 100% y puede derivarse un **tiempo takt promedio (minutos/carro)** para estimar capacidad y programar. 〔Si se cuenta con la tasa actual de subreporte, puede cuantificarse la «producción real recuperada».〕

**7.5 Registro del tiempo de espera tras la producción**
Se registra el **tiempo de espera después de que cada carro termina su producción** (por ejemplo, la espera para pasar a la siguiente etapa / al cuarto de secado), acumulando datos que sirven de base para la **optimización del proceso y la mejora de la eficiencia a futuro**. El **tiempo de espera promedio (minutos/carro)** puede medirse y usarse como línea base cuantificada y métrica de seguimiento para la mejora.

**7.6 Sin captura manual de estación y horas de trabajo**
La asignación de estación y las horas de trabajo las captura el sistema, reemplazando la captura manual en papel/Excel. El ahorro de horas de este punto **ya está incluido en el ahorro del reporte diario de 7.1 y no se contabiliza dos veces**; el valor está en la mayor integridad y exactitud de los datos de horas/estación (eliminando faltantes y errores de captura).

**7.7 Productividad del empleado por carro**
La productividad se calcula de forma automática y exacta por **empleado × carro** (carros/turno, piezas/hora-hombre); más detallada, objetiva y en tiempo real que el método actual. La granularidad de los datos llega a «persona × carro»; puede compararse la **dispersión de productividad** entre equipos/individuos, apoyando la evaluación de desempeño y las decisiones de asignación de personal. 〔Ya existe una línea base objetiva; este punto hace los datos «más exactos y más detallados», no algo creado desde cero.〕

**7.8 Seguimiento de producción en tiempo real por orden de trabajo**
Se sigue en tiempo real el avance/estado de producción de **cada orden de trabajo**, de modo que los directores de planeación y de producción puedan **monitorear y planear con mayor precisión** con base en el desempeño real (programación, capacidad, fechas de entrega). El avance de la orden es visible en tiempo real (100% de cobertura), pasando de una «consolidación posterior» a un «control en tiempo real», lo que respalda decisiones de programación y capacidad más precisas.

**7.9 Sin llenado manual de registros y reportes por carro (operadores de línea)**
Hoy, los operadores de línea deben llenar manualmente el registro de producción y los reportes estadísticos de cada carro; con el sistema en operación, los datos se capturan en tiempo real en piso y los operadores ya no llenan nada manualmente. A razón de **1 minuto/carro × 6 carros/turno × 3 turnos/día × 40 líneas de producción = 720 minutos/día (12 horas-hombre/día)**, con **22 días hábiles**, se ahorran cerca de **264 horas-hombre/mes (≈1.5 FTE)**.

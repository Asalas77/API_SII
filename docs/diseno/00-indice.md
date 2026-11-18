# Documentación de ingeniería de diseño — API SII

Conjunto de documentos para entender el proyecto: qué resuelve, cómo está construido, por qué se tomaron sus
decisiones y qué falta. Todos reflejan el código del repositorio; lo que aún no existe está marcado como
**Planificado**.

## Orden de lectura sugerido

| # | Documento | Para quién | Contenido |
|---|---|---|---|
| 01 | [Visión y alcance](01-vision-y-alcance.md) | Todos | Problema, objetivos, actores, alcance actual y futuro, restricciones normativas |
| 02 | [Requisitos](02-requisitos.md) | Producto, QA | Requisitos funcionales y no funcionales con su estado de implementación |
| 03 | [Arquitectura](03-arquitectura.md) | Desarrollo, arquitectura | Modelo C4 (contexto, contenedores, componentes), estilo arquitectónico, despliegue |
| 04 | [Modelo de datos](04-modelo-de-datos.md) | Desarrollo, DBA | Diagrama ER, diccionario de datos, máquinas de estado de documento y envío |
| 05 | [Flujos](05-flujos.md) | Desarrollo | Secuencias: CAF, folios, construcción y firma de DTE, autenticación y envío al SII |
| 06 | [Diseño de dte-core](06-diseno-dte-core.md) | Desarrollo | Núcleo de dominio: CAF, TED, firma, XSD, constructores, reglas de negocio |
| 07 | [Diseño de sii-gateway](07-diseno-sii-gateway.md) | Desarrollo | Clientes REST y SOAP del SII, tokens, reintentos, errores, estados |
| 08 | [Seguridad](08-seguridad.md) | Seguridad, desarrollo | Activos, amenazas, controles implementados y planificados |
| 09 | [API REST](09-api-rest.md) | Integradores | Endpoints actuales y contrato propuesto de `/v1` |
| 10 | [Estrategia de pruebas](10-estrategia-de-pruebas.md) | QA, desarrollo | Pirámide de pruebas, cobertura por archivo, certificación ante el SII |
| 11 | [Operación y despliegue](11-operacion-y-despliegue.md) | DevOps | Entorno local, variables, migraciones, despliegue, runbook |
| 12 | [Decisiones de arquitectura (ADR)](12-decisiones-adr.md) | Arquitectura | Registro de decisiones con alternativas y consecuencias |
| 13 | [Glosario](13-glosario.md) | Todos | Términos del SII y del proyecto, tipos de documento |
| 14 | [Integración SAP Business One](14-integracion-sap-b1.md) | Integradores B1 | Diseño del worker Service Layer y del add-on UI API |
| 15 | [Estado y roadmap](15-estado-y-roadmap.md) | Dirección, producto | Qué está hecho, brechas, riesgos y fases siguientes |

## Documentos relacionados

- [Investigación y opciones de arquitectura](../01-opciones-arquitectura-y-pruebas.md): estudio inicial de la
  normativa del SII, opciones de stack y recomendación.
- [Referencias oficiales del SII](../referencias-sii/README.md): instructivos, resoluciones, XSD y OpenAPI descargados.
- READMEs técnicos por módulo: `apps/api/src/dte-core/README.md`, `apps/api/src/sii-gateway/README.md`,
  `apps/api/src/database/README.md`.

## Convenciones de la documentación

- Idioma español; nombres de código tal como aparecen en el repositorio.
- Diagramas en Mermaid, renderizables en GitHub, GitLab y VS Code.
- Estados de cada capacidad: **Implementado**, **Parcial** o **Planificado**.
- Cuando cambie el código o la normativa, actualizar el documento afectado y el [estado y roadmap](15-estado-y-roadmap.md).

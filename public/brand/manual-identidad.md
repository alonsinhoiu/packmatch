# PackMatch · Identidad visual 02

Fecha: 2 de noviembre de 2026.

## Fundamento

Promesa: ayudar a detectar diferencias entre factura y lista de empaque con evidencia documental antes del despacho.
Público: operadores logísticos y equipos de comercio exterior que revisan documentos y cantidades.
La marca debe evitar ser estridente, ornamental o triunfalista. La confianza se expresa mediante orden y legibilidad, sin sugerir que cada embarque está aprobado.

## Símbolo

Dos documentos desfasados se alinean mediante dos barras iguales. La geometría representa la comparación y la coincidencia de información. La silueta funciona con una sola tinta. El ícono de aplicación agrega una base azul tinta de esquinas redondeadas.

Retícula: 64 × 64; trazos de 4 unidades. Sin degradados, sombras, destellos ni animaciones.

## Variantes

- Horizontal: para cabeceras y reportes.
- Vertical: para portadas y composiciones centradas.
- Símbolo: para espacios reducidos.
- Ícono con base: para app, avatar y favicon.
- Versiones `light` para fondo claro y `dark` para fondo azul tinta.
- Versiones `mono` azul tinta y `white` blanco para impresión y una sola tinta.
- PNG a 16, 32, 180, 192 y 512 px. El archivo de 180 px sirve como Apple touch icon.

Los SVG tienen fondo transparente salvo el ícono con base. Los logotipos conservan texto editable en Arial Bold; si se llevan a imprenta, convertir el texto a curvas en el programa de diseño para fijar la apariencia entre equipos.

## Paleta y contraste

Azul tinta `#172E3B`: marca y estructura. Verde petróleo `#356F65`: acento sobre claro. Salvia `#86B6AC`: acento sobre azul tinta. Papel `#F7F8F6`: superficie de lectura. Blanco `#FFFFFF`: documentos.

Ratios calculados con luminancia relativa sRGB, redondeados a dos decimales. Las combinaciones siguientes superan 4.5:1 para texto normal:

| Primer plano | Fondo | Contraste |
| --- | --- | --- |
| `#172E3B` | `#FFFFFF` | 14.09:1 |
| `#172E3B` | `#F7F8F6` | 13.23:1 |
| `#356F65` | `#FFFFFF` | 5.81:1 |
| `#356F65` | `#F7F8F6` | 5.46:1 |
| `#86B6AC` | `#172E3B` | 6.24:1 |

Salvia sobre blanco no se utiliza para texto. Los estados funcionales (discrepancia, advertencia y coincidencia) conservan sus propios colores, textos e íconos; la paleta de marca no sustituye su significado.

## Tipografía

Logotipo: Arial Bold, con espaciado compacto definido dentro del SVG. No recomponer el logotipo a mano.
Interfaz y titulares: tipografía del sistema, peso 400 para lectura y 600–700 para jerarquía. Códigos: monoespaciada del sistema. Mantener números tabulares en tablas y cantidades. No introducir una familia externa únicamente por variedad.

## Uso

Espacio libre mínimo: 8 unidades en la retícula de 64, equivalente a 1/8 de la altura del símbolo, por cada lado. Tamaños mínimos digitales: símbolo 16 px de alto; horizontal 132 px de ancho; vertical 120 px de ancho. Para impresión: símbolo 6 mm de alto, horizontal 35 mm de ancho. Preferir el tamaño superior cuando la reproducción sea de baja calidad.

No estirar, rotar, cambiar colores fuera de las variantes, incorporar efectos o alterar las barras. No colocar sobre fotografías con ruido: usar una superficie lisa. Para ilustraciones y fotografías de apoyo, preferir documentos reales y escenas operativas ordenadas; evitar neón, cubos 3D decorativos o imágenes de IA que parezcan evidencia de un envío real.

## Aplicación

Marca compartida por componentes React, cabecera, minuta imprimible y favicon. La guía y las variantes se mantienen en los archivos del proyecto para uso de desarrollo y diseño. No hay un inspector de marca dentro de la aplicación. Los videos existentes son piezas previas y conservan la identidad con la que se grabaron; no forman parte del kit actualizado.

Archivos: `public/brand/`. Lámina de presentación: `packmatch-identidad.png` y `packmatch-identidad.svg`. Kit completo: `packmatch-identidad-visual.zip`.

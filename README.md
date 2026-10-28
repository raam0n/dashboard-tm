# AOE2 Group Dashboard (TM)

Dashboard web en tiempo real para seguir el ranking, partidas en vivo y estadísticas de un grupo selecto de jugadores de Age of Empires II.

Inspirado en el overlay original de Lucas Jappert, pero rediseñado con código fuente modular y limpio para soportar:
- **Solapa RM 1vs1:** Ranking individual ordenado por Elo 1v1, deltas respecto al anterior, racha y últimas 10 civs jugadas.
- **Solapa RM Team:** Ranking de partidas en equipo ordenado por Elo de Team Game (`rm_team`).
- **Solapa Winrate Semanal:** Partidas de los últimos 7 días, winrate del grupo y jugadores con mayor subida de Elo en la semana.
- **Solapa Top Civs & Mapas:** Estadísticas grupales de civilizaciones más elegidas y mapas más jugados.
- **Banner Live Now:** Detección en vivo de partidas activas (con reloj, civilizaciones, rival y tiempo transcurrido).
- **Gestión dinámica de jugadores:** Botón para agregar o quitar jugadores sin modificar código, con persistencia en el navegador (`localStorage`).

---

## 🚀 Cómo Ejecutarlo

Tienes dos opciones muy sencillas:

### Opción 1: Doble clic (Windows)
Haz doble clic en el archivo `start.bat`. Se abrirá la consola y levantará automáticamente el navegador en:
`http://localhost:3000`

### Opción 2: Desde la terminal
```bash
npm start
# o directamente:
node server.js
```

---

## 👥 Jugadores Configurados por Defecto (10 Jugadores)

| ID | Jugador |
|---|---|
| 1195043 | Dexter |
| 3081045 | peke |
| 577933 | kick.com/PabloG6 |
| 239211 | Knolte |
| 2793448 | ⛟ ElQueManejaLaCombi ⛟ |
| 5358370 | ram0ff |
| 1736387 | LANDON |
| 945834 | Pinheads \| Marty |
| 2755496 | Sharkusa |
| 2906269 | Cucurreu |

---

## 🛠️ Estructura del Proyecto

```
dashboard TM/
├── assets/             # Escudos de civilizaciones, banderas, íconos y wallpaper
├── css/
│   └── style.css       # Estilos visuales oscuros, efectos de brillo y animaciones
├── js/
│   ├── config.js       # Lista predeterminada de IDs y URLs de la API
│   ├── api.js          # Conexión con la API de AoE Companion
│   ├── dashboard.js    # Renderizado de tarjetas de jugadores y banner Live Now
│   ├── weekly.js       # Cálculo de winrates y deltas semanales
│   ├── civs-maps.js    # Estadísticas agrupadas de civs y mapas
│   └── app.js          # Controlador principal y navegación por pestañas
├── index.html          # Interfaz principal
├── lucas.html          # Copia del build original de respaldo
└── server.js           # Servidor local ligero
```

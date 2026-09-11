# Neko Nora - Minecraft Server Web Dashboard ⛏️

[![Python Version](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-2.x-lightgrey.svg)](https://flask.palletsprojects.com/)
[![WebSocket](https://img.shields.io/badge/Socket.io-Flask--SocketIO-black.svg)](https://flask-socketio.readthedocs.io/)
[![Minecraft Version](https://img.shields.io/badge/Minecraft-Fabric%201.20.1-brightgreen.svg)](https://fabricmc.net/)
[![Profiler](https://img.shields.io/badge/Integrated-Spark%20Profiler-yellow.svg)](https://spark.lucko.me/)
[![Styling](https://img.shields.io/badge/TailwindCSS-Chart.js-38bdf8.svg)](https://tailwindcss.com/)

**Neko Nora Dashboard** is a modern, intuitive, real-time web-based management and monitoring dashboard designed for Minecraft servers. Tailored with a custom gaming dark theme and Minecraft typography, it comes bundled with a pre-configured **Minecraft Fabric 1.20.1** server with the **Spark profiler** mod for high-precision telemetry.

---

## 🌟 Key Features

### 1. Real-Time Telemetry & Monitoring
- **Deep TPS & System Metric Tracking:** Automatically communicates with the **Spark** mod (`/spark health`) to retrieve authentic **TPS** (Ticks Per Second), CPU load breakdown, and memory statistics.
- **Dynamic Live Charts:** Uses **Chart.js** to render real-time history charts of CPU utilization (%) and Memory usage (MB) at a 1 Hz refresh rate.
- **Network Latency (TCP Ping):** Performs direct socket pings to the Minecraft server port (default 25565) to monitor connection responsiveness in milliseconds.
- **Disk & Uptime Monitoring:** Tracks total disk capacity, disk usage percentage, and server uptime.

### 2. Live Interactive Web Console
- **WebSocket Streaming:** Server stdout and stderr logs are streamed live via **Flask-SocketIO** without page reloads.
- **In-Game Command Execution:** Execute any Minecraft server command (`op`, `gamemode`, `say`, `weather`, `whitelist`, etc.) directly from the browser input field.
- **Log Retention & Auto-Scroll:** Keeps the last 500 log lines in a rolling buffer with auto-scroll functionality.

### 3. Server Lifecycle Management
- **Start Server:** Spawns an isolated background process using configurable Java memory allocations (`JAVA_XMS`, `JAVA_XMX`).
- **Graceful Stop:** Safely sends the `stop` command to save the world and player data before shutting down.
- **Instant Restart:** Handles graceful termination and automatic relaunch of the server process.

### 4. Comprehensive Player Administration
- **Online Players List:** Real-time roster showing player usernames and 3D head avatars (via Crafatar/Minotar).
- **One-Click Actions:**
  - Toggle Operator privileges (**OP / De-OP**).
  - Toggle Bans (**Ban / Pardon**).
- **Blacklist Management:** View and unban banned player accounts (`banned-players.json`) and banned IP addresses (`banned-ips.json`).

### 5. Minecraft Gaming Aesthetic UI
- Built-in Minecraft typography (`Minecrafter.ttf`).
- Dark mode interface styled with TailwindCSS and FontAwesome icons.
- Toast notifications providing instant feedback on server state and command executions.

---

## 🛠️ Technology Stack

| Component | Technology / Library | Purpose |
| :--- | :--- | :--- |
| **Backend** | Python 3.9+, Flask, Flask-CORS | REST API and static asset delivery |
| **Realtime Sync** | Flask-SocketIO, Python-EngineIO | WebSocket streaming for console logs and live stats |
| **System Telemetry** | `psutil`, `socket` | System metrics retrieval (CPU, RAM, TCP Ping) |
| **Frontend** | HTML5, TailwindCSS (CDN), Vanilla JavaScript | Responsive user interface |
| **Visualizations** | Chart.js 3.9 | Real-time line charts for CPU and memory usage |
| **Minecraft Server** | Fabric Loader 1.20.1, Fabric API, Spark Mod | High-performance Minecraft modded server |

---

## 📁 Project Structure

```text
DashboardServer_Minecraft/
├── Dashboard/                       # Web Dashboard Application (Python / Flask)
│   ├── config.py                   # Configuration: RAM, ports, host, paths
│   ├── requirements.txt            # Python dependencies
│   ├── server.py                   # Flask server, WebSocket handler, ServerManager
│   ├── logs/                       # Application logs directory
│   ├── static/                     # Static frontend assets
│   │   ├── css/
│   │   │   ├── Minecrafter.ttf     # Custom Minecraft font
│   │   │   └── style.css           # Styling rules
│   │   └── js/
│   │       ├── app.js              # Frontend UI logic, WebSocket & API clients
│   │       └── charts.js           # Chart.js initialization and updates
│   └── templates/
│       └── index.html              # Main dashboard view
├── Server/                          # Minecraft Server Directory (Fabric 1.20.1)
│   ├── mods/                       # Server mods
│   │   ├── fabric-api-*.jar        # Fabric API module
│   │   └── spark-*.jar             # Spark profiler mod
│   ├── fabric-server-launch.jar    # Fabric server launcher
│   ├── server.jar                  # Minecraft 1.20.1 vanilla jar
│   ├── server.properties           # Minecraft configuration (port 25565, MOTD, etc.)
│   ├── eula.txt                    # Minecraft EULA agreement (set to true)
│   ├── ops.json                    # Server operator list
│   ├── whitelist.json              # Server whitelist
│   ├── banned-players.json         # Banned players list
│   ├── banned-ips.json             # Banned IPs list
│   ├── start.bat                   # Standalone launch script for Windows
│   └── start.sh                    # Standalone launch script for Linux
└── README.md                        # Documentation
```

---

## 🚀 Installation & Quick Start

### 1. Prerequisites
- **Python**: Version 3.9 or newer ([Download Python](https://www.python.org/))
- **Java**: Java JDK/JRE version 17 or higher (Required for Minecraft 1.20.1+)

### 2. Install Python Dependencies
Open your terminal, navigate to the `Dashboard` directory, and install the required packages:
```bash
cd Dashboard
pip install -r requirements.txt
```

### 3. Configure Settings (Optional)
Inspect and edit `Dashboard/config.py` to match your system resources:
```python
# Minecraft Server Memory Settings
JAVA_XMS = "4G"       # Initial allocated RAM (e.g., 2G, 4G)
JAVA_XMX = "12G"      # Maximum allowable RAM (e.g., 6G, 8G, 12G)

# Dashboard Server Settings
FLASK_HOST = "127.0.0.1"   # Use "0.0.0.0" to expose to local network
FLASK_PORT = 5000          # Web Dashboard port
```

### 4. Launch the Web Dashboard
From within the `Dashboard` directory, run:
```bash
python server.py
```

Once you see the startup message:
```text
Starting Minecraft Server Dashboard
* Running on http://127.0.0.1:5000
```
Open your web browser and navigate to:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

### 5. Using the Dashboard
1. Click **Start Server** on the left sidebar to launch the Minecraft server.
2. Monitor real-time CPU, RAM, TPS, and ping metrics in the main view.
3. Switch to the **Console** tab to watch the world generation and startup logs.
4. Once the server displays `Done`, players can connect to `localhost:25565`.

---

## ⚙️ REST API Reference

The dashboard provides a complete set of RESTful endpoints for integration and automation:

| Method | Endpoint | Body Payload (JSON) | Description |
| :---: | :--- | :--- | :--- |
| `GET` | `/api/status` | None | Fetch current server status, uptime, and player count |
| `GET` | `/api/ping` | None | Perform a direct TCP ping to the server port (ms) |
| `POST`| `/api/start` | None | Start the Minecraft server process |
| `POST`| `/api/stop` | None | Safely stop the Minecraft server |
| `POST`| `/api/restart` | None | Restart the Minecraft server |
| `POST`| `/api/command` | `{"command": "command_name"}` | Send a command to the Minecraft console |
| `GET` | `/api/players` | None | Get list of currently connected players |
| `GET` | `/api/ops` | None | Retrieve list of server operators (OPs) |
| `GET` | `/api/bans` | None | Retrieve list of banned players and banned IPs |
| `POST`| `/api/player/op_toggle` | `{"name": "player", "action": "op/deop"}` | Grant or revoke OP status |
| `POST`| `/api/player/ban_toggle`| `{"name": "player", "action": "ban/pardon"}` | Ban or pardon a player |
| `POST`| `/api/player/unban` | `{"name": "player"}` | Unban a player |
| `POST`| `/api/ip/unban` | `{"ip": "1.2.3.4"}` | Unban an IP address |

---

## 📝 Notes
- Ensure ports **25565** (Minecraft) and **5000** (Dashboard) are open and not blocked by local firewalls.
- The `Server/eula.txt` file is pre-configured with `eula=true`.
- The Minecraft server can also be run independently without the dashboard using `Server/start.bat` (Windows) or `Server/start.sh` (Linux).

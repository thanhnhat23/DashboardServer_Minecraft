import os
from pathlib import Path

# Server settings
WORKSPACE_ROOT = Path(__file__).parent.parent.resolve()
SERVER_FOLDER = str(WORKSPACE_ROOT / "Server")
BASE_DIR = WORKSPACE_ROOT / "Server"

SERVER_JAR = "fabric-server-launch.jar"
JAVA_XMS = "4G"
JAVA_XMX = "12G"
USE_NOGUI = True

# Dashboard settings
FLASK_HOST = "127.0.0.1"
FLASK_PORT = 5000
DEBUG = False

# Paths for dashboard
DASHBOARD_DIR = Path(__file__).parent
TEMPLATES_DIR = DASHBOARD_DIR / "templates"
STATIC_DIR = DASHBOARD_DIR / "static"
LOGS_DIR = DASHBOARD_DIR / "logs"
CONFIG_FILE = DASHBOARD_DIR / "server_config.json"

# Create dirs if not exist
LOGS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "css").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "js").mkdir(parents=True, exist_ok=True)

# Logging
LOG_FILE = LOGS_DIR / "dashboard.log"
LOG_LEVEL = "INFO"

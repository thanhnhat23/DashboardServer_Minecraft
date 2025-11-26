import os
import sys
import json
import threading
import subprocess
import queue
import time
import re
import logging
import socket
from pathlib import Path
from datetime import datetime
from collections import deque

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
import psutil

# Import config
sys.path.insert(0, str(Path(__file__).parent))
from config import *

# Setup logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Flask app
app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)
# Reduce static caching to avoid stale JS/CSS
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Global asset version for cache busting in templates
ASSET_VERSION = int(time.time())

def ping_minecraft_server(host='127.0.0.1', port=25565, timeout=2):
    """Ping Minecraft server using TCP socket connection
    Returns latency in milliseconds, or -1 if failed
    """
    try:
        start_time = time.time()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.close()
        latency_ms = int((time.time() - start_time) * 1000)
        return latency_ms
    except Exception as e:
        logger.debug(f"Ping failed: {e}")
        return -1

@app.after_request
def add_no_cache_headers(response):
    # Ensure browsers do not cache API responses aggressively
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

class ServerManager:
    def __init__(self):
        self.server_proc = None
        self.stdout_queue = queue.Queue()
        self.stderr_queue = queue.Queue()
        self.stop_reader = threading.Event()
        self.reader_thread = None
        
        # Stats history (max 120 samples = 2 min @ 1Hz)
        self.cpu_history = deque(maxlen=120)
        self.mem_history = deque(maxlen=120)
        self.timestamps = deque(maxlen=120)
        
        # Player tracking
        self.online_players = []
        self.all_players = {}
        self.server_tps = 20.0
        self.tps_timer = None
        self.uptime = 0
        self.start_time = None
        
        # Spark mod integration
        self.spark_enabled = False
        self.last_spark_poll = 0
        self.spark_stats = {'tps': 20.0, 'cpu': 0, 'mem': 0, 'mem_mb': 0, 'disk_used_gb': 0, 'disk_total_gb': 0, 'disk_percent': 0}
        self.last_spark_output_time = 0
        self._last_section = ''  # Track which section we're parsing
        self.server_ping_ms = -1  # Server response time in ms (-1 = offline/no data)
        self.last_valid_ping = -1  # Cache last successful ping
        
        # Console log (last 500 lines)
        self.console_log = deque(maxlen=500)
        
        # Load player cache
        self._load_player_cache()

        # Role tracking
        self.ops_set = set()
        self.banned_set = set()
        self.banned_ips_set = set()
        self._refresh_ops()
        self._refresh_bans()
        self._refresh_banned_ips()

        # Server properties (e.g., max-players)
        self.max_players = 20
        self._server_props_mtime = 0
        self._load_server_properties()

    def _load_server_properties(self):
        """Load server.properties to fetch values like max-players. Refreshes only on file change."""
        try:
            props_path = Path(SERVER_FOLDER) / 'server.properties'
            if not props_path.exists():
                return
            mtime = props_path.stat().st_mtime
            if mtime == self._server_props_mtime:
                return  # no change
            self._server_props_mtime = mtime

            props = {}
            with open(props_path, 'r', encoding='utf-8') as f:
                for raw in f.readlines():
                    line = raw.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        k, v = line.split('=', 1)
                        props[k.strip()] = v.strip()
            if 'max-players' in props:
                try:
                    self.max_players = int(props['max-players'])
                except ValueError:
                    logger.warning(f"Invalid max-players value in server.properties: {props['max-players']}")
            logger.info(f"[Props] Loaded server.properties (max-players={self.max_players})")
        except Exception as e:
            logger.warning(f"Failed to load server.properties: {e}")
    def _load_player_cache(self):
        """Load known players from server folder"""
        try:
            for fname in ['ops.json', 'whitelist.json', 'usercache.json']:
                fpath = Path(SERVER_FOLDER) / fname
                if fpath.exists():
                    try:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                        if isinstance(data, list):
                            for item in data:
                                if isinstance(item, dict) and 'name' in item:
                                    name = item['name']
                                    if name not in self.all_players:
                                        self.all_players[name] = {
                                            "uuid": item.get('uuid', ''),
                                            "lastSeen": item.get('lastSeen', datetime.now().isoformat())
                                        }
                    except Exception as e:
                        logger.warning(f"Error loading {fname}: {e}")
        except Exception as e:
            logger.error(f"Error in _load_player_cache: {e}")

    def _refresh_ops(self):
        """Load operators from ops.json into a set"""
        try:
            ops_path = Path(SERVER_FOLDER) / 'ops.json'
            if ops_path.exists():
                with open(ops_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.ops_set = set([e.get('name') for e in data if isinstance(e, dict) and e.get('name')])
            else:
                self.ops_set = set()
        except Exception:
            self.ops_set = set()

    def _refresh_bans(self):
        """Load banned players from banned-players.json into a set"""
        try:
            bans_path = Path(SERVER_FOLDER) / 'banned-players.json'
            if bans_path.exists():
                with open(bans_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # Vanilla format entries usually have 'name'
                self.banned_set = set([e.get('name') for e in data if isinstance(e, dict) and e.get('name')])
            else:
                self.banned_set = set()
        except Exception:
            self.banned_set = set()

    def _refresh_banned_ips(self):
        """Load banned IPs from banned-ips.json into a set"""
        try:
            banned_ips_path = Path(SERVER_FOLDER) / 'banned-ips.json'
            if banned_ips_path.exists():
                with open(banned_ips_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # Format: [{"ip": "192.168.1.1", "created": "...", ...}, ...]
                self.banned_ips_set = set([e.get('ip') for e in data if isinstance(e, dict) and e.get('ip')])
            else:
                self.banned_ips_set = set()
        except Exception:
            self.banned_ips_set = set()

    def get_banned_players_list(self):
        """Get detailed list of banned players from banned-players.json"""
        try:
            bans_path = Path(SERVER_FOLDER) / 'banned-players.json'
            if bans_path.exists():
                with open(bans_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return [e for e in data if isinstance(e, dict) and e.get('name')]
            return []
        except Exception:
            return []

    def get_banned_ips_list(self):
        """Get detailed list of banned IPs from banned-ips.json"""
        try:
            banned_ips_path = Path(SERVER_FOLDER) / 'banned-ips.json'
            if banned_ips_path.exists():
                with open(banned_ips_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                return [e for e in data if isinstance(e, dict) and e.get('ip')]
            return []
        except Exception:
            return []
    def start(self):
        """Start server by running start.bat"""
        if self.server_proc and self.server_proc.poll() is None:
            logger.info("Server already running")
            return {"status": "already_running"}
        
        try:
            # Prefer launching Java directly with nogui so we can write to stdin and control it.
            jar_path = Path(SERVER_FOLDER) / SERVER_JAR
            if jar_path.exists():
                logger.info(f"Starting server with Java (nogui): {jar_path}")
                cmd = ['java', f'-Xms{JAVA_XMS}', f'-Xmx{JAVA_XMX}', '-jar', str(jar_path)]
                if USE_NOGUI:
                    cmd.append('nogui')

                self.server_proc = subprocess.Popen(
                    cmd,
                    cwd=str(SERVER_FOLDER),
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace',
                    bufsize=1
                )
            else:
                # If jar missing, try start.bat as fallback (should be configured to nogui)
                start_bat = Path(SERVER_FOLDER) / "start.bat"
                if start_bat.exists():
                    logger.info(f"JAR not found, using start.bat: {start_bat}")
                    self.server_proc = subprocess.Popen(
                        ['cmd', '/c', str(start_bat)],
                        cwd=str(SERVER_FOLDER),
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        encoding='utf-8',
                        errors='replace',
                        bufsize=1
                    )
                else:
                    logger.error(f"Neither JAR nor start.bat found in {SERVER_FOLDER}")
                    return {"status": "error", "message": "JAR and start.bat not found"}
            
            self.start_time = time.time()
            self.stop_reader.clear()
            
            # Start reader thread
            if not self.reader_thread or not self.reader_thread.is_alive():
                self.reader_thread = threading.Thread(target=self._read_output, daemon=True)
                self.reader_thread.start()
            
            logger.info("Server started successfully")
            return {"status": "success"}
        
        except Exception as e:
            logger.error(f"Error starting server: {e}")
            self.server_proc = None
            return {"status": "error", "message": str(e)}

    def stop(self):
        """Stop server gracefully"""
        if not self.server_proc or self.server_proc.poll() is not None:
            logger.info("Server not running")
            return {"status": "not_running"}
        
        try:
            logger.info("Stopping server...")
            self.send_command("stop")
            time.sleep(5)
            
            if self.server_proc.poll() is None:
                self.server_proc.terminate()
                time.sleep(2)
                if self.server_proc.poll() is None:
                    self.server_proc.kill()
            
            self.stop_reader.set()
            logger.info("Server stopped")
            return {"status": "success"}
        
        except Exception as e:
            logger.error(f"Error stopping server: {e}")
            return {"status": "error", "message": str(e)}

    def restart(self):
        """Restart server"""
        logger.info("Restarting server...")

        @app.route('/api/ops', methods=['GET'])
        def api_ops():
            server._refresh_ops()
            return jsonify({"ops": sorted(list(server.ops_set))})

        @app.route('/api/bans', methods=['GET'])
        def api_bans():
            server._refresh_bans()
            return jsonify({"banned": sorted(list(server.banned_set))})

        @app.route('/api/player/op_toggle', methods=['POST'])
        def api_player_op_toggle():
            data = request.get_json(force=True, silent=True) or {}
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify({"success": False, "error": "name required"}), 400
            # Decide action by current state unless explicit
            server._refresh_ops()
            desired = data.get('action')  # 'op' | 'deop' | None
            if desired not in ('op', 'deop'):
                desired = 'deop' if name in server.ops_set else 'op'
            server.send_command(f"{desired} {name}")
            time.sleep(0.6)
            server._refresh_ops()
            return jsonify({
                "success": True,
                "name": name,
                "is_op": name in server.ops_set
            })

        @app.route('/api/player/ban_toggle', methods=['POST'])
        def api_player_ban_toggle():
            data = request.get_json(force=True, silent=True) or {}
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify({"success": False, "error": "name required"}), 400
            # Decide action
            server._refresh_bans()
            desired = data.get('action')  # 'ban' | 'pardon' | None
            if desired not in ('ban', 'pardon'):
                desired = 'pardon' if name in server.banned_set else 'ban'
            if desired == 'ban':
                server.send_command(f"ban {name} By dashboard")
            else:
                server.send_command(f"pardon {name}")
            time.sleep(0.6)
            server._refresh_bans()
            return jsonify({
                "success": True,
                "name": name,
                "is_banned": name in server.banned_set
            })
        self.stop()
        time.sleep(3)
        return self.start()

    def _parse_spark_output(self, line):
        """Parse Spark command output for stats"""
        try:
            current_time = time.time()
            
            # Mark Spark as enabled when we see spark output
            if '[spark-worker-pool' in line or 'spark health report' in line.lower():
                self.spark_enabled = True
                self.last_spark_output_time = current_time
                logger.info("[Spark] Detected Spark output")
            
            # Parse TPS line: "20.0, *20.0, 19.37, 19.87, 19.96"
            # This comes after "> TPS from last 5s, 10s, 1m, 5m, 15m:"
            if line.strip() and not line.startswith('>') and not line.startswith('['):
                # Check if line contains TPS values (numbers with commas and optional asterisks)
                if ',' in line and any(c.isdigit() for c in line):
                    clean = line.replace('*', '').strip()
                    # Try to parse as TPS values
                    try:
                        parts = [x.strip() for x in clean.split(',')]
                        if len(parts) >= 3 and all('.' in p or p.isdigit() for p in parts[:3]):
                            values = [float(p) for p in parts[:5]]  # Get up to 5 values
                            if len(values) >= 3:
                                # Use 1m average (3rd value: index 2)
                                self.spark_stats['tps'] = values[2]
                                self.spark_enabled = True
                                logger.info(f"[Spark] TPS: {values[2]:.2f}")
                                return
                    except (ValueError, IndexError):
                        pass
            
            # Parse CPU process line: "0%, 1%, 1% (process)"
            if '(process)' in line.lower() and '%' in line:
                # Extract all percentages before "(process)"
                match = re.findall(r'(\d+)%', line.split('(process)')[0])
                if len(match) >= 2:
                    # Use 1m value (2nd one)
                    cpu_1m = int(match[1])
                    self.spark_stats['cpu'] = cpu_1m
                    self.spark_enabled = True
                    logger.info(f"[Spark] CPU: {cpu_1m}%")
                    return
                    
            # Parse Memory line: "1.3 GB / 12.0 GB (10%)"
            if 'GB' in line and '/' in line and '(' in line and '%' in line:
                match = re.search(r'([\d.]+)\s*GB\s*/\s*([\d.]+)\s*GB\s*\((\d+)%\)', line)
                if match:
                    used_gb = float(match.group(1))
                    total_gb = float(match.group(2))
                    percent = int(match.group(3))
                    
                    # Determine if this is Memory or Disk based on total size
                    # Memory is typically <50 GB, Disk is typically >50 GB
                    if total_gb < 50:  # This is RAM
                        self.spark_stats['mem'] = percent
                        self.spark_stats['mem_mb'] = int(used_gb * 1024)  # Convert GB to MB
                        self.spark_enabled = True
                        logger.info(f"[Spark] Memory: {percent}% ({used_gb:.1f}/{total_gb:.1f} GB)")
                        self._last_section = 'Memory'
                    else:  # This is Disk (>50 GB)
                        self.spark_stats['disk_used_gb'] = used_gb
                        self.spark_stats['disk_total_gb'] = total_gb
                        self.spark_stats['disk_percent'] = percent
                        self.spark_enabled = True
                        logger.info(f"[Spark] Disk: {percent}% ({used_gb:.1f}/{total_gb:.1f} GB)")
                        self._last_section = 'Disk'
                    return
                    
            # Track section headers to know context
            if '> Memory usage:' in line:
                self._last_section = 'Memory'
            elif '> Disk usage:' in line:
                self._last_section = 'Disk'
            elif '> CPU usage' in line:
                self._last_section = 'CPU'
            elif '> TPS from last' in line:
                self._last_section = 'TPS'
                    
        except Exception as e:
            logger.error(f"Error parsing Spark output: {e}")
    
    def send_command(self, cmd):
        """Send command to server"""
        if not self.server_proc or self.server_proc.poll() is not None:
            logger.warning(f"Cannot send command - server not running")
            return {"status": "error", "message": "Server not running"}
        
        try:
            # stdin already uses encoding='utf-8' from Popen, write string directly
            self.server_proc.stdin.write(cmd + "\n")
            self.server_proc.stdin.flush()
            logger.info(f"Command sent: {cmd}")
            return {"status": "success"}
        except Exception as e:
            logger.error(f"Error sending command: {e}")
            return {"status": "error", "message": str(e)}

    def _read_output(self):
        """Read server output and parse it"""
        try:
            while not self.stop_reader.is_set() and self.server_proc and self.server_proc.poll() is None:
                try:
                    # Non-blocking read with timeout
                    line = self.server_proc.stdout.readline()
                    if not line:
                        time.sleep(0.1)
                        continue
                    
                    line = line.strip()
                    if not line:
                        continue
                except:
                    time.sleep(0.1)
                    continue
                
                # Add to console log
                self.console_log.append(line)
                
                # Always try to parse Spark output (it has multiple formats)
                self._parse_spark_output(line)
                
                # Parse TPS from server output (fallback if Spark not available)
                if "Overall" in line and "TPS" in line:
                    # Parse format: "Overall: 19.8 TPS"
                    match = re.search(r'Overall.*?(\d+\.?\d*)\s*TPS', line, re.IGNORECASE)
                    if match:
                        self.server_tps = float(match.group(1))
                        logger.debug(f"Parsed TPS: {self.server_tps}")
                elif "Mean tick time" in line:
                    # Alternative TPS format parsing
                    match = re.search(r'(\d+\.?\d*)\s*tps', line, re.IGNORECASE)
                    if match:
                        self.server_tps = float(match.group(1))
                        logger.debug(f"Parsed TPS: {self.server_tps}")
                
                # Parse player events
                if "joined the game" in line:
                    match = re.search(r'([^\s]+) joined the game', line)
                    if match:
                        player = match.group(1)
                        if player not in [p['name'] for p in self.online_players]:
                            self.online_players.append({"name": player})
                            try:
                                socketio.emit('player_joined', {"player": player}, namespace='/')
                            except Exception:
                                socketio.emit('player_joined', {"player": player})
                
                elif "left the game" in line:
                    match = re.search(r'([^\s]+) left the game', line)
                    if match:
                        player = match.group(1)
                        self.online_players = [p for p in self.online_players if p['name'] != player]
                        try:
                            socketio.emit('player_left', {"player": player}, namespace='/')
                        except Exception:
                            socketio.emit('player_left', {"player": player})
                
                # Emit console line
                try:
                    socketio.emit('console_log', line, namespace='/')
                except Exception:
                    socketio.emit('console_log', line)
                
        except Exception as e:
            logger.error(f"Error reading output: {e}")

    def poll_output(self):
        """Poll for any pending output"""
        lines = []
        try:
            while True:
                line = self.stdout_queue.get_nowait()
                lines.append(line)
        except queue.Empty:
            pass
        return lines

    def _parse_line(self, line):
        """Parse a line for relevant info"""
        # Implementation for parsing
        pass

    def get_stats(self):
        """Get current server stats"""
        try:
            # Refresh server.properties if changed (cheap check by mtime)
            self._load_server_properties()
            # Check if process is running
            is_online = self.server_proc is not None and self.server_proc.poll() is None
            
            # Reset ping to -1 if server is offline
            if not is_online:
                self.server_ping_ms = -1
                self.last_valid_ping = -1
            else:
                # Use cached ping if available (prevents showing -1 between measurements)
                if self.last_valid_ping > 0 and self.server_ping_ms == -1:
                    self.server_ping_ms = self.last_valid_ping
            
            # Poll Spark every 5 seconds if server is online
            current_time = time.time()
            if is_online and (current_time - self.last_spark_poll) >= 5:
                self.last_spark_poll = current_time
                try:
                    # Measure real network ping to Minecraft server
                    ping_result = ping_minecraft_server()
                    if ping_result > 0:
                        self.server_ping_ms = ping_result
                        self.last_valid_ping = ping_result  # Cache successful ping
                    elif self.last_valid_ping > 0:
                        # If ping fails but we have cached value, use it
                        self.server_ping_ms = self.last_valid_ping
                    
                    # Send /spark health command
                    self.send_command('/spark health')
                    logger.info(f"[Spark] Polling /spark health (ping: {self.server_ping_ms}ms)")
                except Exception as e:
                    logger.error(f"[Spark] Poll error: {e}")
                    # Use cached ping if available
                    if self.last_valid_ping > 0:
                        self.server_ping_ms = self.last_valid_ping
            
            # Refresh ops and bans to decorate players
            self._refresh_ops()
            self._refresh_bans()
            
            # Decorate online players with is_op and is_banned flags
            decorated_players = []
            for player in self.online_players:
                name = player.get('name', '')
                decorated_players.append({
                    "name": name,
                    "is_op": name in self.ops_set,
                    "is_banned": name in self.banned_set
                })
            
            # Use Spark TPS if available, otherwise fallback to server_tps
            # When server is offline, force TPS to 0
            tps_value = 0 if not is_online else (
                self.spark_stats['tps'] if self.spark_enabled else self.server_tps
            )
            
            stats = {
                "online": is_online,
                "cpu": 0,
                "mem": 0,
                "mem_mb": 0,
                "uptime": "0h 0m 0s",
                "tps": tps_value,
                "spark_enabled": self.spark_enabled,
                "server_ping_ms": self.server_ping_ms,
                "disk_percent": self.spark_stats['disk_percent'],
                "disk_used_gb": self.spark_stats['disk_used_gb'],
                "disk_total_gb": self.spark_stats['disk_total_gb'],
                "online_players": decorated_players,
                "player_count": len(decorated_players),
                "max_players": self.max_players,
                "console_log": list(self.console_log)
            }
            
            # Get CPU and memory stats if process exists and is running
            if is_online:
                try:
                    proc = psutil.Process(self.server_proc.pid)
                    
                    # Use Spark CPU if available, otherwise psutil
                    if self.spark_enabled and self.spark_stats['cpu'] > 0:
                        stats["cpu"] = min(max(self.spark_stats['cpu'], 0), 100)
                    else:
                        cpu_val = proc.cpu_percent(interval=0.01)
                        stats["cpu"] = min(max(cpu_val, 0), 100)
                    
                    # Use Spark Memory if available (both percentage and MB), otherwise psutil
                    if self.spark_enabled and self.spark_stats['mem'] > 0:
                        stats["mem"] = min(max(self.spark_stats['mem'], 0), 100)
                        stats["mem_mb"] = self.spark_stats.get('mem_mb', 0)
                    else:
                        mem_info = proc.memory_info()
                        stats["mem_mb"] = mem_info.rss // (1024 * 1024)
                        total_mem = psutil.virtual_memory().total
                        mem_pct = (mem_info.rss / total_mem) * 100
                        stats["mem"] = min(max(mem_pct, 0), 100)
                    
                except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                    logger.warning(f"Process stats error: {e}")
                    stats["online"] = False

            # Info logging for stats (helpful to trace offline/online mismatches)
            logger.info(f"get_stats: pid={getattr(self.server_proc, 'pid', None)} poll={None if not self.server_proc else self.server_proc.poll()} online={stats.get('online')} cpu={stats.get('cpu')} mem={stats.get('mem')} mem_mb={stats.get('mem_mb')}")
            
            # Calculate uptime
            if self.start_time and is_online:
                uptime_sec = int(time.time() - self.start_time)
                hours = uptime_sec // 3600
                minutes = (uptime_sec % 3600) // 60
                seconds = uptime_sec % 60
                stats["uptime"] = f"{hours}h {minutes}m {seconds}s"
            
            return stats
        
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {"error": str(e), "online": False}

# Initialize server manager
server = ServerManager()

# Flask Routes
@app.route('/')
def index():
    """Serve dashboard HTML"""
    return render_template('index.html')

@app.route('/api/status')
def get_status():
    """Get server status"""
    stats = server.get_stats()
    return jsonify(stats)

@app.route('/api/ping', methods=['GET'])
def ping():
    """Ping endpoint for latency measurement"""
    return jsonify({"timestamp": time.time()})

@app.route('/api/start', methods=['POST'])
def start_server():
    """Start server"""
    result = server.start()
    return jsonify(result)

@app.route('/api/stop', methods=['POST'])
def stop_server():
    """Stop server"""
    result = server.stop()
    return jsonify(result)

@app.route('/api/restart', methods=['POST'])
def restart_server():
    """Restart server"""
    result = server.restart()
    return jsonify(result)

@app.route('/api/command', methods=['POST'])
def execute_command():
    """Execute server command"""
    data = request.json
    cmd = data.get('cmd') or data.get('command')
    
    if not cmd:
        return jsonify({"success": False, "error": "No command provided"})
    
    result = server.send_command(cmd)
    success = result.get("status") == "success"
    return jsonify({
        "success": success,
        "error": result.get("message", "") if not success else None
    })

@app.route('/api/players')
def get_players():
    """Get online players"""
    return jsonify({"players": server.online_players})

@app.route('/api/ops', methods=['GET'])
def api_ops():
    """Get list of operators"""
    server._refresh_ops()
    return jsonify({"ops": sorted(list(server.ops_set))})

@app.route('/api/bans', methods=['GET'])
def api_bans():
    """Get list of banned players"""
    server._refresh_bans()
    return jsonify({"banned": sorted(list(server.banned_set))})

@app.route('/api/banned_players', methods=['GET'])
def api_banned_players():
    """Get detailed list of banned players"""
    banned_list = server.get_banned_players_list()
    return jsonify({"banned_players": banned_list})

@app.route('/api/banned_ips', methods=['GET'])
def api_banned_ips():
    """Get detailed list of banned IPs"""
    banned_ips = server.get_banned_ips_list()
    return jsonify({"banned_ips": banned_ips})

@app.route('/api/player/unban', methods=['POST'])
def api_player_unban():
    """Unban a player by name"""
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"success": False, "error": "name required"}), 400
    server.send_command(f"pardon {name}")
    time.sleep(0.3)
    server._refresh_bans()
    return jsonify({"success": True, "name": name})

@app.route('/api/ip/unban', methods=['POST'])
def api_ip_unban():
    """Unban an IP address"""
    data = request.get_json(force=True, silent=True) or {}
    ip = (data.get('ip') or '').strip()
    if not ip:
        return jsonify({"success": False, "error": "ip required"}), 400
    server.send_command(f"pardon-ip {ip}")
    time.sleep(0.3)
    server._refresh_banned_ips()
    return jsonify({"success": True, "ip": ip})

@app.route('/api/player/op_toggle', methods=['POST'])
def api_player_op_toggle():
    """Toggle OP status for a player"""
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"success": False, "error": "name required"}), 400
    # Decide action by current state unless explicit
    server._refresh_ops()
    desired = data.get('action')  # 'op' | 'deop' | None
    if desired not in ('op', 'deop'):
        desired = 'deop' if name in server.ops_set else 'op'
    server.send_command(f"{desired} {name}")
    time.sleep(0.6)
    server._refresh_ops()
    return jsonify({
        "success": True,
        "name": name,
        "is_op": name in server.ops_set
    })

@app.route('/api/player/ban_toggle', methods=['POST'])
def api_player_ban_toggle():
    """Toggle ban status for a player"""
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"success": False, "error": "name required"}), 400
    # Decide action
    server._refresh_bans()
    desired = data.get('action')  # 'ban' | 'pardon' | None
    if desired not in ('ban', 'pardon'):
        desired = 'pardon' if name in server.banned_set else 'ban'
    if desired == 'ban':
        server.send_command(f"ban {name} By dashboard")
    else:
        server.send_command(f"pardon {name}")
    time.sleep(0.6)
    server._refresh_bans()
    return jsonify({
        "success": True,
        "name": name,
        "is_banned": name in server.banned_set
    })

# Background task to update stats
_update_task_started = False

def update_loop():
    """Update stats periodically"""
    logger.info("Update loop thread started")
    while True:
        time.sleep(1)
        try:
            stats = server.get_stats()
            # Emit stats to all connected clients
            try:
                socketio.emit('stats_update', stats, namespace='/')
                logger.info("Emitted stats_update to clients")
            except Exception as e:
                logger.error(f"Emit stats_update failed: {e}")
                try:
                    with app.app_context():
                        socketio.emit('stats_update', stats)
                        logger.info("Fallback emit stats_update succeeded")
                except Exception as e2:
                    logger.error(f"Fallback emit stats_update failed: {e2}")
        except Exception as e:
            logger.error(f"Error in update loop: {e}")

# WebSocket events
@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    global _update_task_started
    logger.info("Client connected")
    emit('connection_response', {'data': 'Connected to server'})
    
    # Send initial stats
    stats = server.get_stats()
    emit('stats_update', stats)
    
    # Start background task on first connection
    if not _update_task_started:
        _update_task_started = True
        try:
            socketio.start_background_task(update_loop)
            logger.info("Started background stats update task")
        except Exception as e:
            logger.error(f"Failed to start background stats update task: {e}")
            _update_task_started = False

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info("Client disconnected")

# Start background task
update_thread = threading.Thread(target=update_loop, daemon=True)
update_thread.start()

if __name__ == '__main__':
    logger.info("Starting Minecraft Server Dashboard")
    socketio.run(app, host=FLASK_HOST, port=FLASK_PORT, debug=DEBUG)

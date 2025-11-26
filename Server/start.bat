@echo off
cd /d "%~dp0"
java -Xms4G -Xmx12G -jar fabric-server-launch.jar nogui
pause
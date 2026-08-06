@echo off
chcp 65001 >nul
title 面试助手Agent（MS-Agent-Lite）一键启动
setlocal
rem 本文件位于发布包第一层，先进入工程文件目录
cd /d "%~dp0MS-Agent-Lite工程文件"
set PORT=8900

echo ==================================================
echo   面试助手Agent（MS-Agent-Lite）一键启动器
echo   - 本地服务地址：http://127.0.0.1:%PORT%/
echo   - 数据仅保存在本机，请放心使用
echo ==================================================
echo.

rem ---------- 1) 检查 Node.js 是否安装 ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，无法启动服务。
    echo.
    echo 解决办法（约 3 分钟）：
    echo   1. 打开浏览器访问 https://nodejs.org
    echo   2. 下载 LTS 版本（左侧绿色大按钮）并安装，一路点"下一步"
    echo   3. 安装完成后，重新双击本文件
    echo.
    echo 详细图文步骤见《新手安装使用指南.md》第 3 步。
    echo.
    pause
    exit /b 1
)
echo [1/3] Node.js 检测通过
echo.

rem ---------- 2) 端口是否已被占用（服务可能已在运行） ----------
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto OPEN

rem ---------- 3) 后台启动服务（最小化窗口，便于日后关闭） ----------
echo [2/3] 正在启动本地服务，请稍候...
start "MS-Agent服务" /min node 20_执行\server.js

rem 轮询等待端口就绪（最多 20 秒）
set /a N=0
:WAIT
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto OPEN
set /a N+=1
if %N% geq 20 goto FAIL
timeout /t 1 /nobreak >nul
goto WAIT

:FAIL
echo.
echo [错误] 服务启动失败或超时（20 秒）。可能原因：
echo   1. 端口 %PORT% 被其他程序占用 → 关闭占用程序后重试
echo   2. 20_执行\config.json 配置损坏 → 删除该文件后重试（会在网页重新配置）
    echo   3. Node.js 版本过旧 → 请升级到 18 或更高版本
    echo.
    echo 也可手动启动排查：在 20_执行 目录运行  node server.js
echo.
pause
exit /b 1

:OPEN
echo [3/3] 服务已就绪，正在打开浏览器...
start "" "http://127.0.0.1:%PORT%/"
echo.
echo 已自动打开浏览器；如未打开，请手动访问：http://127.0.0.1:%PORT%/
echo.
echo 使用完可在任务栏找到"MS-Agent服务"最小化窗口并关闭它来停止服务。
echo （关闭本窗口不影响服务运行）
timeout /t 8 /nobreak >nul
exit /b 0

@echo off
chcp 65001 >nul
setlocal
set ANDROID_HOME=D:/AndroidSdk
set JAVA_HOME=D:/jdk-21.0.13.0.2+1
cd /d "%~dp0"
echo [1/3] 同步网页...
node sync-web.js || goto :err
echo [2/3] 同步到安卓工程...
call npx cap sync android || goto :err
echo [3/3] 编译 APK...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :err
copy /y app\build\outputs\apk\debug\app-debug.apk "..\课表助手-v1.0.apk" >nul
echo.
echo 完成：%~dp0课表助手-v1.0.apk
cd ..
pause
exit /b 0
:err
echo.
echo 出错了，看上面的日志。
pause
exit /b 1

@echo off
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo Android Studio JDK was not found at "%JAVA_HOME%"
  pause
  exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"
if not exist release.keystore (
  echo Creating a private release signing key...
  powershell -NoProfile -Command "$chars = (48..57 + 65..90 + 97..122 | ForEach-Object { [char]$_ }); $pass = -join (1..32 | ForEach-Object { $chars | Get-Random }); Set-Content -Path 'keystore.properties' -Value @('storeFile=release.keystore','storePassword=' + $pass,'keyAlias=crypto-monitor','keyPassword=' + $pass) -Encoding ascii; & '%JAVA_HOME%\bin\keytool.exe' -genkeypair -keystore release.keystore -alias crypto-monitor -keyalg RSA -keysize 2048 -validity 10000 -storepass $pass -keypass $pass -dname 'CN=Crypto Chart Monitor, O=Crypto Monitor'"
  if errorlevel 1 (
    echo Could not create the signing key.
    pause
    exit /b 1
  )
)
call gradlew.bat assembleRelease
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Built: %~dp0app\build\outputs\apk\release\app-release.apk
pause

@echo off
setlocal
chcp 65001 >nul
echo Загрузка свежей версии дашборда СЭД с GitHub...
echo Папка расширения: %~dp0
set "UPDATE_TARGET=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $base='https://raw.githubusercontent.com/V-M221/ozon-sed-dashboard/main'; $target=$env:UPDATE_TARGET; $files=@('manifest.json','background.js','bridge.js','injector.js','sidepanel.html','sidepanel.js'); try { foreach($f in $files) { Write-Host ('Обновление: '+$f); $uri=$base+'/'+$f+'?t='+[DateTimeOffset]::Now.ToUnixTimeSeconds(); Invoke-WebRequest -Uri $uri -OutFile (Join-Path $target $f) -UseBasicParsing }; $manifest=Get-Content (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json; if(-not $manifest.version) { throw 'В скачанном manifest.json не найдена версия.' }; Write-Host ('Версия загруженных файлов: '+$manifest.version) } catch { Write-Host ('ОШИБКА ОБНОВЛЕНИЯ: '+$_.Exception.Message); exit 1 }"

if errorlevel 1 goto failed
echo.
echo [ГОТОВО!] Обновление завершено.
echo Теперь нажмите кнопку перезагрузки внутри дашборда в Chrome.
goto finish

:failed
echo.
echo [ОШИБКА] Файлы могли обновиться не полностью. Скопируйте текст ошибки выше.

:finish
timeout /t 8
endlocal

@echo off
chcp 65001 >nul
echo Загрузка свежей версии дашборда СЭД с GitHub...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = 'https://raw.githubusercontent.com/V-M221/ozon-sed-dashboard/main';" ^
  "$files = @('manifest.json','background.js','bridge.js','injector.js','sidepanel.html','sidepanel.js');" ^
  "foreach ($f in $files) { " ^
  "  Write-Host ('Обновление: ' + $f);" ^
  "  Invoke-WebRequest -Uri ($base + '/' + $f + '?t=' + [DateTimeOffset]::Now.ToUnixTimeSeconds()) -OutFile (Join-Path '%~dp0' $f) -UseBasicParsing;" ^
  "}"

echo.
echo [ГОТОВО!] Все файлы успешно обновлены!
echo Теперь нажмите кнопку перезагрузки внутри дашборда в Chrome.
timeout /t 4
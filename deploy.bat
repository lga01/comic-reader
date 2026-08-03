@echo off

echo ========================================
echo Limpiando proyecto...
echo ========================================

if exist bin rmdir /s /q bin
if exist obj rmdir /s /q obj

echo.
echo ========================================
echo Compilando...
echo ========================================

dotnet publish -c Release

if errorlevel 1 (
    echo.
    echo ERROR: La compilacion ha fallado.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Subiendo cambios...
echo ========================================

git add .
git commit -m "latest changes"
git push origin main

echo.
echo ========================================
echo Despliegue completado
echo ========================================

pause
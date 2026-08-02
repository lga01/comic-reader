@echo off
REM deploy.bat - Compila el proyecto y publica el resultado en GitHub Pages
REM Ejecutar desde la raíz del proyecto (junto al .csproj)

echo Compilando en modo Release...
dotnet publish -c Release
if errorlevel 1 (
    echo ERROR: fallo la compilacion. Cancelando.
    exit /b 1
)

echo.
echo Anadiendo el build al commit...
git add bin\Release\net10.0\publish\wwwroot -f
git commit -m "Build actualizado"

echo.
echo Publicando en gh-pages...
git subtree push --prefix bin/Release/net10.0/publish/wwwroot origin gh-pages

echo.
echo Hecho. Espera un par de minutos y recarga la web.

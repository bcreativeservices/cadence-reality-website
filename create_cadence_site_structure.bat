@echo off
echo Creating Cadence Realty Services project structure...

REM === Root HTML Pages ===
echo Creating HTML files...
type nul > index.html
type nul > search.html
type nul > buyers.html
type nul > sellers.html
type nul > team.html
type nul > contact.html
type nul > privacy.html
type nul > terms.html

REM === CSS Directory ===
echo Creating CSS directory and files...
mkdir css
type nul > css/global.css
type nul > css/components.css
type nul > css/home.css
type nul > css/search.css
type nul > css/buyers.css
type nul > css/sellers.css
type nul > css/team.css
type nul > css/contact.css

REM === JS Directory ===
echo Creating JS directory and files...
mkdir js
type nul > js/global.js
type nul > js/contact.js

REM === Assets Directory ===
echo Creating assets directories...
mkdir assets
mkdir assets\images
mkdir assets\branding
mkdir assets\bios

echo Project structure created successfully!
pause

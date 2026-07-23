@echo off 
echo Deploying KC Watch Trading site... 
if exist "C:\Users\garyb\Downloads\index_2.html" (copy /Y "C:\Users\garyb\Downloads\index_2.html" "C:\Users\garyb\kcwatchtrading\index.html") else if exist "C:\Users\garyb\Downloads\index.html" (copy /Y "C:\Users\garyb\Downloads\index.html" "C:\Users\garyb\kcwatchtrading\index.html") 
git add -A 
git commit -m "Update site" 
git push 
echo Done! Site will be live in 2-3 minutes. 

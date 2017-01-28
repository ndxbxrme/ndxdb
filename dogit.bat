
call grunt build
call npm version %1 --no-git-tag-version
git add --all
git commit -m %2
git push origin master
call npm publish
cd ..\ndx-server
call npm uninstall --save ndxdb
call npm install --save ndxdb
call grunt build
call npm version %1 --no-git-tag-version
git add --all
git commit -m "ndxdb bump"
git push origin master
call npm publish
cd ..\ndxdb

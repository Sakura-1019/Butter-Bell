; electron-builder 会自动引入这个文件。
; 安装包会把自己复制到 %LOCALAPPDATA%\butter-bell-updater\installer.exe，留给自动更新做增量升级。
; Butter Bell 只提示新版本、不自动更新，用不上它，所以装完就删，卸载时再清一次。
!macro customInstall
  RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend

!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend

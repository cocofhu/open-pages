; Installer hooks for the Windows build.
;
; Upgrade: close leftovers, drop stale runtime files and WebView caches, then
; overwrite. Site drafts stay in %USERPROFILE%\.open-pages.
; Uninstall: wipe the program, WebView profile, user data, and GitHub creds.

!macro OpenPagesStopProcesses
  DetailPrint "Closing Open Pages and its background runtime..."
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "$$dir = '$INSTDIR'; if ($$dir.Length -gt 3) { Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase) -and $$_.Name -ne 'uninstall.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"`
  Pop $0
  Sleep 1000
!macroend

!macro OpenPagesWipeWebViewCaches
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Cache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Code Cache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Service Worker"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\GPUCache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\DawnGraphiteCache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\DawnWebGPUCache"
!macroend

!macro OpenPagesWipeCredentials
  nsExec::Exec `cmdkey /delete:open-pages`
  Pop $0
  nsExec::Exec `cmdkey /delete:open-pages/github-token`
  Pop $0
  nsExec::Exec `cmdkey /delete:open-pages/github-session`
  Pop $0
  nsExec::Exec `cmdkey /delete:open-pages:github-token`
  Pop $0
  nsExec::Exec `cmdkey /delete:open-pages:github-session`
  Pop $0
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "cmdkey /list | ForEach-Object { if ($$_ -match 'target=(\\S*open-pages\\S*)') { cmdkey /delete:$$Matches[1] } }"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OpenPagesStopProcesses
  RMDir /r "$INSTDIR\runtime-bundle"
  Delete "$INSTDIR\node.exe"
  !insertmacro OpenPagesWipeWebViewCaches
  SetOverwrite on
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OpenPagesStopProcesses
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    RMDir /r "$PROFILE\.open-pages"
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
    RMDir /r "$APPDATA\${BUNDLEID}"
    !insertmacro OpenPagesWipeCredentials
    RMDir /r "$INSTDIR"
  ${EndIf}
!macroend

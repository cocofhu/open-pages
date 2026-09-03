; Installer hooks for the Windows build.
;
; Open Pages runs its Hexo work in a Node sidecar spawned out of the install
; directory. Killing the app window does not take that sidecar with it, and
; Windows refuses to overwrite an executable that is still mapped into a live
; process: NSIS then stops on "Error opening file for writing" and whoever
; clicks "Abort" (or "Ignore") keeps running the old version. Clear the install
; directory of live processes and stale runtime files before any file is copied.

!macro OpenPagesStopProcesses
  DetailPrint "Closing Open Pages and its background runtime..."

  ; /T reaches the WebView2 and Node children while the app itself is alive.
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0

  ; A force-killed app orphans the sidecar, so the tree above may already be
  ; gone. Match on the install path instead: that catches the orphan (and the
  ; plain "node.exe" older versions shipped) without touching Node processes
  ; the user started themselves. The length guard keeps a drive-root install
  ; from matching every process on the machine.
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "$$dir = '$INSTDIR'; if ($$dir.Length -gt 3) { Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"`
  Pop $0

  ; File handles outlive the process by a moment.
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OpenPagesStopProcesses

  ; The runtime bundle is a deployed node_modules tree. An uninstaller only
  ; removes the files its own build knew about, so anything a later version
  ; dropped would linger and get resolved instead of the new tree.
  RMDir /r "$INSTDIR\runtime-bundle"

  ; The sidecar installs as a bare "node.exe". Deleting it first means the copy
  ; below lands on a free path rather than on whatever the old install left.
  Delete "$INSTDIR\node.exe"

  ; WebView2 caches what the app serves over http://tauri.localhost, so the new
  ; build can still boot the previous UI. Releases up to 0.1.16 also registered
  ; a PWA service worker there, which precached the whole app shell; it now
  ; self-destroys on first launch, and dropping it here saves users that reload.
  ; Only caches go - site drafts and the sign-in state live in the same profile.
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Cache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Code Cache"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}\EBWebView\Default\Service Worker"

  SetOverwrite on
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OpenPagesStopProcesses
!macroend

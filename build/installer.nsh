; -----------------------------------------------------------------------------
; Iraqi Labor Scheduler — installer customisation (electron-builder hooks)
;
; Three responsibilities on top of electron-builder's default NSIS template:
;
;   1. Detect an existing installation via HKCU and surface a one-line
;      MessageBox at the start of the wizard so the user knows the
;      installer is performing an update, not a fresh install. (We use a
;      MessageBox rather than swapping the welcome page text because that
;      requires compile-time `!define`s, which can't react to a runtime
;      registry read.)
;
;   2. Defensively guarantee the user data folder
;      (%APPDATA%\<app>\data\) is never touched by the installer's
;      payload. The data folder lives outside ${INSTDIR} by design (see
;      electron/main.cjs), so this is belt-and-braces — we explicitly
;      print a "preserving data" line during the silent pre-update
;      uninstall sweep.
;
;   3. Stamp the new version into HKCU (so the next installer detects it),
;      and drop a `.update-pending` marker the Electron main process
;      reads on first launch to snapshot the data folder. The marker is
;      written to two candidate AppData paths because Electron's
;      `userData` follows the package.json `name` while NSIS resolves
;      `${PRODUCT_FILENAME}` from the `productName` — both paths are
;      checked from the JS side.
;
; Hooks used: customInit, customUnInstall, customInstall — all documented
; electron-builder NSIS extension points.
; -----------------------------------------------------------------------------

Var ILS_PreviousVersion

!macro customInit
  ReadRegStr $ILS_PreviousVersion HKCU "Software\${PRODUCT_NAME}" "Version"
  ${If} $ILS_PreviousVersion == ""
    ; Older installs sometimes only stamped the version under the standard
    ; uninstall key — fall back to it.
    ReadRegStr $ILS_PreviousVersion HKCU \
      "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
      "DisplayVersion"
  ${EndIf}
  ${If} $ILS_PreviousVersion != ""
    DetailPrint "Updating Iraqi Labor Scheduler from v$ILS_PreviousVersion to v${VERSION}."
    MessageBox MB_OK|MB_ICONINFORMATION "An existing installation was detected (v$ILS_PreviousVersion).$\r$\n$\r$\nThis wizard will update Iraqi Labor Scheduler to v${VERSION} in the same folder.$\r$\n$\r$\nYour data — employees, schedules, stations, holidays, and audit log — is stored in your user profile and will be preserved across the update."
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} ${Silent}
    DetailPrint "Preserving user data folder during pre-update sweep."
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallPath" "$INSTDIR"

  ; Drop the marker file in both candidate AppData folders. The Electron
  ; main process checks both at startup; whichever it finds triggers the
  ; data snapshot.
  CreateDirectory "$APPDATA\${PRODUCT_FILENAME}"
  FileOpen $0 "$APPDATA\${PRODUCT_FILENAME}\.update-pending" w
  FileWrite $0 "${VERSION}$\r$\n"
  FileWrite $0 "$ILS_PreviousVersion$\r$\n"
  FileClose $0

  CreateDirectory "$APPDATA\iraqi-labor-scheduler"
  FileOpen $0 "$APPDATA\iraqi-labor-scheduler\.update-pending" w
  FileWrite $0 "${VERSION}$\r$\n"
  FileWrite $0 "$ILS_PreviousVersion$\r$\n"
  FileClose $0
!macroend

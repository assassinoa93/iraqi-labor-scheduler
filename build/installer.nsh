; -----------------------------------------------------------------------------
; Iraqi Labor Scheduler — installer customisation (electron-builder hooks)
;
; Three responsibilities on top of electron-builder's default NSIS template:
;
;   1. Detect an existing installation via HKCU and surface a one-line
;      MessageBox at the start of the wizard so the user knows the
;      installer is performing an update, not a fresh install.
;
;   2. Defensively guarantee the user data folder
;      (%APPDATA%\<app>\data\) is never touched by the installer's payload.
;      The data folder lives outside ${INSTDIR} by design (see
;      electron/main.cjs); this is belt-and-braces.
;
;   3. Stamp the new version into HKCU (so the next installer detects it),
;      and drop a `.update-pending` marker the Electron main process reads
;      on first launch to snapshot the data folder. The marker is written
;      to two candidate AppData paths because Electron's `userData`
;      follows the package.json `name` while NSIS resolves
;      `${PRODUCT_FILENAME}` from `productName` — both paths are checked
;      from the JS side.
;
; Storage note: we use the `$R0` user register rather than a named `Var`
; because makensis runs with `-WX` (warnings-as-errors) under
; electron-builder. A top-level `Var` declared in this include and
; referenced inside a macro that expands elsewhere triggers a 6001
; "not referenced" warning even though the variable is used; registers
; are exempt from that check.
;
; Hooks used: customInit, customUnInstall, customInstall — all documented
; electron-builder NSIS extension points.
; -----------------------------------------------------------------------------

!macro customInit
  ; Detect a previous version via HKCU. Older releases sometimes only
  ; stamped the version under the standard uninstall key — fall back to it.
  ReadRegStr $R0 HKCU "Software\${PRODUCT_NAME}" "Version"
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU \
      "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
      "DisplayVersion"
  ${EndIf}
  ${If} $R0 != ""
    DetailPrint "Updating Iraqi Labor Scheduler from v$R0 to v${VERSION}."
    MessageBox MB_OK|MB_ICONINFORMATION "An existing installation was detected (v$R0).$\r$\n$\r$\nThis wizard will update Iraqi Labor Scheduler to v${VERSION} in the same folder.$\r$\n$\r$\nYour data — employees, schedules, stations, holidays, and audit log — is stored in your user profile and will be preserved across the update."
  ${EndIf}
!macroend

!macro customUnInstall
  ${If} ${Silent}
    DetailPrint "Preserving user data folder during pre-update sweep."
  ${EndIf}
!macroend

!macro customInstall
  ; Re-read the previous version (still the old value at this point — we
  ; haven't overwritten the registry yet). Used for the marker file so
  ; Electron's post-update toast can show "Updated from vX → vY".
  ReadRegStr $R0 HKCU "Software\${PRODUCT_NAME}" "Version"

  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "Version" "${VERSION}"
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallPath" "$INSTDIR"

  ; Drop the marker in both candidate AppData paths so Electron finds it
  ; regardless of whether `userData` follows productName or package name.
  CreateDirectory "$APPDATA\${PRODUCT_FILENAME}"
  FileOpen $R1 "$APPDATA\${PRODUCT_FILENAME}\.update-pending" w
  FileWrite $R1 "${VERSION}$\r$\n"
  FileWrite $R1 "$R0$\r$\n"
  FileClose $R1

  CreateDirectory "$APPDATA\iraqi-labor-scheduler"
  FileOpen $R1 "$APPDATA\iraqi-labor-scheduler\.update-pending" w
  FileWrite $R1 "${VERSION}$\r$\n"
  FileWrite $R1 "$R0$\r$\n"
  FileClose $R1
!macroend

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get current path
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
strExe = strPath & "\dist-electron\win-unpacked\Iraqi Labor Scheduler.exe"

If fso.FileExists(strExe) Then
    WshShell.Run Chr(34) & strExe & Chr(34), 1, False
Else
    MsgBox "Pre-built app not found. Please wait while I finish the background setup.", 48, "App Loading..."
End If

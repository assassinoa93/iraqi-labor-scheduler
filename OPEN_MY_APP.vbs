Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get current path
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
strExe = strPath & "\dist-electron\win-unpacked\Iraqi Labor Scheduler.exe"

If fso.FileExists(strExe) Then
    WshShell.Run Chr(34) & strExe & Chr(34), 1, False
Else
    res = MsgBox("The pre-built app is missing (this happens after a fresh download)." & vbCrLf & vbCrLf & "Would you like to build it now? This takes about 1-2 minutes.", 36, "App Not Ready")
    if res = 6 then
        WshShell.Run "wscript.exe CREATE_MY_DESKTOP_APP.vbs", 1, False
    end if
End If

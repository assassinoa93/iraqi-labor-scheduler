Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the path of the current folder
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

' 1. Run the build process (this needs to be visible just once to show progress)
' We use cmd /c so it closes when done
MsgBox "Building your Standalone App. This will take about 1-2 minutes. A window will appear briefly to show progress, then your Desktop Icon will be created automatically.", 64, "Iraqi Labor Scheduler"

' Run the build
intReturn = WshShell.Run("cmd.exe /c install.bat", 1, True)

If intReturn = 0 Then
    ' 2. Find the generated .exe (it will be in dist-electron)
    strDistPath = strPath & "\dist-electron"
    strExePath = ""
    
    If fso.FolderExists(strDistPath) Then
        Set objFolder = fso.GetFolder(strDistPath)
        For Each objFile In objFolder.Files
            If LCase(fso.GetExtensionName(objFile.Name)) = "exe" And InStr(objFile.Name, "Setup") > 0 Then
                strExePath = objFile.Path
                Exit For
            End If
        Next
    End If

    If strExePath <> "" Then
        MsgBox "Build Complete! Running the installer now to create your Desktop Icon...", 64, "Success"
        WshShell.Run Chr(34) & strExePath & Chr(34), 1, False
    Else
        MsgBox "Build finished, but I couldn't find the Installer .exe in 'dist-electron'. Please check that folder manually.", 48, "Notice"
    End If
Else
    MsgBox "There was an error during the build. Please make sure Node.js is installed on THIS machine (only needed for the first build).", 16, "Error"
End If
